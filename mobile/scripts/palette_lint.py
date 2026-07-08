#!/usr/bin/env python3
"""palette_lint.py — v160.0.10

Fails on hardcoded #RRGGBB / #RGB literals used as
`backgroundColor` / `color` / `borderColor` / `shadowColor` / `tintColor`
inside `/app/mobile/app/**/*.tsx` and `/app/mobile/src/**/*.tsx`
(except `colors.ts`).

Rules:
  • Suppress a line by appending  `// linter-ok: <reason>`  on the same line.
  • rgba(...) / rgb(...) / semi-transparent literals are ALLOWED (they're
    typically overlays / tints where centralised tokens don't help).
  • Only the specific style-prop keys above are flagged — a hex literal
    used elsewhere (e.g. `hexToRgba('#F97316')` in a helper) is fine.

Usage:
  python3 scripts/palette_lint.py          # exit 1 on violations
  python3 scripts/palette_lint.py --json   # machine-readable output
"""
from __future__ import annotations
import os
import re
import sys
import json

ROOTS = [
    '/app/mobile/app',
    '/app/mobile/src',
]
SKIP_FILES = {'/app/mobile/src/lib/colors.ts'}
PROP_KEYS = (
    'backgroundColor', 'color', 'borderColor', 'borderTopColor',
    'borderBottomColor', 'borderLeftColor', 'borderRightColor',
    'shadowColor', 'tintColor', 'placeholderTextColor',
)
# Match e.g.  backgroundColor: '#e6eff9'  or  color: "#FFF"
PATTERN = re.compile(
    r"(" + "|".join(PROP_KEYS) + r")\s*[:=]\s*['\"](#[0-9A-Fa-f]{3,8})['\"]"
)
SUPPRESS = re.compile(r"//\s*linter-ok")


def scan_file(path: str) -> list[dict]:
    hits: list[dict] = []
    try:
        with open(path, 'r') as fh:
            for lineno, line in enumerate(fh, start=1):
                if SUPPRESS.search(line):
                    continue
                for m in PATTERN.finditer(line):
                    hits.append({
                        'file': path,
                        'line': lineno,
                        'prop': m.group(1),
                        'hex':  m.group(2),
                        'snippet': line.rstrip(),
                    })
    except (IOError, UnicodeDecodeError):
        pass
    return hits


def main() -> int:
    files: list[str] = []
    for root in ROOTS:
        for dp, _, fs in os.walk(root):
            if 'node_modules' in dp or '.expo' in dp:
                continue
            for f in fs:
                if f.endswith(('.tsx', '.ts')):
                    p = os.path.join(dp, f)
                    if p not in SKIP_FILES:
                        files.append(p)

    all_hits: list[dict] = []
    for p in files:
        all_hits.extend(scan_file(p))

    as_json = '--json' in sys.argv
    if as_json:
        print(json.dumps(all_hits, indent=2))
    else:
        # Group by file for readable output
        by_file: dict[str, list[dict]] = {}
        for h in all_hits:
            by_file.setdefault(h['file'], []).append(h)
        for f in sorted(by_file):
            print(f"\n{f} ({len(by_file[f])})")
            for h in by_file[f]:
                print(f"  L{h['line']:>4}  {h['prop']}: {h['hex']}  ·  {h['snippet']}")
        print(f"\n─── total violations: {len(all_hits)} across {len(by_file)} file(s) ───")

    return 1 if all_hits else 0


if __name__ == '__main__':
    sys.exit(main())
