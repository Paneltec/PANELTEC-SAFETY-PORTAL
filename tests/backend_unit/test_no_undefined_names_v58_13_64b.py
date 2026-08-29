"""v58.13.65 — Zero-tolerance guard for undefined-name references.

`ruff check --select F821 backend/` must return zero errors. The 17
sites that existed before this ship (1 in `email_outbox.py` and 16
in `scripts/deep_parse_legacy_pdfs.py`) were all in dead code paths
(a factory with 0 callers + a post-return unreachable block). Both
were deleted rather than patched, because patching dead code just
preserves the smell.

The test invokes ruff as a subprocess so it stays honest about the
same rules CI would run in a fresh checkout.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


_BACKEND = Path("/app/backend")


def _find_ruff() -> str | None:
    # Preview pod's plugin venv, then $PATH.
    for candidate in ("/opt/plugins-venv/bin/ruff", "ruff"):
        found = shutil.which(candidate) if candidate == "ruff" else (
            candidate if Path(candidate).exists() else None
        )
        if found:
            return found
    return None


def test_ruff_f821_backend_is_clean():
    ruff = _find_ruff()
    if ruff is None:
        import pytest
        pytest.skip("ruff binary not available on this box")
    r = subprocess.run(
        [ruff, "check", "--select", "F821", "--output-format", "concise",
         str(_BACKEND)],
        capture_output=True, text=True, timeout=60,
    )
    # ruff prints one line per hit to stdout, then exits 0/1 depending on
    # whether any errors were found.
    offenders = [
        ln for ln in (r.stdout or "").splitlines()
        if ": F821 " in ln
    ]
    assert not offenders, (
        f"`ruff --select F821 backend/` found {len(offenders)} undefined-"
        "name reference(s). v58.13.65 required this to be zero — either "
        "the name was mistyped, or the code path is unreachable and "
        f"should be deleted rather than patched:\n  "
        + "\n  ".join(offenders[:20])
    )


def test_make_email_route_factory_is_gone():
    """`_make_email_route` in `email_outbox.py` was a dead factory
    (0 call sites) whose final line referenced `record_id` from the
    inner `_impl` closure at registration time. Deleted in
    v58.13.65 — any resurrection needs a real caller AND a fix for
    the outer-scope NameError."""
    src = (_BACKEND / "email_outbox.py").read_text(encoding="utf-8")
    assert "def _make_email_route(" not in src, (
        "`_make_email_route` reappeared in `email_outbox.py`. If a "
        "caller now needs a factory, wire it up but fix the "
        "`name=f\"email-{resource}-{record_id}\"` NameError first."
    )


def test_process_submission_legacy_inline_body_is_just_the_delegator():
    """`_process_submission_LEGACY_INLINE` in
    `scripts/deep_parse_legacy_pdfs.py` was left as a back-compat
    shim. Its body used to hold ~215 lines of dead code referencing
    `parsed` and `template_fields` from the pre-refactor inline
    implementation. v58.13.65 truncated it to the single delegating
    return statement."""
    src = (_BACKEND / "scripts" / "deep_parse_legacy_pdfs.py").read_text(
        encoding="utf-8"
    )
    fn_start = src.find("async def _process_submission_LEGACY_INLINE(")
    assert fn_start != -1, "shim function unexpectedly deleted entirely"
    # Find the next top-level `async def ` or `def ` after this one to
    # bound the function body — LEGACY function should be tiny now.
    tail = src[fn_start:]
    next_def = tail.find("\nasync def ", 1)
    if next_def == -1:
        next_def = tail.find("\ndef ", 1)
    body = tail[:next_def] if next_def != -1 else tail
    # Fewer than 20 lines total (signature + docstring + return + our
    # replacement comment).
    line_count = body.count("\n")
    assert line_count < 25, (
        f"`_process_submission_LEGACY_INLINE` is {line_count} lines long "
        "— v58.13.65 truncated the dead block, this ship must stay tiny"
    )
    # And the executable body is exactly the delegator.
    assert "return await process_submission(db, sub, tpl_by_id)" in body


def test_version_sync_moved_past_v58_13_64():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path(
        "/app/frontend/public/service-worker.js"
    ).read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.64'" not in v_js
    assert "'paneltec-v160.3.9.58.13.64'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.64'" not in sw_js
    assert "v160.3.9.58.13.65" in v_js
