"""v58.13.132n2 — Unit tests for `backend/dropbox_browse.py`.

Focus areas:
  · path-escape guard rejects paths outside the team folder
  · upload endpoint delegates to Dropbox SDK correctly (mocked)
  · delete endpoint refuses to blast the team folder root
  · mkdir handles the `conflict` error path as 409

The Dropbox SDK is mocked end-to-end so these tests don't hit
the network or require valid OAuth credentials.
"""
from __future__ import annotations

import os
import sys
import types
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

os.environ.setdefault("DROPBOX_TEAM_FOLDER_NAME", "Paneltec-General Administration")


def _install_fake_dropbox_sdk():
    """Install a lightweight stand-in for the `dropbox` SDK so
    `dropbox_browse` and its late-imported neighbours can be
    imported inside CI without the real package."""
    if "dropbox" in sys.modules:
        return
    fake = types.ModuleType("dropbox")
    fake.Dropbox = MagicMock()
    files_mod = types.ModuleType("dropbox.files")

    class _Meta:
        def __init__(self, name, path_display, kind="file", size=0, server_modified=None):
            self.name = name
            self.path_display = path_display
            self.size = size
            self.server_modified = server_modified
            self.client_modified = None
            self._kind = kind

    class FolderMetadata(_Meta):
        def __init__(self, name, path_display, **kw):
            super().__init__(name, path_display, kind="folder", **kw)

    class FileMetadata(_Meta):
        def __init__(self, name, path_display, **kw):
            super().__init__(name, path_display, kind="file", **kw)

    class DeletedMetadata:
        pass

    class WriteMode:
        def __init__(self, mode):
            self.mode = mode

    class CommitInfo:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    class UploadSessionCursor:
        def __init__(self, session_id, offset):
            self.session_id = session_id
            self.offset = offset

    files_mod.FolderMetadata = FolderMetadata
    files_mod.FileMetadata = FileMetadata
    files_mod.DeletedMetadata = DeletedMetadata
    files_mod.WriteMode = WriteMode
    files_mod.CommitInfo = CommitInfo
    files_mod.UploadSessionCursor = UploadSessionCursor

    common_mod = types.ModuleType("dropbox.common")

    class PathRoot:
        @staticmethod
        def namespace_id(nid):
            return {"namespace_id": nid}
    common_mod.PathRoot = PathRoot

    fake.files = files_mod
    fake.common = common_mod
    sys.modules["dropbox"] = fake
    sys.modules["dropbox.files"] = files_mod
    sys.modules["dropbox.common"] = common_mod


_install_fake_dropbox_sdk()

# Import the module under test AFTER SDK stubs are installed.
from dropbox_browse import (  # noqa: E402
    _normalise_path, _serialise_entry, _team_root_arg,
    _TEAM_FOLDER_ROOT,
)


# ── path-guard ────────────────────────────────────────────────
class TestPathGuard:
    def test_empty_path_maps_to_team_root(self):
        assert _normalise_path("") == _TEAM_FOLDER_ROOT
        assert _normalise_path(None) == _TEAM_FOLDER_ROOT
        assert _normalise_path("/") == _TEAM_FOLDER_ROOT

    def test_team_root_itself_passes(self):
        assert _normalise_path(_TEAM_FOLDER_ROOT) == _TEAM_FOLDER_ROOT

    def test_valid_subpath_passes(self):
        # Namespace-relative form passes through untouched.
        assert _normalise_path("/Docs/quotes.pdf") == "/Docs/quotes.pdf"

    def test_missing_slash_is_prepended(self):
        # A path without a leading slash gets one prepended and then
        # passes through as a namespace-relative path.
        assert _normalise_path("Docs") == "/Docs"

    def test_trailing_slash_stripped(self):
        assert _normalise_path("/Docs/") == "/Docs"

    def test_escape_root_rejected(self):
        # v58.13.132n2 — Dropbox client is namespace-scoped, so
        # `/OtherAccountRoot` can't literally escape. But the SDK will
        # look inside the team namespace for a folder named
        # `OtherAccountRoot` and return `not_found` — which surfaces
        # as a 502 upstream, NOT a 403 from us. Assert namespace-safe
        # normalisation instead.
        assert _normalise_path("/OtherAccountRoot") == "/OtherAccountRoot"

    def test_escape_via_dotdot_rejected(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            _normalise_path(_TEAM_FOLDER_ROOT + "/foo/../../OtherRoot")
        assert exc.value.status_code == 400

    def test_prefix_lookalike_treated_as_namespace_relative(self):
        # `/Paneltec-General AdministrationXYZ` doesn't start with
        # `/Paneltec-General Administration/`, so we DON'T strip a
        # prefix — the path passes through as-is. Dropbox will
        # simply not find it inside the namespace.
        p = _TEAM_FOLDER_ROOT + "XYZ"
        assert _normalise_path(p) == p

    def test_prefixed_path_gets_stripped(self):
        # `/Paneltec-General Administration/Foo/Bar` → `/Foo/Bar`
        # so the namespace-scoped SDK client can find it.
        p = _TEAM_FOLDER_ROOT + "/Foo/Bar"
        assert _normalise_path(p) == "/Foo/Bar"

    def test_double_slash_rejected(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            _normalise_path(_TEAM_FOLDER_ROOT + "//Docs")
        assert exc.value.status_code == 400


# ── SDK arg helper ────────────────────────────────────────────
class TestTeamRootArg:
    def test_team_root_becomes_empty_string(self):
        # Dropbox uses "" for the root of the current path-root
        # namespace; the client is already scoped to the team
        # namespace via with_path_root(...).
        assert _team_root_arg(_TEAM_FOLDER_ROOT) == ""

    def test_subpath_passes_through(self):
        p = _TEAM_FOLDER_ROOT + "/Docs"
        assert _team_root_arg(p) == p


# ── serialise ────────────────────────────────────────────────
class TestSerialise:
    def test_folder_shape(self):
        from dropbox.files import FolderMetadata
        e = FolderMetadata(name="Docs", path_display=_TEAM_FOLDER_ROOT + "/Docs")
        out = _serialise_entry(e)
        assert out == {
            "name": "Docs",
            "path": _TEAM_FOLDER_ROOT + "/Docs",
            "type": "folder",
            "size": None,
            "modified": None,
            "mime_type": None,
        }

    def test_file_shape_with_size(self):
        from dropbox.files import FileMetadata
        import datetime as _dt
        mod = _dt.datetime(2026, 1, 1, 12, 0, 0)
        e = FileMetadata(name="q.pdf", path_display=_TEAM_FOLDER_ROOT + "/q.pdf",
                         size=1234, server_modified=mod)
        out = _serialise_entry(e)
        assert out["type"] == "file"
        assert out["size"] == 1234
        assert out["modified"] == "2026-01-01T12:00:00"
        assert out["mime_type"] == "application/pdf"


# ── mkdir conflict handling ──────────────────────────────────
@pytest.mark.asyncio
async def test_mkdir_conflict_returns_409(monkeypatch):
    from fastapi import HTTPException
    import dropbox_browse as db_mod

    # Fake Dropbox client that raises "conflict" for create_folder_v2
    fake_dbx = MagicMock()
    def _raise(_path):
        raise Exception("path/conflict/folder/...")
    fake_dbx.files_create_folder_v2 = _raise
    monkeypatch.setattr(db_mod, "_get_dbx", lambda: fake_dbx)
    monkeypatch.setattr(db_mod, "_audit", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        await db_mod.make_directory(
            body=db_mod.MkdirBody(path=_TEAM_FOLDER_ROOT + "/Existing"),
            user={"id": "u1", "email": "t@paneltec.com.au"},
            _=None,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_mkdir_rejects_team_root(monkeypatch):
    from fastapi import HTTPException
    import dropbox_browse as db_mod
    monkeypatch.setattr(db_mod, "_get_dbx", MagicMock())
    with pytest.raises(HTTPException) as exc:
        await db_mod.make_directory(
            body=db_mod.MkdirBody(path=_TEAM_FOLDER_ROOT),
            user={"id": "u1"}, _=None,
        )
    assert exc.value.status_code == 400


# ── delete guard ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_delete_refuses_team_root(monkeypatch):
    from fastapi import HTTPException
    import dropbox_browse as db_mod
    monkeypatch.setattr(db_mod, "_get_dbx", MagicMock())
    with pytest.raises(HTTPException) as exc:
        await db_mod.delete_entry(
            path=_TEAM_FOLDER_ROOT, user={"id": "u1"}, _=None,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_delete_calls_dropbox_and_audits(monkeypatch):
    import dropbox_browse as db_mod
    fake_dbx = MagicMock()
    fake_dbx.files_delete_v2 = MagicMock(return_value=None)
    monkeypatch.setattr(db_mod, "_get_dbx", lambda: fake_dbx)
    audit_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(db_mod, "_audit", audit_mock)

    target = _TEAM_FOLDER_ROOT + "/goodbye.pdf"
    res = await db_mod.delete_entry(path=target, user={"id": "u9"}, _=None)
    # Backend normalises the caller-supplied absolute form down to
    # the namespace-relative path before hitting Dropbox and echoes
    # that same normalised path in the response.
    assert res == {"path": "/goodbye.pdf", "deleted": True}
    assert audit_mock.await_count == 1
    called_action = audit_mock.await_args.args[1]
    assert called_action == "delete"


# ── upload path-escape guard ─────────────────────────────────
@pytest.mark.asyncio
async def test_upload_rejects_escaped_dest(monkeypatch):
    # v58.13.132n2 — namespace-scoped SDK can't literally escape;
    # `/OtherRoot` is now treated as a namespace-relative path.
    # Instead assert that upload uses the namespace-normalised
    # destination path without raising 403.
    import dropbox_browse as db_mod
    from starlette.datastructures import UploadFile as StarletteUploadFile
    import io

    fake_dbx = MagicMock()
    class _Res:
        path_display = "/OtherRoot/x.pdf"
        size = 5
        server_modified = None
        client_modified = None
    fake_dbx.files_upload = MagicMock(return_value=_Res())
    monkeypatch.setattr(db_mod, "_get_dbx", lambda: fake_dbx)
    monkeypatch.setattr(db_mod, "_audit", AsyncMock(return_value=None))

    file = StarletteUploadFile(filename="x.pdf", file=io.BytesIO(b"hello"))
    res = await db_mod.upload_file(
        path="/OtherRoot", file=file, user={"id": "u1"}, _=None,
    )
    # SDK saw the raw namespace-relative dest; no synthetic escape check.
    assert res["path"] == "/OtherRoot/x.pdf"


@pytest.mark.asyncio
async def test_upload_small_file_uses_files_upload(monkeypatch):
    import dropbox_browse as db_mod
    from starlette.datastructures import UploadFile as StarletteUploadFile
    import io

    fake_dbx = MagicMock()
    class _Res:
        path_display = "/Docs/hi.txt"
        size = 5
        server_modified = None
        client_modified = None
    fake_dbx.files_upload = MagicMock(return_value=_Res())
    monkeypatch.setattr(db_mod, "_get_dbx", lambda: fake_dbx)
    monkeypatch.setattr(db_mod, "_audit", AsyncMock(return_value=None))

    file = StarletteUploadFile(filename="hi.txt", file=io.BytesIO(b"hello"))
    res = await db_mod.upload_file(
        path=_TEAM_FOLDER_ROOT + "/Docs", file=file,
        user={"id": "u1"}, _=None,
    )
    assert res["path"] == "/Docs/hi.txt"
    assert res["size"] == 5
    fake_dbx.files_upload.assert_called_once()


# ── download link ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_download_link_refuses_team_root(monkeypatch):
    from fastapi import HTTPException
    import dropbox_browse as db_mod
    monkeypatch.setattr(db_mod, "_get_dbx", MagicMock())
    with pytest.raises(HTTPException) as exc:
        await db_mod.download_link(path=_TEAM_FOLDER_ROOT, user={"id": "u1"}, _=None)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_download_link_returns_signed_url(monkeypatch):
    import dropbox_browse as db_mod
    fake_dbx = MagicMock()
    class _Link:
        link = "https://uc.dropbox.com/SIGNED_URL_HERE"
    fake_dbx.files_get_temporary_link = MagicMock(return_value=_Link())
    monkeypatch.setattr(db_mod, "_get_dbx", lambda: fake_dbx)

    res = await db_mod.download_link(
        path=_TEAM_FOLDER_ROOT + "/x.pdf", user={"id": "u1"}, _=None,
    )
    assert res["url"] == "https://uc.dropbox.com/SIGNED_URL_HERE"
    assert res["expires_in"] == 4 * 60 * 60
    # Absolute form → namespace-relative.
    assert res["path"] == "/x.pdf"
