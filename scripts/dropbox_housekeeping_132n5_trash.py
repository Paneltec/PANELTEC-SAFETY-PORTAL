"""v58.13.132n5 housekeeping — permanently delete three test artefacts
from the Paneltec team folder trash.

Targets (soft-deleted; we're doing the hard delete now):
  · /.132n2a_write_test          (folder — from `.132n2a_write_test` mkdir probe)
  · /.132n2a_upload_test.txt     (file   — from `.132n2a_upload_test` upload probe)
  · /Software/.132n4a_test_rename_new  (file — from `.132n4a` rename→move probe)

Reads env directly (DROPBOX_APP_KEY / DROPBOX_APP_SECRET /
DROPBOX_REFRESH_TOKEN / DROPBOX_TEAM_FOLDER_ID) via the same helpers
`backend/integrations_dropbox.py` uses, then scopes the client to the
team namespace via `with_path_root(PathRoot.namespace_id(...))`.

Explicitly does NOT touch the phantom `/Paneltec-General Administration`
subfolder in trash — user directive.

Safe to re-run: `files_permanently_delete` on an already-hard-deleted
path returns `path_lookup/not_found`, which we swallow as OK.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Load backend/.env so we get DROPBOX_* creds when running from /app.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")
except ImportError:
    pass

# Add backend/ to path so we can reuse the exact factories.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from integrations_dropbox import _get_dbx_client  # noqa: E402
from dropbox_browse import _get_team_namespace_id  # noqa: E402

TARGETS = [
    "/.132n2a_write_test",           # folder
    "/.132n2a_upload_test.txt",      # file
    "/Software/.132n4a_test_rename_new",  # file
]

# Explicit deny — user directive: leave this in trash alone.
PROTECTED = {"/Paneltec-General Administration"}


def main() -> int:
    import dropbox
    from dropbox.common import PathRoot
    from dropbox.exceptions import ApiError

    team_ns = _get_team_namespace_id()
    print(f"[housekeeping] team namespace id: {team_ns}")

    dbx_user = _get_dbx_client()
    dbx = dbx_user.with_path_root(PathRoot.namespace_id(team_ns))

    results = []
    for path in TARGETS:
        assert path not in PROTECTED, f"REFUSED — path is protected: {path}"
        print(f"[housekeeping] permanently deleting: {path!r}")
        try:
            dbx.files_permanently_delete(path)
            results.append((path, "ok"))
            print(f"  → OK")
        except ApiError as e:
            summary = str(e)
            # `path_lookup/not_found` is fine — already hard-deleted.
            if "not_found" in summary:
                results.append((path, "already_gone"))
                print(f"  → already gone (not_found) — treating as OK")
            else:
                results.append((path, f"api_error: {summary[:200]}"))
                print(f"  → API ERROR: {summary[:200]}")
        except Exception as e:  # noqa: BLE001
            results.append((path, f"error: {type(e).__name__}: {str(e)[:200]}"))
            print(f"  → ERROR: {type(e).__name__}: {str(e)[:200]}")

    print("\n== summary ==")
    for path, status in results:
        print(f"  {status:20s}  {path}")

    # Non-zero exit if anything actually failed (ignoring not_found).
    hard_fail = [r for r in results if r[1] not in {"ok", "already_gone"}]
    return 1 if hard_fail else 0


if __name__ == "__main__":
    sys.exit(main())
