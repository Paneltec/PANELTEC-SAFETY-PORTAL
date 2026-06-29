"""Phase 3.22 — Paneltec Civil 2-colour PDF brand palette.

Single source of truth. Every PDF generator imports from here. No other
file should call `colors.HexColor(...)` directly — if you need a new
swatch, add it here and document why.

Two-colour scheme: ORANGE (#F97316) + SLATE (#1E293B). Every other tone
in the report is a grayscale derived from those two. No cobalt blue, no
violet, no mint — those were the old brand and they made every report
look like a different product.
"""
from reportlab.lib import colors

# ──────────────────────────────────────────────────────────────────────
# Core palette
# ──────────────────────────────────────────────────────────────────────
ORANGE          = colors.HexColor('#F97316')   # primary accent
ORANGE_DEEP     = colors.HexColor('#C2410C')   # for chip text on pale orange bg
ORANGE_PALE     = colors.HexColor('#FFF7ED')   # chip backgrounds

SLATE           = colors.HexColor('#1E293B')   # headings, strong body text
SLATE_INK       = colors.HexColor('#0F172A')   # absolute black-equivalent for body
SLATE_MUTED     = colors.HexColor('#64748B')   # captions, meta text
SLATE_BORDER    = colors.HexColor('#E2E8F0')   # field grid lines, dividers
SLATE_BAND      = colors.HexColor('#F8FAFC')   # alternating row background
PAPER           = colors.HexColor('#FAFAFA')   # ultra-light card backgrounds

WHITE           = colors.white

# ──────────────────────────────────────────────────────────────────────
# Semantic accents (reserved — use ONLY for genuine warning chips, not
# decoration). Critical = red, Warning = orange (reuses brand), OK = a
# muted slate. Anything beyond these three is a brand violation.
# ──────────────────────────────────────────────────────────────────────
SEV_CRITICAL    = colors.HexColor('#DC2626')   # criticals, blockers
SEV_CRITICAL_BG = colors.HexColor('#FEE2E2')
SEV_WARNING     = ORANGE                       # medium/high severity
SEV_WARNING_BG  = ORANGE_PALE
SEV_OK          = SLATE_MUTED                  # low/info/resolved
SEV_OK_BG       = SLATE_BAND


def severity_palette(severity: str | None) -> tuple:
    """Return (fg, bg) tuple for a severity chip. Defaults to OK tones."""
    s = (severity or '').lower().strip()
    if s in {'critical', 'high', 'overdue', 'rejected', 'fail', 'failed'}:
        return (SEV_CRITICAL, SEV_CRITICAL_BG)
    if s in {'medium', 'warning', 'watch', 'changes_requested', 'in_review', 'review'}:
        return (SEV_WARNING, SEV_WARNING_BG)
    if s in {'low', 'info', 'resolved', 'closed', 'complete', 'approved', 'pass', 'passed'}:
        return (SEV_OK, SEV_OK_BG)
    return (SLATE_MUTED, SLATE_BAND)
