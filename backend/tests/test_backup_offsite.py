"""Off-site Dropbox copy: chunked upload reassembles the file exactly,
and pruning keeps only the newest N zips."""
import os
import sys
import types
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backup_offsite as bo  # noqa: E402


class FakeDbx:
    def __init__(self):
        self.files = {}
        self.sessions = {}
        self.deleted = []

    def files_upload(self, data, path, **kw):
        self.files[path] = data

    def files_upload_session_start(self, data):
        sid = f"s{len(self.sessions)}"
        self.sessions[sid] = bytearray(data)
        return types.SimpleNamespace(session_id=sid)

    def files_upload_session_append_v2(self, data, cursor):
        assert cursor.offset == len(self.sessions[cursor.session_id])
        self.sessions[cursor.session_id] += data

    def files_upload_session_finish(self, data, cursor, commit):
        assert cursor.offset == len(self.sessions[cursor.session_id])
        self.files[commit.path] = bytes(self.sessions[cursor.session_id] + data)


def test_chunked_upload_roundtrip(tmp_path, monkeypatch):
    fake = FakeDbx()
    import integrations_dropbox
    monkeypatch.setattr(integrations_dropbox, "_get_dbx_client", lambda: fake)
    monkeypatch.setattr(bo, "CHUNK", 1000)
    payload = os.urandom(3500)
    f = tmp_path / "snap.zip"
    f.write_bytes(payload)
    assert bo._upload_sync(str(f), "/B/x.zip") == 3500
    assert fake.files["/B/x.zip"] == payload

    small = tmp_path / "small.zip"
    small.write_bytes(b"abc")
    bo._upload_sync(str(small), "/B/s.zip")
    assert fake.files["/B/s.zip"] == b"abc"


def test_prune_keeps_newest(monkeypatch):
    from dropbox.files import FileMetadata
    now = datetime(2026, 10, 1)
    entries = [FileMetadata(name=f"b{i}.zip", path_lower=f"/b/b{i}.zip", id=f"id:{i}",
                            client_modified=now, server_modified=now - timedelta(hours=i),
                            rev="0123456789", size=1) for i in range(5)]
    fake = FakeDbx()
    fake.files_list_folder = lambda folder: types.SimpleNamespace(entries=entries, has_more=False)
    fake.files_delete_v2 = lambda p: fake.deleted.append(p)
    import integrations_dropbox
    monkeypatch.setattr(integrations_dropbox, "_get_dbx_client", lambda: fake)
    assert bo._prune_sync("/b", 2) == 3
    assert fake.deleted == ["/b/b2.zip", "/b/b3.zip", "/b/b4.zip"]


def test_disabled_without_dropbox(monkeypatch):
    monkeypatch.delenv("DROPBOX_REFRESH_TOKEN", raising=False)
    monkeypatch.delenv("DROPBOX_ACCESS_TOKEN", raising=False)
    assert bo.offsite_enabled() is False
    monkeypatch.setenv("DROPBOX_REFRESH_TOKEN", "x")
    assert bo.offsite_enabled() is True
    monkeypatch.setenv("BACKUP_OFFSITE_DROPBOX", "false")
    assert bo.offsite_enabled() is False
