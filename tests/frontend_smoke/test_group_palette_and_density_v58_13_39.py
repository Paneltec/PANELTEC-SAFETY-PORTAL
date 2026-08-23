"""v58.13.39 — group palette + capture density smoke test."""
from __future__ import annotations
from pathlib import Path
import re
import subprocess
import textwrap

APP = Path("/app")
PALETTE = APP / "frontend/src/lib/groupPalette.js"
DENSITY = APP / "frontend/src/lib/useCaptureDensity.js"


def _node_eval(js_src: str) -> str:
    """Run a snippet of JS via node with a lightweight CJS-friendly
    transform (strip `export function` prefixes). Used to unit-test
    the pure helpers deterministically."""
    return subprocess.check_output(
        ["node", "-e", js_src], text=True, cwd=str(APP)).strip()


# ─── groupPalette.js — presence + exports ───────────────────────────

def test_group_palette_file_exists():
    assert PALETTE.exists()


def test_exports_resolve_group_palette_and_hash_idx():
    src = PALETTE.read_text(encoding="utf-8")
    assert "export function resolveGroupPalette" in src
    assert "export function hashIdx" in src
    assert "export const ROTATION" in src
    assert "export const INCIDENT_CATEGORY_PALETTE" in src


def test_rotation_has_eight_entries_all_shapes_valid():
    src = PALETTE.read_text(encoding="utf-8")
    # 8 entries in ROTATION array (block between `[` and `];`).
    m = re.search(r"export const ROTATION = \[(.+?)\];", src, re.DOTALL)
    assert m
    entries = re.findall(r"\{[^}]+\}", m.group(1))
    assert len(entries) == 8
    for e in entries:
        for key in ("name:", "hex:", "tint:", "text:"):
            assert key in e


def test_hash_idx_deterministic_and_stable():
    """`hashIdx('Foo Ltd', 8)` returns the same index on 10 calls;
    same slot across the module's `ROTATION` maps to same hex."""
    src = f"""
      const fs = require('fs');
      const code = fs.readFileSync('{PALETTE}', 'utf-8');
      // Strip ESM imports/exports so we can require via node's --input-type=commonjs eval.
      const stripped = code
        .replace(/^import[^;]+;/gm, '')
        .replace(/^export /gm, '');
      eval(stripped);
      const seen = new Set();
      for (let i=0; i<10; i++) seen.add(hashIdx('Foo Ltd', 8));
      // All 10 calls yield the same index.
      if (seen.size !== 1) {{ throw new Error('non-deterministic'); }}
      const idxA = hashIdx('Alexander Kingston', 8);
      const idxB = hashIdx('Alexander Kingston', 8);
      const idxC = hashIdx('Different Person', 8);
      console.log(JSON.stringify({{ same: idxA===idxB, differ: idxA!==idxC, idx: idxA }}));
    """
    out = _node_eval(textwrap.dedent(src))
    import json
    r = json.loads(out)
    assert r["same"] is True
    assert 0 <= r["idx"] < 8


def test_resolve_group_palette_returns_shape_and_deterministic():
    src = f"""
      const fs = require('fs');
      const code = fs.readFileSync('{PALETTE}', 'utf-8');
      // Skip the `import paletteForType` line for standalone test.
      const stripped = code
        .replace(/^import[^;]+;/gm, 'const paletteForType = () => null;')
        .replace(/^export /gm, '');
      eval(stripped);
      const a1 = resolveGroupPalette({{ groupKey: 'ACME Pty Ltd', page: 'cs-incidents' }});
      const a2 = resolveGroupPalette({{ groupKey: 'ACME Pty Ltd', page: 'cs-incidents' }});
      const b  = resolveGroupPalette({{ groupKey: 'near_miss', page: 'incidents' }});
      console.log(JSON.stringify({{
        a1keys: Object.keys(a1).sort(),
        stable: a1.hex === a2.hex,
        incident: b.hex,
      }}));
    """
    out = _node_eval(textwrap.dedent(src))
    import json
    r = json.loads(out)
    assert r["a1keys"] == ["hex", "name", "text", "tint"]
    assert r["stable"] is True
    # Near-miss category resolves to amber per INCIDENT_CATEGORY_PALETTE.
    assert r["incident"] == "#F59E0B"


# ─── useCaptureDensity — thresholds + spec shape ────────────────────

def test_density_hook_file_exists():
    assert DENSITY.exists()


def test_density_hook_exports_and_auto_thresholds():
    src = DENSITY.read_text(encoding="utf-8")
    assert "export default function useCaptureDensity" in src
    assert "export function autoModeForCount" in src
    # Sanity-check the branch thresholds documented in the ship brief.
    assert "n < 12" in src
    assert "n > 48" in src


def test_auto_mode_branches_by_count():
    src = f"""
      const fs = require('fs');
      const code = fs.readFileSync('{DENSITY}', 'utf-8');
      const stripped = code
        .replace(/^import[^;]+;/gm, '')
        .replace(/^export default /gm, '')
        .replace(/^export /gm, '');
      eval(stripped);
      console.log(JSON.stringify({{
        sparse: autoModeForCount(5),
        mid:    autoModeForCount(30),
        dense:  autoModeForCount(200),
        edgeLo: autoModeForCount(12),
        edgeHi: autoModeForCount(48),
      }}));
    """
    out = _node_eval(textwrap.dedent(src))
    import json
    r = json.loads(out)
    assert r["sparse"] == "spacious"
    assert r["mid"] == "comfortable"
    assert r["dense"] == "compact"
    # Boundaries (12 and 48) resolve to comfortable per <12 / >48 rule.
    assert r["edgeLo"] == "comfortable"
    assert r["edgeHi"] == "comfortable"


def test_density_hook_defines_grid_classes_and_min_heights():
    src = DENSITY.read_text(encoding="utf-8")
    # Spacious mode → 4-col at xl.
    assert "xl:grid-cols-4" in src
    # Comfortable → 6-col at 2xl.
    assert "2xl:grid-cols-6" in src
    # Compact → 8-col at 2xl.
    assert "2xl:grid-cols-8" in src
    # Comfortable min-h 96, compact min-h 64.
    assert "'96px'" in src
    assert "'64px'" in src


def test_density_localstorage_key_pattern():
    src = DENSITY.read_text(encoding="utf-8")
    assert "captureDensity:" in src
    assert "localStorage.getItem" in src
    assert "localStorage.setItem" in src


# ─── Version-sync ───────────────────────────────────────────────────

def test_version_sync_current():
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'",
                  running)
    assert m
    current = m.group(1)
    assert current.endswith("58.13.39"), \
        f"expected 58.13.39, got {current}"
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
