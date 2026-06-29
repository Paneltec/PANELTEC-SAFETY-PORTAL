#!/usr/bin/env python3
"""Wave 2 lucide → Fluent UI System Icons migration.

For each target file:
  1. Patch the lucide-react named import to remove the icons we're swapping.
  2. Prepend a `@fluentui/react-icons` import block with the Fluent
     equivalents under the same local names (so the existing JSX keeps
     working — e.g. `<Trash2 …>` keeps referencing `Trash2`, but it now
     resolves to Fluent's `Delete20Regular`).
  3. Strip the `size={N}` prop from those JSX usages — Fluent bakes the
     size into the component name, so a `size` prop becomes a React DOM
     warning if we leave it.

The mapping is intentionally conservative: only swap icons that surface
in row actions / toolbars per the Wave 2 brief. Decorative / chip / modal
icons are left untouched.
"""
from __future__ import annotations
import argparse
import re
import sys
from pathlib import Path


# Local lucide name → (FluentName, Fluent local alias kept identical to lucide)
GLOBAL_MAP = {
    # row actions
    'Pencil':       ('Edit20Regular',),
    'Edit3':        ('Edit20Regular',),
    'Trash2':       ('Delete20Regular',),
    'Eye':          ('Eye20Regular',),
    'Download':     ('ArrowDownload20Regular',),
    'Upload':       ('ArrowUpload20Regular',),
    'Printer':      ('Print20Regular',),
    'Mail':         ('Mail20Regular',),
    'Send':         ('Send20Regular',),
    'QrCode':       ('QrCode20Regular',),
    'Plus':         ('Add20Regular',),
    'Copy':         ('Copy20Regular',),
    'Tag':          ('Tag20Regular',),
    # toolbar
    'Search':       ('Search20Regular',),
    'Filter':       ('Filter20Regular',),
    'RefreshCw':    ('ArrowSync20Regular',),
    'RefreshCcw':   ('ArrowSync20Regular',),
    'Star':         ('Star20Regular',),
}


def patch_lucide_import(src: str, drop: set[str]) -> str:
    """Remove `drop` names from the `import {...} from 'lucide-react'` block."""
    m = re.search(r"import\s*\{([^}]+)\}\s*from\s*['\"]lucide-react['\"]\s*;",
                  src, re.S)
    if not m:
        return src
    names_raw = m.group(1)
    new_names = []
    for chunk in names_raw.split(','):
        s = chunk.strip()
        if not s:
            continue
        # handle `Foo as Bar` and bare `Foo`
        base = s.split(' as ')[0].strip()
        if base in drop:
            continue
        new_names.append(s)
    new_block = (
        "import { " + ', '.join(new_names) + " } from 'lucide-react';"
        if new_names else
        "// (Wave 2) all lucide row-action icons swapped to @fluentui/react-icons"
    )
    return src[:m.start()] + new_block + src[m.end():]


def insert_fluent_import(src: str, mapping: dict[str, str]) -> str:
    """Insert (or extend) the @fluentui/react-icons import block to alias the
    Fluent names back to the lucide local names that the JSX still uses.

    e.g. `import { Delete20Regular as Trash2 } from '@fluentui/react-icons';`
    """
    aliases = sorted(set(f"{fluent} as {lucide}" for lucide, fluent in mapping.items()))
    block = (
        "// Phase 3.20 Wave 2 — lucide row-action/toolbar icons swapped\n"
        "// to @fluentui/react-icons. Aliased back to the original lucide\n"
        "// names so existing JSX call sites don't need to change.\n"
        "import {\n  " + ",\n  ".join(aliases) + ",\n} from '@fluentui/react-icons';\n"
    )
    # Insert immediately after the last existing `import …` line.
    last_import = None
    for m in re.finditer(r"^import .*?;\s*$", src, re.M):
        last_import = m
    if last_import:
        idx = last_import.end()
        return src[:idx] + "\n" + block + src[idx:]
    return block + src


def strip_size_prop_on_swapped(src: str, swapped: set[str]) -> str:
    """Remove `size={N}` from JSX usages of swapped icons; Fluent components
    encode size in the component name."""
    for name in swapped:
        # <Name size={NN} ...> or <Name ... size={NN} ...>
        pattern = re.compile(
            r"(<" + re.escape(name) + r"\b[^>]*?)\s+size=\{[^}]+\}",
            re.M,
        )
        # apply iteratively in case there are multiple size= props (shouldn't be)
        prev = None
        while prev != src:
            prev = src
            src = pattern.sub(r"\1", src)
    return src


def migrate(path: Path) -> tuple[int, set[str]]:
    src = path.read_text(encoding='utf-8')
    # Determine which icons in our GLOBAL_MAP are actually imported by this file.
    m = re.search(r"import\s*\{([^}]+)\}\s*from\s*['\"]lucide-react['\"]\s*;",
                  src, re.S)
    if not m:
        return (0, set())
    imported = set()
    for chunk in m.group(1).split(','):
        base = chunk.strip().split(' as ')[0].strip()
        if base:
            imported.add(base)
    swappable = imported & set(GLOBAL_MAP)
    if not swappable:
        return (0, set())
    mapping = {name: GLOBAL_MAP[name][0] for name in swappable}
    # Patch lucide import
    src = patch_lucide_import(src, swappable)
    # Insert Fluent import block aliased back to the original names
    src = insert_fluent_import(src, mapping)
    # Strip size prop from JSX usages
    src = strip_size_prop_on_swapped(src, swappable)
    path.write_text(src, encoding='utf-8')
    return (len(swappable), swappable)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('files', nargs='+', help='target source files')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    total = 0
    for p in args.files:
        path = Path(p)
        if not path.exists():
            print(f"SKIP {p}: not found", file=sys.stderr)
            continue
        before = path.read_text(encoding='utf-8')
        count, swapped = migrate(path)
        if count == 0:
            print(f"[ ] {p}: no swappable icons")
            continue
        if args.dry_run:
            after = path.read_text(encoding='utf-8')
            path.write_text(before, encoding='utf-8')  # restore
        total += count
        print(f"[*] {p}: swapped {count} icons → {sorted(swapped)}")
    print(f"---\nTotal icons swapped: {total}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
