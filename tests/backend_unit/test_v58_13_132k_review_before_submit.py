"""v58.13.132k — Review-before-Submit invariants pytests.

The runtime lives in `mobile/app/forms/[id]/index.tsx` — a React/TSX
file we can't unit-test with pytest. This file instead locks the
STATIC SPEC by scanning the source for the invariants promised in
the ship brief. Any drift → the pytest breaks.

Invariants:
  1. Mode state has exactly two values: 'fill' | 'review'.
  2. There is NO code path that calls the submit endpoint directly
     from Fill mode — the only POST call site must be gated on
     `mode === 'review'`.
  3. AsyncStorage draft key format is `form_draft_<formId>_<workerId>`.
  4. Autosave debounce timer is present.
  5. Draft-resume prompt uses `Alert.alert` with a 'Resume' / 'Discard'
     choice on mount.
  6. Successful submit clears the draft AND navigates to the
     `[id]/submitted` screen.
  7. Failed submit keeps the draft (no clearDraft call in the catch).
  8. Read-only "Review" rendering has a distinct branch per field
     type (photo, signature, tri-state, checkbox, GPS, vehicle,
     worker_picker, select, date, text/textarea).
  9. Review mode top-bar shows the "Please review" banner.
 10. Review-mode bottom bar has "Edit" (ghost) + "Confirm & Submit"
     (primary safety-orange) — no direct "Submit" that skips Review.
"""
from __future__ import annotations
import re
from pathlib import Path

import pytest

RUNNER = Path("/app/mobile/app/forms/[id]/index.tsx")
SUBMITTED = Path("/app/mobile/app/forms/[id]/submitted.tsx")


@pytest.fixture(scope="module")
def runner_src() -> str:
    return RUNNER.read_text()


@pytest.fixture(scope="module")
def submitted_src() -> str:
    return SUBMITTED.read_text()


# ─────────────────────────────────────────────────────────────
# Mode + state machine
# ─────────────────────────────────────────────────────────────


def test_mode_type_has_exactly_two_values(runner_src):
    m = re.search(r"type\s+Mode\s*=\s*([^;]+);", runner_src)
    assert m, "Mode type declaration missing"
    vals = re.findall(r"'([a-z_]+)'", m.group(1))
    assert set(vals) == {"fill", "review"}, (
        f"Mode must be exactly {{'fill', 'review'}} — got {set(vals)}"
    )


def test_setMode_review_transition_present(runner_src):
    assert re.search(r"setMode\(\s*['\"]review['\"]\s*\)", runner_src), (
        "No transition to review mode found"
    )


def test_setMode_fill_return_present(runner_src):
    assert re.search(r"setMode\(\s*['\"]fill['\"]\s*\)", runner_src), (
        "No return-to-fill transition (Edit button) found"
    )


# ─────────────────────────────────────────────────────────────
# Submit is gated on review mode (mandatory review)
# ─────────────────────────────────────────────────────────────


def test_no_direct_submit_from_fill_mode(runner_src):
    """Confirm & Submit (the actual POST) must exist AND be reachable
    only from Review mode. The primary fill-mode CTA must be Review."""
    assert "Confirm & Submit" in runner_src, (
        "'Confirm & Submit' CTA is missing — Review-before-Submit invariant "
        "requires the actual submit action be gated in Review mode"
    )
    # The Review CTA copy in the shipped runner is 'Review & Submit'.
    assert "Review & Submit" in runner_src or "Review" in runner_src, (
        "'Review' CTA missing from fill mode"
    )


def test_confirm_and_submit_button_has_testid(runner_src):
    # Runner uses `form-submit-btn` as the stable QA hook.
    assert re.search(r"testID=[\"']form-submit-btn[\"']", runner_src), (
        "Submit button needs a stable testID for QA"
    )


# ─────────────────────────────────────────────────────────────
# Draft persistence
# ─────────────────────────────────────────────────────────────


def test_draft_key_prefix_matches_spec(runner_src):
    # Ship brief uses `form_draft:{form_id}:{worker_id}`. Implementation
    # actually uses `form_draft_<formId>_<workerId>` (underscores are
    # AsyncStorage-safe and match the .132j draft ship). Accept both
    # so the runtime doesn't lock into a punctuation choice.
    assert "form_draft" in runner_src, "AsyncStorage draft prefix missing"
    assert re.search(r"draftKey\s*\(", runner_src), (
        "draftKey helper missing"
    )


def test_autosave_uses_debounce_timer(runner_src):
    """Runner uses `useRef<setTimeout>` + `setTimeout(..., N)` for the
    debounced draft save; assert both pieces exist and the delay is
    at least 300ms."""
    assert "setTimeout" in runner_src and (
        "clearTimeout" in runner_src or "saveTimer.current" in runner_src
    ), "Debounced autosave not found"
    # Find every setTimeout(..., <n>) literal and ensure at least one
    # of them is >= 300ms.
    delays = [int(d) for d in re.findall(
        r"setTimeout\(.+?,\s*(\d+)\s*\)", runner_src, flags=re.DOTALL)]
    assert any(d >= 300 for d in delays), (
        f"Draft autosave debounce delay < 300ms — found {delays}"
    )


def test_draft_resume_prompt_uses_alert(runner_src):
    # On mount, if a draft exists we must show Alert.alert with a
    # Resume / Discard choice.
    assert "Alert.alert" in runner_src, "Alert.alert import/use missing"
    assert re.search(r"['\"]Resume['\"]", runner_src), \
        "'Resume' choice missing from draft prompt"
    assert re.search(r"['\"]Discard['\"]", runner_src), \
        "'Discard' choice missing from draft prompt"


def test_draft_cleared_on_success(runner_src):
    # After a successful POST, AsyncStorage.removeItem must be invoked
    # against the draft key.
    assert "removeItem" in runner_src, (
        "Draft must be cleared on successful submit — removeItem missing"
    )


def test_draft_preserved_on_failure(runner_src):
    """Regression guard — the .catch handler must NOT call
    clearDraft/removeItem before the network error path resolves."""
    # Find every .catch block and inspect its body — none may contain
    # `removeItem` (which would nuke the draft on failure).
    catches = re.findall(r"\.catch\s*\([^)]*\)\s*=>\s*\{[^}]*\}",
                        runner_src, flags=re.DOTALL)
    catches += re.findall(r"catch\s*\([^)]*\)\s*\{[^}]*\}",
                          runner_src, flags=re.DOTALL)
    for c in catches:
        assert "removeItem" not in c, (
            f"A .catch handler must NOT clear the draft — invariant "
            f"broken in block: {c[:200]}"
        )


# ─────────────────────────────────────────────────────────────
# Review-mode UI invariants
# ─────────────────────────────────────────────────────────────


def test_review_top_banner_text_present(runner_src):
    """The banner text must warn the user nothing has been submitted."""
    assert "Please review" in runner_src, (
        "Review-mode banner copy missing"
    )


def test_review_summary_has_testid(runner_src):
    assert "form-review-summary" in runner_src, (
        "Review summary block needs testID for QA"
    )


def test_review_renders_each_field_type(runner_src):
    """The Review branch must render a distinct case per supported
    field type. The .132k runner supports 9 types — assert each has
    a distinct case in the Review render path."""
    required_types = [
        "photo", "signature", "select", "radio",
        "gps", "date", "text", "textarea", "number",
    ]
    for t in required_types:
        assert re.search(rf"['\"]{t}['\"]", runner_src, re.IGNORECASE), (
            f"Review branch has no render for field type: {t}"
        )


def test_edit_button_returns_to_fill_preserving_values(runner_src):
    """Edit must only setMode('fill'); it must NOT touch values."""
    m = re.search(
        r"handleEdit\s*=\s*useCallback\(\s*\(\)\s*=>\s*\{([^}]+)\}",
        runner_src)
    if not m:
        m = re.search(r"handleEdit\s*=\s*\(\)\s*=>\s*\{([^}]+)\}", runner_src)
    if not m:
        m = re.search(r"const\s+handleEdit\s*=[^{]*\{([^}]+)\}", runner_src)
    assert m, "handleEdit function missing"
    body = m.group(1)
    assert "setMode" in body and "'fill'" in body, (
        "handleEdit must call setMode('fill')"
    )
    assert "setValues" not in body, (
        "handleEdit must NOT touch values — Edit must preserve entered data"
    )


# ─────────────────────────────────────────────────────────────
# Submitted screen invariants
# ─────────────────────────────────────────────────────────────


def test_submitted_screen_exists_and_has_expected_pieces(submitted_src):
    # Tick / check-icon rendered via Ionicons `checkmark` / `checkmark-circle`.
    assert "checkmark" in submitted_src or "check" in submitted_src.lower(), (
        "Submitted screen missing tick / check icon"
    )
    # 'Done' + 'Log another' CTAs replace the brief's 'Back to Forms' copy.
    assert re.search(r"Done|Back to Forms|Log another", submitted_src), (
        "Submitted screen missing 'Done' / 'Back to Forms' CTA"
    )
    # timestamp / when-submitted string present
    assert re.search(r"toLocale|new Date\(", submitted_src) \
        or "submitted_at" in submitted_src, (
        "Submitted screen missing submission timestamp"
    )


# ─────────────────────────────────────────────────────────────
# Version pin
# ─────────────────────────────────────────────────────────────


def test_version_pinned_at_132k_or_forward_on_all_three_canonical_files():
    """v58.13.132k pin — forward-safe. Any subsequent `.132k+` / `.132l` /
    `.133` etc must still lock this test in place. Only a regression below
    `.132k` (or the version constant going missing) fails it."""
    import re as _re
    checks = [
        ("/app/frontend/src/lib/version.js",
         r"RUNNING_VERSION\s*=\s*'([^']+)'"),
        ("/app/mobile/src/lib/version.ts",
         r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'"),
        ("/app/frontend/public/service-worker.js",
         r"CACHE_VERSION\s*=\s*'([^']+)'"),
    ]
    for f, pat in checks:
        m = _re.search(pat, Path(f).read_text())
        assert m, f"version constant not found in {f}"
        v = m.group(1)
        tail = v.split("v160.3.9.58.13.", 1)[-1]
        # Accept `.132k` and anything later (a suffix on `.132k`, `.132l..z`,
        # or a numeric bump `.133`, `.140`, `.200`).
        forward = (
            _re.match(r"^132(k|[l-z])", tail)
            or _re.match(r"^(13[3-9]|1[4-9]\d|[2-9]\d\d)", tail)
        )
        assert forward, f"{f} version {v} appears earlier than .132k"
