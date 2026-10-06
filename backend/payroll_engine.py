"""Decimal-based weekly payroll review calculations. No payment or lodgement side effects.

Tax source: Taxation Administration (Withholding Schedules) Instrument 2026,
Schedule 1, scales 1 and 2, effective 2026-07-01. Other tax circumstances
require a reviewed manual withholding amount; never approximate annual tax.
"""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, ROUND_FLOOR

RULE_VERSION = "AU-weekly-2026-07-01-v1"
TAX_SOURCE = "https://www.legislation.gov.au/F2026L00716/asmade/text"
SOURCES = [
    {"label": "ATO weekly PAYG formulas (Schedule 1)", "url": TAX_SOURCE},
    {"label": "Fair Work annual leave", "url": "https://www.fairwork.gov.au/tools-and-resources/fact-sheets/minimum-workplace-entitlements/annual-leave"},
    {"label": "Fair Work personal/carer's leave", "url": "https://www.fairwork.gov.au/tools-and-resources/fact-sheets/minimum-workplace-entitlements/sick-and-carers-leave-and-compassionate-leave"},
    {"label": "ATO Payday Super", "url": "https://www.ato.gov.au/businesses-and-organisations/super-for-employers/payday-super"},
]
SCALES = {
    "resident_threshold": [(362,"0","0"),(538,".1500","54.3462"),(673,".2500","108.2135"),(721,".1700","54.3473"),(865,".1790","60.8377"),(1282,".3227","185.1935"),(2596,".3200","181.7319"),(3653,".3900","363.4627"),(None,".4700","655.7704")],
    "resident_no_threshold": [(188,".1500",".1500"),(371,".2084","11.0185"),(515,".1790",".1066"),(932,".3227","74.1674"),(2246,".3200","71.6508"),(3303,".3900","228.8816"),(None,".4700","493.1893")],
}

def dec(value):
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError("Amounts must be finite")
    return result

def rounded(value, places="0.01"):
    return dec(value).quantize(Decimal(places), rounding=ROUND_HALF_UP)

def weekly_tax(gross, mode, payday):
    if not date(2026, 7, 1) <= date.fromisoformat(str(payday)) < date(2027, 7, 1):
        raise ValueError("PAYG table supports paydays from 1 July 2026 to 30 June 2027; review the table before using another year")
    if mode not in SCALES:
        raise ValueError("Tax declaration needs review or manual PAYG")
    earnings = dec(gross)
    if earnings < 0:
        raise ValueError("Taxable earnings cannot be negative")
    if not earnings:
        return Decimal(0)
    x = earnings.to_integral_value(rounding=ROUND_FLOOR) + Decimal(".99")
    for limit, a, b in SCALES[mode]:
        if limit is None or x < limit:
            return max(Decimal(0), rounded(dec(a)*x-dec(b), "1"))

def next_payday(period_start, weekday=3, lag_weeks=1):
    """Pay on the chosen weekday on/after the seven-day period ends."""
    start = date.fromisoformat(str(period_start))
    end = start + timedelta(days=6)
    return (end + timedelta(days=(weekday-end.weekday()) % 7 + 7*(lag_weeks-1))).isoformat()


def calculate_line(profile, entry, rules, payday):
    """Explicit hours buckets; overtime classification stays subject to award review."""
    issues = []
    rate = dec(profile.get("hourly_rate", 0))
    if rate <= 0:
        issues.append("Enter an hourly rate")
    if not profile.get("conditions_reviewed"):
        issues.append("Confirm award/classification and overtime conditions")
    if profile.get("employment_type", "unconfirmed") == "unconfirmed":
        issues.append("Confirm employment type")
    if profile.get("employment_type") == "contractor":
        issues.append("Contractor tax and super require separate assessment")
    if not entry.get("hours_reviewed"):
        issues.append("Review hours, allowances and leave for this week")
    h = {k: dec(entry.get(k, 0)) for k in ("ordinary", "ot1", "ot2", "annual", "personal", "public_holiday")}
    if any(v < 0 for v in h.values()) or sum(h.values()) > 168:
        raise ValueError("Hours must be non-negative and cannot exceed 168 in one week")
    ordinary_cap = dec(profile.get("ordinary_weekly_hours", 38))
    paid_ordinary = sum(h[k] for k in ("ordinary", "annual", "personal", "public_holiday"))
    if paid_ordinary > ordinary_cap:
        issues.append("Ordinary and paid-leave hours exceed the employee's weekly ordinary hours")
    casual = profile.get("employment_type") in ("casual", "contractor")
    if casual and (h["annual"] or h["personal"]):
        issues.append("Casual/contractor paid annual or personal leave requires review")
    earnings = {
        "ordinary_pay": rounded(h["ordinary"]*rate),
        "ot1_pay": rounded(h["ot1"]*rate*dec(rules["ot1_multiplier"])),
        "ot2_pay": rounded(h["ot2"]*rate*dec(rules["ot2_multiplier"])),
        "annual_pay": rounded(h["annual"]*rate),
        "personal_pay": rounded(h["personal"]*rate),
        "public_holiday_pay": rounded(h["public_holiday"]*rate),
        "leave_loading": rounded(h["annual"]*rate*dec(profile.get("leave_loading_percent", 0))/100),
        "taxable_allowances": rounded(entry.get("taxable_allowances", 0)),
    }
    gross = sum(earnings.values())
    deductions = rounded(entry.get("post_tax_deductions", 0))
    reimbursements = rounded(entry.get("reimbursements", 0))
    tax = None
    if profile.get("tax_mode") == "manual":
        if entry.get("manual_payg") is None or not entry.get("payg_reference", "").strip():
            issues.append("Enter reviewed PAYG and its calculation reference")
        else:
            tax = rounded(entry["manual_payg"])
    elif not profile.get("tax_declaration_reviewed"):
        issues.append("Confirm tax declaration; HELP, variations and special payments use manual PAYG")
    else:
        try:
            tax = weekly_tax(gross, profile.get("tax_mode"), payday)
        except ValueError as exc:
            issues.append(str(exc))
    if tax is not None:
        tax += rounded(entry.get("extra_withholding", 0))
        if tax > gross or tax + deductions > gross + reimbursements:
            issues.append("Withholding and deductions exceed available pay")
    net = None if tax is None else rounded(gross-tax-deductions+reimbursements)
    # QE must be reviewed explicitly: eligibility, salary sacrifice, loading,
    # allowances and the annual contribution base cannot be inferred from hours.
    qe = entry.get("qualifying_earnings")
    super_amount = None
    if qe is None or not entry.get("super_reviewed"):
        issues.append("Review super eligibility, qualifying earnings and contribution cap")
    else:
        super_amount = rounded(dec(qe)*dec(rules["super_percent"])/100)
    accrue = paid_ordinary if not casual else Decimal(0)
    annual_accrued = rounded(accrue*dec(profile.get("annual_weeks", 4))/52, "0.000001")
    personal_accrued = rounded(accrue*dec(profile.get("personal_weeks", 2))/52, "0.000001")
    balances = {}
    for kind, earned in (("annual", annual_accrued),("personal", personal_accrued)):
        opening = entry.get(f"opening_{kind}")
        if opening is None:
            balances[f"{kind}_closing"] = None
            if not casual:
                issues.append(f"Enter {kind} opening hours as at this period start")
        else:
            closing = dec(opening)+earned-h[kind]
            balances[f"{kind}_closing"] = float(rounded(closing, "0.000001"))
            if closing < 0:
                issues.append(f"{kind.title()} leave balance would be negative")
    annual_value = None if balances["annual_closing"] is None else rounded(dec(balances["annual_closing"])*rate)
    return {**{k:float(v) for k,v in earnings.items()}, **balances,
            "gross":float(rounded(gross)), "payg":None if tax is None else float(tax),
            "net":None if net is None else float(net), "super":None if super_amount is None else float(super_amount),
            "annual_accrued":float(annual_accrued), "personal_accrued":float(personal_accrued),
            "annual_base_value":None if annual_value is None else float(annual_value),
            "reimbursements":float(reimbursements), "deductions":float(deductions),
            "issues":issues, "review_ready":not issues}
