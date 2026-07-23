"""Phase 3.23 — Paneltec Civil 2026 refresh palette.

Single source of truth. Every PDF generator imports from here. No other
file should call `colors.HexColor(...)` directly — if you need a new
swatch, add it here and document why.

**2026 refresh (v160.3.9.9)**: The report brand widened from a 2-colour
ORANGE + SLATE scheme to a warm-cream + Paneltec-navy + coral + mint +
gold-accent scheme. The new palette gives the PDFs a hand-designed feel
(warm paper background, peach section bands, pastel status pills) that
still reads as one product because every generator imports the SAME
tokens. The old ORANGE/SLATE tokens remain exported for the handful of
templates that haven't been refactored yet — they will visually shift
on their next render.
"""
from reportlab.lib import colors

# ──────────────────────────────────────────────────────────────────────
# Phase 3.23 — Primary chrome (used by every new PDF template)
# ──────────────────────────────────────────────────────────────────────
NAVY            = colors.HexColor('#1F3B7A')   # header band, primary chrome
NAVY_INK        = colors.HexColor('#0F1F44')   # deep navy for bold headings on cream
ACCENT_GOLD     = colors.HexColor('#E9782E')   # 2mm accent stripe under header, hairlines
CREAM_PAPER     = colors.HexColor('#FBF6EC')   # page background / alt-row shading
CREAM_ROW       = colors.HexColor('#FFFCF5')   # main table row background
PEACH_BAND      = colors.HexColor('#FBE6CE')   # section-band background
PEACH_INK       = colors.HexColor('#D9782E')   # section-band heading text
WARM_TAN        = colors.HexColor('#EAD9C0')   # footer rule + hairline dividers
BODY_INK        = colors.HexColor('#1F1B16')   # main body text
MUTED_INK       = colors.HexColor('#5A554D')   # sub-lines, footer text, meta

# ──────────────────────────────────────────────────────────────────────
# Phase 3.23 — Status pill palette. Use in preference to the SEV_*
# tokens further down for any user-facing chip on a new report.
# ──────────────────────────────────────────────────────────────────────
MINT_BG         = colors.HexColor('#E1F1E4')   # "Current" pill background
MINT_INK        = colors.HexColor('#2E7D3E')   # "Current" pill text
ROSE_BG         = colors.HexColor('#FADCD8')   # "Expired" pill background
ROSE_INK        = colors.HexColor('#B34037')   # "Expired" pill text
NEUTRAL_BG      = colors.HexColor('#EEEDEA')   # "Not held" pill background
NEUTRAL_INK     = colors.HexColor('#5A554D')   # "Not held" pill text
GOLD_BG         = colors.HexColor('#FFF0D6')   # "Expiring" pill background (warm)
GOLD_INK        = colors.HexColor('#8A5A18')   # "Expiring" pill text

# ──────────────────────────────────────────────────────────────────────
# Phase 3.22 → 3.23 compatibility layer.
#
# The 2026 refresh (v160.3.9.11) collapsed the old ORANGE/SLATE 2-colour
# scheme into the wider warm-cream palette above. Rather than rewrite
# every ReportLab TableStyle in the app, we re-bind the legacy constant
# NAMES to the new tokens so any template that still references e.g.
# `SLATE_BAND` for an alt-row background renders with `CREAM_ROW`
# instead — a cosmetic drift, not a semantic one.
#
# Templates SHOULD migrate to the Phase 3.23 names (NAVY, PEACH_BAND,
# MINT_BG, …) over time; the aliases below are DEPRECATED and will be
# removed once every caller is on the new names.
# ──────────────────────────────────────────────────────────────────────
ORANGE          = ACCENT_GOLD   # DEPRECATED — use ACCENT_GOLD
ORANGE_DEEP     = PEACH_INK     # DEPRECATED — use PEACH_INK
ORANGE_PALE     = PEACH_BAND    # DEPRECATED — use PEACH_BAND
SLATE           = NAVY_INK      # DEPRECATED — use NAVY_INK
SLATE_INK       = BODY_INK      # DEPRECATED — use BODY_INK
SLATE_MUTED     = MUTED_INK     # DEPRECATED — use MUTED_INK
SLATE_BORDER    = WARM_TAN      # DEPRECATED — use WARM_TAN
SLATE_BAND      = CREAM_ROW     # DEPRECATED — use CREAM_ROW
PAPER           = CREAM_PAPER   # DEPRECATED — use CREAM_PAPER

WHITE           = colors.white

# ──────────────────────────────────────────────────────────────────────
# Semantic accents (reserved — use ONLY for genuine warning chips, not
# decoration). Critical = ROSE (Phase 3.23), Warning = GOLD, OK = MINT.
# Legacy SEV_* names retained as aliases for existing chip renderers.
# ──────────────────────────────────────────────────────────────────────
SEV_CRITICAL    = ROSE_INK      # DEPRECATED — use ROSE_INK
SEV_CRITICAL_BG = ROSE_BG       # DEPRECATED — use ROSE_BG
SEV_WARNING     = GOLD_INK      # DEPRECATED — use GOLD_INK
SEV_WARNING_BG  = GOLD_BG       # DEPRECATED — use GOLD_BG
SEV_OK          = MINT_INK      # DEPRECATED — use MINT_INK
SEV_OK_BG       = MINT_BG       # DEPRECATED — use MINT_BG


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
