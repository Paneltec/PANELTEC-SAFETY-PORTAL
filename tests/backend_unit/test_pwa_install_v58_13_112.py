"""v58.13.112 — In-app PWA install affordance regression tests.

Locks:
  · `usePwaInstall` hook exports the {canPrompt, isInstalled, isIOS,
    promptInstall} contract that the button + banner rely on.
  · Hook captures `beforeinstallprompt` (called `e.preventDefault()` +
    stashed the event) and clears it on `appinstalled`.
  · `PwaInstallControls.jsx` exports both `PwaInstallButton` and
    `PwaInstallBanner`; the button testid is `pwa-install-btn`, the
    banner testid is `pwa-install-banner`, and the iOS walk-through
    testid is `pwa-ios-install-modal`.
  · AppShell mounts the button inside `SidebarShell` (both collapsed
    and expanded states) AND mounts the banner between the TopBar and
    RebrandNudge.
  · One-time banner auto-persistence — the 30 s timer sets the
    `paneltec_pwa_install_banner_seen_v112` localStorage key so the
    banner cannot reappear on subsequent reloads.
  · Version-sync forward-safe pin >= .112 across the 3 canonical
    version strings.
"""
from __future__ import annotations
import re
from pathlib import Path

HOOK_SRC = Path("/app/frontend/src/hooks/usePwaInstall.js").read_text()
CTRL_SRC = Path("/app/frontend/src/components/PwaInstallControls.jsx").read_text()
SHELL_SRC = Path("/app/frontend/src/components/layout/AppShell.jsx").read_text()


# ── Hook contract ────────────────────────────────────────────────────
def test_hook_exports_default():
    assert "export default function usePwaInstall" in HOOK_SRC


def test_hook_captures_beforeinstallprompt():
    # Event listener wired for `beforeinstallprompt`, and it calls
    # preventDefault() to keep Chrome's mini-infobar off.
    assert re.search(r"addEventListener\(\s*['\"]beforeinstallprompt['\"]", HOOK_SRC)
    assert "e.preventDefault()" in HOOK_SRC


def test_hook_clears_on_appinstalled():
    # appinstalled listener flips isInstalled to true and drops the
    # deferred event so a stale prompt() call can't fire.
    assert re.search(r"addEventListener\(\s*['\"]appinstalled['\"]", HOOK_SRC)
    assert "setIsInstalled(true)" in HOOK_SRC


def test_hook_detects_standalone_mode():
    # matchMedia display-mode: standalone check for Chrome/Edge/Android
    # AND navigator.standalone === true fallback for iOS Safari.
    assert "display-mode: standalone" in HOOK_SRC
    assert "navigator.standalone" in HOOK_SRC


def test_hook_returns_expected_shape():
    # Consumers destructure {canPrompt, isInstalled, isIOS, promptInstall}
    # so the shape must be locked. Accept both explicit `key:` and
    # ES2015 shorthand (`isInstalled,` inside the return literal).
    for key in ("canPrompt", "isInstalled", "isIOS", "promptInstall"):
        found = (
            f"{key}:" in HOOK_SRC
            or f"{key} =" in HOOK_SRC
            or re.search(rf"return\s*\{{[^}}]*\b{key}\b", HOOK_SRC, re.DOTALL) is not None
        )
        assert found, f"hook return shape missing key: {key}"


def test_prompt_install_falls_through_when_no_event():
    # The consumer needs to know we've been ready-checked so it can
    # switch to the iOS walk-through fallback.
    assert re.search(r"return\s+\{\s*outcome:\s*['\"]unavailable['\"]", HOOK_SRC)


# ── PwaInstallControls exports + testids ─────────────────────────────
def test_control_module_exports_both():
    assert "export function PwaInstallButton" in CTRL_SRC
    assert "export function PwaInstallBanner" in CTRL_SRC


def test_control_module_uses_hook():
    assert "from '../hooks/usePwaInstall'" in CTRL_SRC


def test_control_testids_present():
    assert 'data-testid="pwa-install-btn"' in CTRL_SRC
    assert 'data-testid="pwa-install-banner"' in CTRL_SRC
    assert 'data-testid="pwa-ios-install-modal"' in CTRL_SRC


def test_button_hidden_when_installed_or_no_signal():
    # The React early-returns keep the button off the DOM entirely
    # when there's nothing to prompt AND the user isn't on iOS.
    assert "if (isInstalled) return null" in CTRL_SRC
    assert "if (!canPrompt && !isIOS) return null" in CTRL_SRC


def test_banner_persists_after_30s():
    # Auto-persist after 30_000ms ticks so refreshing the tab doesn't
    # repeat the banner. Look for the 30_000 literal AND setTimeout
    # separately — the arrow body carries commas so a single greedy
    # regex is fragile.
    assert "setTimeout" in CTRL_SRC
    assert re.search(r"\b30[_,]?000\b", CTRL_SRC), "expected 30_000 auto-persist delay"
    assert "paneltec_pwa_install_banner_seen_v112" in CTRL_SRC


def test_banner_session_dismiss_key():
    # Session-only dismiss so Not-now / ✕ don't kill the banner
    # permanently — only the 30 s tick or a real install does.
    assert "paneltec_pwa_install_banner_dismissed" in CTRL_SRC


def test_ios_modal_walkthrough_steps():
    # The iOS Safari walk-through must reference the Share icon and
    # the Add-to-Home-Screen step so users can actually complete it.
    assert "Share" in CTRL_SRC
    assert "Add to Home Screen" in CTRL_SRC


# ── AppShell wiring ──────────────────────────────────────────────────
def test_appshell_imports_pwa_controls():
    assert "from '@/components/PwaInstallControls'" in SHELL_SRC
    assert "PwaInstallButton" in SHELL_SRC
    assert "PwaInstallBanner" in SHELL_SRC


def test_appshell_mounts_button_in_desktop_sidebar():
    # Rendered inside SidebarShell so the desktop sidebar carries it
    # both in collapsed and expanded states.
    assert re.search(r"SidebarShell.*?<PwaInstallButton", SHELL_SRC, re.DOTALL)


def test_appshell_mounts_banner_above_rebrand_nudge():
    # Order matters — the install banner must sit BELOW the TopBar
    # and ABOVE any other in-content banners so a v116 stale-icon
    # user still sees both.
    assert re.search(r"<PwaInstallBanner\s*/>[^<]*<RebrandNudge", SHELL_SRC, re.DOTALL)


# ── Version sync forward-safe pin ────────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def _tail(s: str) -> tuple[int, str]:
    m = _VERSION_TAIL_RE.search(s)
    assert m, f"could not find version tail in: {s[:400]}"
    return int(m.group(1)), m.group(2)


def test_version_bumps_meet_112():
    running = Path("/app/frontend/src/lib/version.js").read_text()
    sw = Path("/app/frontend/public/service-worker.js").read_text()
    mob = Path("/app/mobile/src/lib/version.ts").read_text()
    for label, blob in (("frontend/version.js", running),
                        ("service-worker.js", sw),
                        ("mobile/version.ts", mob)):
        # Pick the HIGHEST version tail in the file — historical
        # entries in the change-log block would otherwise fail the
        # forward-safe pin.
        tails = [(int(m.group(1)), m.group(2))
                 for m in _VERSION_TAIL_RE.finditer(blob)]
        assert tails, f"{label} has no version tail"
        highest = max(tails)
        assert highest >= (112, ""), f"{label} latest tail={highest} < (112, '')"
