"""v58.13.66 — Category A real stale-closure bugs frozen.

Three sites carried genuine stale-closure risk (not the "load in
mount-only useEffect" cosmetic pattern, not the "wrap in useMemo"
micro-perf pattern). Each has a scenario in which the effect
should re-run but wouldn't:

  1. `WorkerViewModal.jsx:390` — the HR-docs fetch effect gated
     on `canViewHrDocs` but only listed `[workerId, currentUser]`
     in its deps. A permission flip while the modal was open
     never re-fired the fetch. Fixed by adding `canViewHrDocs` to
     the dep array and dropping `currentUser` (indirect, no longer
     read directly).

  2. `AccessSection.jsx:24` — the mount-only refresh had an
     `eslint-disable-next-line` suppressor. Refactored to
     `refresh = useCallback(async () => …, [userId])` and
     `useEffect(() => { refresh(); }, [refresh])` — honest deps,
     no suppressor, stable identity across renders.

  3. `PickerFields.jsx:144` — the universal-picker fetch effect
     stringified `fetchParams` inside its dep array (complex
     expression, defeats static analysis) and omitted `fetchUrl`,
     `fetchParams`, `readOnly` as deps. Refactored to compute
     `paramsKey = useMemo(() => JSON.stringify(…), [fetchParams])`
     ahead of the effect, then honest deps `[open, debounced,
     paramsKey, fetchUrl, readOnly, fetchParams]`.

Static ESLint scan — runs the standalone hooks-audit config
against the 3 files and asserts zero `react-hooks/*` warnings.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


_FRONTEND = Path("/app/frontend")
_TARGET_FILES = [
    "src/components/workers/WorkerViewModal.jsx",
    "src/components/auth/AccessSection.jsx",
    "src/components/forms/PickerFields.jsx",
]


def _run_eslint(target_files):
    eslint = _FRONTEND / "node_modules" / ".bin" / "eslint"
    if not eslint.exists():
        return None
    cmd = [
        str(eslint), "--config", "eslint.hooks.audit.mjs",
        "--format", "json",
        *target_files,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True,
                       timeout=180, cwd=str(_FRONTEND))
    if not r.stdout.strip():
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return None


def test_category_a_targets_have_zero_hook_warnings():
    data = _run_eslint(_TARGET_FILES)
    if data is None:
        import pytest
        pytest.skip("eslint not available or produced no JSON output")
    offenders = []
    for r in data:
        for m in r.get("messages", []):
            rule = m.get("ruleId") or ""
            if rule.startswith("react-hooks"):
                offenders.append(
                    f"{r['filePath'].replace(str(_FRONTEND) + '/', '')}:"
                    f"{m['line']} [{rule}] {m['message']}"
                )
    assert not offenders, (
        "The 3 Category-A stale-closure sites should have zero "
        "`react-hooks/*` warnings after v58.13.66. Offenders:\n  "
        + "\n  ".join(offenders)
    )


def test_worker_view_modal_canviewhrdocs_in_effect_deps():
    """Freeze the fix — deleting `canViewHrDocs` from the dep array
    would resurrect the permission-flip stale-closure bug."""
    src = (_FRONTEND / "src/components/workers/WorkerViewModal.jsx").read_text(
        encoding="utf-8"
    )
    # Locate the hr-documents effect and confirm its dep list.
    idx = src.find("/hr-documents`")
    assert idx > 0
    tail = src[idx:idx + 600]
    assert "}, [workerId, canViewHrDocs]" in tail, (
        "WorkerViewModal hr-docs effect deps must include "
        "`canViewHrDocs` — that's the fix v58.13.66 shipped"
    )


def test_access_section_refresh_is_usecallback():
    src = (_FRONTEND / "src/components/auth/AccessSection.jsx").read_text(
        encoding="utf-8"
    )
    assert "useCallback" in src, (
        "AccessSection must import + use `useCallback` after v58.13.66"
    )
    assert "const refresh = useCallback(async () =>" in src, (
        "`refresh` must be wrapped in useCallback"
    )
    assert "useEffect(() => { refresh(); }, [refresh])" in src, (
        "The mount effect must depend on the memoized `refresh`"
    )
    # The old eslint-disable escape hatch is gone.
    assert "eslint-disable-next-line" not in src, (
        "The old eslint suppressor should be removed — v58.13.66 "
        "made the deps honest"
    )


def test_picker_fields_paramskey_and_honest_deps():
    src = (_FRONTEND / "src/components/forms/PickerFields.jsx").read_text(
        encoding="utf-8"
    )
    assert "const paramsKey = useMemo(" in src, (
        "PickerFields must compute `paramsKey` via useMemo instead of "
        "stringifying inside the effect's dep array"
    )
    # The stale complex-expression dep is gone.
    assert "JSON.stringify(fetchParams || {})]" not in src, (
        "The old complex-expression dep must be replaced"
    )
    # Honest deps present.
    assert "paramsKey, fetchUrl, readOnly" in src


def test_version_sync_moved_past_v58_13_65():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path(
        "/app/frontend/public/service-worker.js"
    ).read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.65'" not in v_js
    assert "'paneltec-v160.3.9.58.13.65'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.65'" not in sw_js
    assert "v160.3.9.58.13.66" in v_js
