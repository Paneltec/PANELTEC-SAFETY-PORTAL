"""Decimal-based weekly payroll review calculations. No payment or lodgement side effects.

Tax source: Taxation Administration (Withholding Schedules) Instrument 2026,
Schedule 1, scales 1 and 2, effective 2026-07-01. Other tax circumstances
require a reviewed manual withholding amount; never approximate annual tax.
"""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, ROUND_FLOOR

RULE_VERSION = "AU-weekly-2026-07-01-v4"
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
    if profile.get("pay_basis") == "annual_salary":
        salary = dec(profile.get("annual_salary", 0))
        weekly_hours = dec(profile.get("ordinary_weekly_hours", 0))
        if salary <= 0 or weekly_hours <= 0:
            raise ValueError("Annual salary and ordinary weekly hours must be positive")
        rate = salary / 52 / weekly_hours
    casual_rates=profile.get("casual_rates") if profile.get("employment_type")=="casual" else None
    if casual_rates is not None:
        rate=dec(casual_rates['base_rate'])*(1+dec(casual_rates['loading_percent'])/100)
    rates={"ordinary":rate}
    for key,multiplier in (("ot1","ot1_multiplier"),("ot2","ot2_multiplier"),("night","night_multiplier"),("holiday_work","holiday_work_multiplier")):
        override=casual_rates.get(key) if casual_rates else None
        rates[key]=dec(override) if override is not None else rate*dec(rules.get(multiplier,2.5 if key=="holiday_work" else 2))
    rates["saturday"]=rates["ot1"]
    rates["sunday"]=rates["ot2"]
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
    h = {k: dec(entry.get(k, 0)) for k in ("ordinary", "ot1", "ot2", "saturday", "sunday", "annual", "personal", "public_holiday", "night", "holiday_work")}
    if any(v < 0 for v in h.values()) or sum(h.values()) > 168:
        raise ValueError("Hours must be non-negative and cannot exceed 168 in one week")
    ordinary_cap = dec(profile.get("ordinary_weekly_hours", 38))
    paid_ordinary = sum(h[k] for k in ("ordinary", "annual", "personal", "public_holiday"))
    penalty_ordinary=dec(entry.get("penalty_ordinary",0))
    if penalty_ordinary<0 or penalty_ordinary>h["night"]+h["holiday_work"]:
        raise ValueError("Leave-accruing penalty hours must be within night/public-holiday worked hours")
    paid_ordinary+=penalty_ordinary
    if paid_ordinary > ordinary_cap:
        issues.append("Ordinary and paid-leave hours exceed the employee's weekly ordinary hours")
    casual = profile.get("employment_type") in ("casual", "contractor")
    if casual and (h["annual"] or h["personal"]):
        issues.append("Casual/contractor paid annual or personal leave requires review")
    earnings = {
        "ordinary_pay": rounded(h["ordinary"]*rate),
        "ot1_pay": rounded(h["ot1"]*rates["ot1"]),
        "ot2_pay": rounded(h["ot2"]*rates["ot2"]),
        "saturday_pay": rounded(h["saturday"]*rates["saturday"]),
        "sunday_pay": rounded(h["sunday"]*rates["sunday"]),
        "lafha_pay": rounded(entry.get("lafha",0)),
        "annual_pay": rounded(h["annual"]*rate),
        "personal_pay": rounded(h["personal"]*rate),
        "public_holiday_pay": rounded(h["public_holiday"]*rate),
        "leave_loading": rounded(h["annual"]*rate*dec(profile.get("leave_loading_percent", 0))/100),
        "taxable_allowances": rounded(entry.get("taxable_allowances", 0)),
    }
    earnings["night_pay"]=rounded(h["night"]*rates["night"])
    earnings["holiday_work_pay"]=rounded(h["holiday_work"]*rates["holiday_work"])
    meal_count=int(entry.get("meal_count",0))
    meal_rate=rules.get("meal_allowance")
    if meal_count and meal_rate is None:issues.append("Set the meal allowance amount in calculation settings")
    earnings["meal_allowance_pay"]=rounded(meal_count*dec(meal_rate or 0))
    allowance_lines=[]
    definitions={a['code']:a for a in profile.get('allowance_rates',[])}
    for code,units in entry.get('allowance_units',{}).items():
        if code not in definitions:
            if dec(units):raise ValueError("Unknown allowance rate; refresh employee settings")
            continue
        if dec(units)<0:raise ValueError("Allowance units cannot be negative")
        definition=definitions[code];amount=rounded(dec(units)*dec(definition['rate']))
        allowance_lines.append({**definition,'units':float(units),'amount':float(amount)})
    earnings['configured_allowances']=sum((dec(a['amount']) for a in allowance_lines),Decimal(0))
    earning_lines=[]
    earning_rules={r['code']:r for r in rules.get('earning_rules',[])}
    for code,units in entry.get('earning_units',{}).items():
        if code not in earning_rules:
            if dec(units):raise ValueError("Configure the earning category before entering units")
            continue
        if dec(units)<0:raise ValueError("Earning units cannot be negative")
        definition=earning_rules[code]
        if definition.get('taxable') is None or definition.get('superable') is None:
            if dec(units):raise ValueError("Choose tax and super treatment for the earning category in Pay settings")
            continue
        unit_rate=(rate if definition['basis']=='base_rate' else dec(definition['rate']))*dec(definition['multiplier'])
        amount=rounded(dec(units)*unit_rate)
        earning_lines.append({**definition,'units':float(units),'unit_rate':float(unit_rate),'amount':float(amount)})
    earnings['other_earnings']=sum((dec(v['amount']) for v in earning_lines),Decimal(0))
    gross = sum(earnings.values())
    meal_tax=rules.get("meal_tax_treatment","unconfirmed")
    if meal_count and meal_tax=="unconfirmed":issues.append("Confirm meal allowance tax treatment in calculation settings")
    taxable_gross=gross-(earnings["meal_allowance_pay"] if meal_tax=="exempt" else 0)
    taxable_gross-=sum((dec(v['amount']) for v in earning_lines if not v['taxable']),Decimal(0))
    if entry.get("lafha_taxable") is False:taxable_gross-=earnings["lafha_pay"]
    deductions = rounded(entry.get("post_tax_deductions", 0))
    reimbursements = rounded(entry.get("reimbursements", 0))
    tax = None
    if not profile.get("tax_declaration_reviewed"):
        issues.append("Confirm tax declaration; HELP, variations and special payments use manual PAYG")
    elif profile.get("tax_mode") == "manual":
        if entry.get("manual_payg") is None or not entry.get("payg_reference", "").strip():
            issues.append("Enter reviewed PAYG and its calculation reference")
        else:
            tax = rounded(entry["manual_payg"])
    else:
        try:
            tax = weekly_tax(taxable_gross, profile.get("tax_mode"), payday)
        except ValueError as exc:
            issues.append(str(exc))
    if tax is not None:
        tax += rounded(entry.get("extra_withholding", 0))
        if tax > gross or tax + deductions > gross + reimbursements:
            issues.append("Withholding and deductions exceed available pay")
    if earnings["lafha_pay"] and entry.get("lafha_taxable") is None:
        issues.append("Confirm LAFHA tax treatment")
        tax=None
    if meal_count and (meal_rate is None or meal_tax=="unconfirmed"):tax=None
    net = None if tax is None else rounded(gross-tax-deductions+reimbursements)
    # A stored amount remains an explicit override. Otherwise derive QE from
    # supported ordinary earnings, never from gross (which includes overtime).
    qe = entry.get("qualifying_earnings")
    super_mode = "manual" if qe is not None else "automatic"
    super_issues = []
    if qe is None:
        qe = sum(earnings[k] for k in ("ordinary_pay", "annual_pay", "personal_pay", "public_holiday_pay", "leave_loading"))
        qe+=sum((dec(v['amount']) for v in earning_lines if v['superable']),Decimal(0))
        if entry.get("lafha_superable") is True:qe+=earnings["lafha_pay"]
        if earnings["lafha_pay"] and entry.get("lafha_superable") is None:super_issues.append("Confirm LAFHA super treatment")
        penalty_hours = h["night"] + h["holiday_work"]
        if penalty_ordinary == penalty_hours:
            qe += earnings["night_pay"] + earnings["holiday_work_pay"]
        elif penalty_ordinary:
            super_issues.append("Confirm qualifying earnings for mixed ordinary and overtime penalty hours")
        if earnings["taxable_allowances"] or earnings["configured_allowances"] or earnings["meal_allowance_pay"]:
            super_issues.append("Confirm qualifying earnings including the super treatment of allowances")
        if profile.get("employment_type", "unconfirmed") in ("contractor", "unconfirmed"):
            super_issues.append("Confirm super eligibility and qualifying earnings")
    # Display the calculated amount while reviewing, without silently approving
    # eligibility, leave-loading exceptions or the contribution cap.
    super_amount = None if super_issues else rounded(dec(qe)*dec(rules["super_percent"])/100)
    issues.extend(super_issues)
    if not entry.get("super_reviewed"):
        issues.append("Review super eligibility, qualifying earnings and contribution cap")
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
            "applied_rates":{k:float(v) for k,v in rates.items()}, "allowance_lines":allowance_lines, "earning_lines":earning_lines,
            "gross":float(rounded(gross)), "payg":None if tax is None else float(tax),
            "net":None if net is None else float(net), "super":None if super_amount is None else float(super_amount),
            "super_mode":super_mode, "super_issues":super_issues, "qualifying_earnings":None if super_issues else float(rounded(qe)),
            "annual_accrued":float(annual_accrued), "personal_accrued":float(personal_accrued),
            "annual_base_value":None if annual_value is None else float(annual_value),
            "reimbursements":float(reimbursements), "deductions":float(deductions),
            "issues":issues, "review_ready":not issues}
