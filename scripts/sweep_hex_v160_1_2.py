#!/usr/bin/env python3
"""
v160.1.2 — Inline-hex sweep. Walk every .ts/.tsx/.js/.jsx file under
`/app/mobile/app` and `/app/mobile/src` (excluding colors.ts, node_modules,
.expo) and rewrite hex-code string literals into `Colors.<token>` refs.

- JSX attributes like `color="#F97316"` become `color={Colors.imBronze}`.
- Object / style literals like `{ color: '#F97316' }` become `{ color: Colors.imBronze }`.
- Anything with a mapping entry gets rewritten; anything without a mapping
  keeps its hex UNCHANGED (so the grep-for-zero check surfaces it).
- Files that receive at least one substitution but don't already import
  `Colors` from `../lib/colors` OR `../../lib/colors` OR `../../../lib/colors`
  get an import line inserted after the last `import` line.
"""
from __future__ import annotations
import os, re, sys

HEX_MAP: dict[str, str] = {
    # Whites → pure white surface
    '#fff':     'Colors.imSurface',
    '#FFF':     'Colors.imSurface',
    '#ffff':    'Colors.imSurface',   # occasionally seen
    '#FFFFFF':  'Colors.imSurface',
    '#ffffff':  'Colors.imSurface',

    # Blacks → ink
    '#000':     'Colors.imInk',
    '#000000':  'Colors.imInk',
    '#0F172A':  'Colors.imInk',
    '#0f172a':  'Colors.imInk',
    '#1E293B':  'Colors.imInk',
    '#1e293b':  'Colors.imInk',
    '#1A1A1A':  'Colors.imInk',
    '#1a1a1a':  'Colors.imInk',
    '#111827':  'Colors.imInk',
    '#0D3B66':  'Colors.imInk',
    '#0d3b66':  'Colors.imInk',
    '#163A63':  'Colors.imInk',
    '#163a63':  'Colors.imInk',

    # Muted / secondary text greys
    '#4B4B4B':  'Colors.imInkMuted',
    '#4b4b4b':  'Colors.imInkMuted',
    '#475569':  'Colors.imInkMuted',
    '#334155':  'Colors.imInkMuted',
    '#5B6770':  'Colors.imInkMuted',
    '#5b6770':  'Colors.imInkMuted',
    '#64748B':  'Colors.imInkMuted',
    '#64748b':  'Colors.imInkMuted',
    '#546E7A':  'Colors.imInkMuted',
    '#546e7a':  'Colors.imInkMuted',
    '#263238':  'Colors.imInkMuted',

    # Subtle text / placeholders
    '#8A8A8A':  'Colors.imInkSubtle',
    '#8a8a8a':  'Colors.imInkSubtle',
    '#94A3B8':  'Colors.imInkSubtle',
    '#94a3b8':  'Colors.imInkSubtle',
    '#9CA3AF':  'Colors.imInkSubtle',
    '#9ca3af':  'Colors.imInkSubtle',

    # Borders / concrete tints
    '#C8C8C8':  'Colors.imBorder',
    '#c8c8c8':  'Colors.imBorder',
    '#CBD5E1':  'Colors.imBorder',
    '#cbd5e1':  'Colors.imBorder',
    '#E2E8F0':  'Colors.imBorder',
    '#e2e8f0':  'Colors.imBorder',
    '#E5E7EB':  'Colors.imBorder',
    '#e5e7eb':  'Colors.imBorder',
    '#9E9E9E':  'Colors.imBorder',
    '#9e9e9e':  'Colors.imBorder',
    '#D1D5DB':  'Colors.imBorder',
    '#d1d5db':  'Colors.imBorder',

    # Steel / medium greys
    '#B2B2B2':  'Colors.imSteel',
    '#b2b2b2':  'Colors.imSteel',
    '#A0A0A0':  'Colors.imStone',
    '#a0a0a0':  'Colors.imStone',
    '#B0BEC5':  'Colors.imStone',

    # Concrete / very light greys
    '#EAEAEA':  'Colors.imConcrete',
    '#eaeaea':  'Colors.imConcrete',
    '#F8FAFC':  'Colors.imConcrete',
    '#f8fafc':  'Colors.imConcrete',
    '#F1F5F9':  'Colors.imConcrete',
    '#f1f5f9':  'Colors.imConcrete',
    '#F5F5F5':  'Colors.imConcrete',
    '#f5f5f5':  'Colors.imConcrete',
    '#F5F5F3':  'Colors.imConcrete',
    '#F5F3FF':  'Colors.imConcrete',
    '#EEF2F5':  'Colors.imConcrete',
    '#eef2f5':  'Colors.imConcrete',
    '#F3F4F6':  'Colors.imConcrete',
    '#FAFAFA':  'Colors.imConcrete',

    # Oranges / bronze accent
    '#C08040':  'Colors.imBronze',
    '#c08040':  'Colors.imBronze',
    '#FF6B00':  'Colors.imBronze',
    '#F97316':  'Colors.imBronze',
    '#f97316':  'Colors.imBronze',
    '#F87F3E':  'Colors.imBronze',
    '#f87f3e':  'Colors.imBronze',
    '#EA580C':  'Colors.imBronze',
    '#ea580c':  'Colors.imBronze',
    '#F47C20':  'Colors.imBronze',
    '#f47c20':  'Colors.imBronze',
    '#F58220':  'Colors.imBronze',
    '#f58220':  'Colors.imBronze',
    '#B45309':  'Colors.imBronze',
    '#b45309':  'Colors.imBronze',
    '#a8480f':  'Colors.imBronze',
    '#A8480F':  'Colors.imBronze',
    '#C2410C':  'Colors.imBronze',
    '#c2410c':  'Colors.imBronze',
    '#EA6C00':  'Colors.imBronze',
    '#D97706':  'Colors.imBronze',
    '#d97706':  'Colors.imBronze',
    '#C65D0A':  'Colors.imBronze',
    '#CC5500':  'Colors.imBronze',
    '#FB923C':  'Colors.imBronze',
    '#fb923c':  'Colors.imBronze',

    # Ambers / warnings — bronze doubles as warning
    '#FACC15':  'Colors.imWarning',
    '#facc15':  'Colors.imWarning',
    '#F9A825':  'Colors.imWarning',
    '#f9a825':  'Colors.imWarning',
    '#EAB308':  'Colors.imWarning',
    '#eab308':  'Colors.imWarning',
    '#F59E0B':  'Colors.imWarning',
    '#f59e0b':  'Colors.imWarning',
    '#FDE047':  'Colors.imWarning',
    '#fde047':  'Colors.imWarning',
    '#FFB300':  'Colors.imWarning',
    '#e6d99c':  'Colors.imWarning',
    # Dark amber TEXT (used on light amber bg)
    '#92400E':  'Colors.imInk',
    '#92400e':  'Colors.imInk',
    '#8c6a1a':  'Colors.imInk',
    '#8C6A1A':  'Colors.imInk',
    '#78350F':  'Colors.imInk',
    '#78350f':  'Colors.imInk',
    '#8A5A00':  'Colors.imInk',
    '#8a5a00':  'Colors.imInk',
    # Pale amber BACKGROUNDS → concrete
    '#FEF3C7':  'Colors.imConcrete',
    '#fef3c7':  'Colors.imConcrete',
    '#FDE68A':  'Colors.imConcrete',
    '#fde68a':  'Colors.imConcrete',
    '#FFFBEB':  'Colors.imConcrete',
    '#fffbeb':  'Colors.imConcrete',
    '#FFF7ED':  'Colors.imConcrete',
    '#fff7ed':  'Colors.imConcrete',
    '#fbf3df':  'Colors.imConcrete',
    '#FBF3DF':  'Colors.imConcrete',
    '#fbeadf':  'Colors.imConcrete',
    '#fed7aa':  'Colors.imConcrete',
    '#FED7AA':  'Colors.imConcrete',

    # Greens / success
    '#15803D':  'Colors.imSuccess',
    '#15803d':  'Colors.imSuccess',
    '#10b981':  'Colors.imSuccess',
    '#10B981':  'Colors.imSuccess',
    '#047857':  'Colors.imSuccess',
    '#22c55e':  'Colors.imSuccess',
    '#22C55E':  'Colors.imSuccess',
    '#1B5E20':  'Colors.imSuccess',
    '#1b5e20':  'Colors.imSuccess',
    '#2E7D32':  'Colors.imSuccess',
    '#2e7d32':  'Colors.imSuccess',
    '#14532D':  'Colors.imSuccess',
    '#14532d':  'Colors.imSuccess',
    '#1f7a3f':  'Colors.imSuccess',
    '#1F7A3F':  'Colors.imSuccess',
    '#065F46':  'Colors.imSuccess',
    '#065f46':  'Colors.imSuccess',
    '#6ee7b7':  'Colors.imSuccess',
    '#6EE7B7':  'Colors.imSuccess',
    '#a7f3d0':  'Colors.imSuccess',
    '#A7F3D0':  'Colors.imSuccess',
    '#16A34A':  'Colors.imSuccess',
    '#16a34a':  'Colors.imSuccess',
    '#059669':  'Colors.imSuccess',
    # Pale green backgrounds → concrete
    '#d1fae5':  'Colors.imConcrete',
    '#D1FAE5':  'Colors.imConcrete',
    '#d8ecdd':  'Colors.imConcrete',
    '#D8ECDD':  'Colors.imConcrete',
    '#ecfdf5':  'Colors.imConcrete',
    '#ECFDF5':  'Colors.imConcrete',
    '#f0fdf4':  'Colors.imConcrete',
    '#F0FDF4':  'Colors.imConcrete',

    # Reds / errors
    '#B91C1C':  'Colors.imError',
    '#b91c1c':  'Colors.imError',
    '#ef4444':  'Colors.imError',
    '#EF4444':  'Colors.imError',
    '#dc2626':  'Colors.imError',
    '#DC2626':  'Colors.imError',
    '#c62828':  'Colors.imError',
    '#C62828':  'Colors.imError',
    '#7F1D1D':  'Colors.imError',
    '#7f1d1d':  'Colors.imError',
    '#8B1414':  'Colors.imError',
    '#8b1414':  'Colors.imError',
    '#8B3A3A':  'Colors.imError',
    '#8b3a3a':  'Colors.imError',
    '#7a1f33':  'Colors.imError',
    '#7A1F33':  'Colors.imError',
    '#E11D48':  'Colors.imError',
    '#e11d48':  'Colors.imError',
    '#9F1239':  'Colors.imError',
    '#9f1239':  'Colors.imError',
    '#fca5a5':  'Colors.imError',
    '#FCA5A5':  'Colors.imError',
    '#991B1B':  'Colors.imError',
    '#991b1b':  'Colors.imError',
    # Pale red backgrounds → concrete
    '#fef2f2':  'Colors.imConcrete',
    '#FEF2F2':  'Colors.imConcrete',
    '#FFF1F2':  'Colors.imConcrete',
    '#fff1f2':  'Colors.imConcrete',
    '#FCE4EC':  'Colors.imConcrete',
    '#fce4ec':  'Colors.imConcrete',
    '#fde2e4':  'Colors.imConcrete',
    '#FDE2E4':  'Colors.imConcrete',
    '#fbe4e7':  'Colors.imConcrete',
    '#FBE4E7':  'Colors.imConcrete',

    # Paneltec brand blues → named token
    '#1e4a8c':  'Colors.paneltecBlue',
    '#1E4A8C':  'Colors.paneltecBlue',
    '#2563EB':  'Colors.paneltecBlue',
    '#2563eb':  'Colors.paneltecBlue',
    '#1E40AF':  'Colors.paneltecBlue',
    '#1e40af':  'Colors.paneltecBlue',
    '#2C6BFF':  'Colors.paneltecBlue',
    '#2c6bff':  'Colors.paneltecBlue',
    '#3B82F6':  'Colors.paneltecBlue',
    '#3b82f6':  'Colors.paneltecBlue',
    # Pale blue backgrounds → concrete
    '#DBEAFE':  'Colors.imConcrete',
    '#dbeafe':  'Colors.imConcrete',
    '#EFF6FF':  'Colors.imConcrete',
    '#eff6ff':  'Colors.imConcrete',
    '#e6eff9':  'Colors.imConcrete',
    '#E6EFF9':  'Colors.imConcrete',

    # Violets / purples → paneltecViolet
    '#7C3AED':  'Colors.paneltecViolet',
    '#7c3aed':  'Colors.paneltecViolet',
    '#8B5CF6':  'Colors.paneltecViolet',
    '#8b5cf6':  'Colors.paneltecViolet',
    '#9333EA':  'Colors.paneltecViolet',
    '#9333ea':  'Colors.paneltecViolet',
    '#6366F1':  'Colors.paneltecViolet',
    '#6366f1':  'Colors.paneltecViolet',
    '#6D28D9':  'Colors.paneltecViolet',
    '#6d28d9':  'Colors.paneltecViolet',
    '#4F3A8C':  'Colors.paneltecViolet',
    '#4f3a8c':  'Colors.paneltecViolet',
    # Pale violet backgrounds → concrete
    '#ece6f4':  'Colors.imConcrete',
    '#ECE6F4':  'Colors.imConcrete',

    # Misc
    '#12345F':  'Colors.imInk',
    '#12345f':  'Colors.imInk',

    # v160.1.2 second-pass sweep — remaining hexes across the app
    # Rose / pink darks → imError
    '#a8324c':  'Colors.imError',
    '#A8324C':  'Colors.imError',
    '#a83a2e':  'Colors.imError',
    '#A83A2E':  'Colors.imError',
    '#F43F5E':  'Colors.imError',
    '#f43f5e':  'Colors.imError',
    '#BE123C':  'Colors.imError',
    '#be123c':  'Colors.imError',
    '#2A0F14':  'Colors.imError',
    '#2a0f14':  'Colors.imError',
    # Pale rose backgrounds → concrete
    '#FECDD3':  'Colors.imConcrete',
    '#fecdd3':  'Colors.imConcrete',
    '#e69aa3':  'Colors.imConcrete',
    '#E69AA3':  'Colors.imConcrete',
    '#fbe4dc':  'Colors.imConcrete',
    '#FBE4DC':  'Colors.imConcrete',

    # Cream / beige / peach → concrete
    '#f7eed1':  'Colors.imConcrete',
    '#F7EED1':  'Colors.imConcrete',
    '#F5EFE0':  'Colors.imConcrete',
    '#f5efe0':  'Colors.imConcrete',
    '#D8CFB8':  'Colors.imBorder',
    '#d8cfb8':  'Colors.imBorder',
    '#f0e6c6':  'Colors.imConcrete',
    '#F0E6C6':  'Colors.imConcrete',
    '#f8d7c3':  'Colors.imConcrete',
    '#F8D7C3':  'Colors.imConcrete',
    '#e9c0a5':  'Colors.imConcrete',
    '#E9C0A5':  'Colors.imConcrete',

    # Green / mint backgrounds & darks
    '#2e5e2e':  'Colors.imSuccess',
    '#2E5E2E':  'Colors.imSuccess',
    '#0F2A1F':  'Colors.imSuccess',
    '#0f2a1f':  'Colors.imSuccess',
    '#34D399':  'Colors.imSuccess',
    '#34d399':  'Colors.imSuccess',
    '#b6dcbf':  'Colors.imConcrete',
    '#B6DCBF':  'Colors.imConcrete',
    '#e8efe2':  'Colors.imConcrete',
    '#E8EFE2':  'Colors.imConcrete',
    '#e8f3eb':  'Colors.imConcrete',
    '#E8F3EB':  'Colors.imConcrete',
    '#BBF7D0':  'Colors.imConcrete',
    '#bbf7d0':  'Colors.imConcrete',

    # Bronze darks / mid oranges
    '#9c4f1a':  'Colors.imBronze',
    '#9C4F1A':  'Colors.imBronze',
    '#FDBA74':  'Colors.imBronze',
    '#fdba74':  'Colors.imBronze',

    # Deep navy / dark surfaces → ink
    '#0B1220':  'Colors.imInk',
    '#0b1220':  'Colors.imInk',
    '#0F1A2A':  'Colors.imInk',
    '#0f1a2a':  'Colors.imInk',

    # Violet accents / pales
    '#6e3aa6':  'Colors.paneltecViolet',
    '#6E3AA6':  'Colors.paneltecViolet',
    '#efe7f7':  'Colors.imConcrete',
    '#EFE7F7':  'Colors.imConcrete',
    '#e2dcef':  'Colors.imConcrete',
    '#E2DCEF':  'Colors.imConcrete',
    '#FAF5FF':  'Colors.imConcrete',
    '#faf5ff':  'Colors.imConcrete',
    '#eef2ff':  'Colors.imConcrete',
    '#EEF2FF':  'Colors.imConcrete',

    # Blues (Paneltec / info)
    '#1D4ED8':  'Colors.paneltecBlue',
    '#1d4ed8':  'Colors.paneltecBlue',
    '#BFDBFE':  'Colors.imConcrete',
    '#bfdbfe':  'Colors.imConcrete',
    '#f0f9ff':  'Colors.imConcrete',
    '#F0F9FF':  'Colors.imConcrete',
}

ROOT = '/app/mobile'
EXTS = ('.ts', '.tsx', '.js', '.jsx')
EXCLUDE_DIRS = {'node_modules', '.expo', '.git', 'ios', 'android', 'dist', 'build'}
EXCLUDE_FILES = {'colors.ts', 'sweep_hex_v160_1_2.py'}

JSX_ATTR = re.compile(
    r'(\s|^)(\w+)=(["\'])(#[0-9A-Fa-f]{3,6})\3'
)
STR_LITERAL = re.compile(
    r'(["\'])(#[0-9A-Fa-f]{3,6})\1'
)

def token_for(h: str) -> str | None:
    return HEX_MAP.get(h) or HEX_MAP.get(h.lower()) or HEX_MAP.get(h.upper())

def process_file(path: str) -> tuple[int, list[str]]:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    unmapped: list[str] = []

    def jsx_repl(m: re.Match) -> str:
        lead, attr, quote, hexv = m.group(1), m.group(2), m.group(3), m.group(4)
        tok = token_for(hexv)
        if not tok:
            unmapped.append(hexv)
            return m.group(0)
        return f'{lead}{attr}={{{tok}}}'
    content = JSX_ATTR.sub(jsx_repl, content)

    def str_repl(m: re.Match) -> str:
        quote, hexv = m.group(1), m.group(2)
        tok = token_for(hexv)
        if not tok:
            unmapped.append(hexv)
            return m.group(0)
        return tok
    content = STR_LITERAL.sub(str_repl, content)

    if content == original:
        return 0, unmapped

    # Ensure Colors is imported
    if 'Colors' not in content:
        pass
    elif re.search(r"import\s+\{[^}]*\bColors\b[^}]*\}\s+from", content) is None:
        # Need to add an import. Compute relative path to /app/mobile/src/lib/colors
        rel = os.path.relpath('/app/mobile/src/lib/colors', os.path.dirname(path))
        # If rel starts with 'lib' (e.g., under /app/mobile/src) prefix with ./
        if not rel.startswith('.'):
            rel = './' + rel
        rel = rel.replace('\\', '/')
        # Insert after the last import line
        import_pattern = re.compile(r'^(import[^\n]*\n)+', re.MULTILINE)
        m = None
        for m in re.finditer(r'^import[^\n]*\n', content, flags=re.MULTILINE):
            pass
        if m:
            insert_at = m.end()
            content = content[:insert_at] + f"import {{ Colors }} from '{rel}';\n" + content[insert_at:]
        else:
            content = f"import {{ Colors }} from '{rel}';\n" + content

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    # Count changes as diff-line count
    return 1, unmapped

def walk() -> None:
    total_files = 0
    changed_files = 0
    all_unmapped: dict[str, int] = {}
    for base in ('app', 'src'):
        for root, dirs, files in os.walk(os.path.join(ROOT, base)):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for fn in files:
                if not fn.endswith(EXTS):
                    continue
                if fn in EXCLUDE_FILES:
                    continue
                path = os.path.join(root, fn)
                total_files += 1
                changed, unmapped = process_file(path)
                changed_files += changed
                for h in unmapped:
                    all_unmapped[h] = all_unmapped.get(h, 0) + 1
    print(f'Scanned {total_files} files, updated {changed_files}.')
    if all_unmapped:
        print('\nUNMAPPED hexes (still inline, need manual attention):')
        for h, n in sorted(all_unmapped.items(), key=lambda kv: -kv[1]):
            print(f'  {n:4d}  {h}')
    else:
        print('All hexes swept to tokens.')

if __name__ == '__main__':
    walk()
