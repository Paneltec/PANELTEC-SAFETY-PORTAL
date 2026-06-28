"""Unit tests for the lenient induction date parser (Phase 3.11)."""
from workers_inductions import parse_messy_date


def assert_eq(name, got, want):
    ok = got == want
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        print(f"      got : {got}")
        print(f"      want: {want}")
    return ok


def main() -> int:
    failures = 0
    print("parse_messy_date — 10 canonical cases (high · medium · low · unparseable):")

    # 1. Clean ISO — high
    r = parse_messy_date("2024-06-15")
    failures += not assert_eq("ISO 2024-06-15", (r["date"], r["confidence"]), ("2024-06-15", "high"))

    # 2. AU full year DD/MM/YYYY — high
    r = parse_messy_date("10/9/2020")
    failures += not assert_eq("AU 10/9/2020 → 2020-09-10", (r["date"], r["confidence"]), ("2020-09-10", "high"))

    # 3. With "Issued" label — high
    r = parse_messy_date("Issued 10/9/2020")
    failures += not assert_eq("Issued 10/9/2020", (r["date"], r["confidence"]), ("2020-09-10", "high"))

    # 4. AU 2-digit year DD/MM/YY — medium
    r = parse_messy_date("Exp 06/06/24")
    failures += not assert_eq("Exp 06/06/24 → 2024-06-06", (r["date"], r["confidence"]), ("2024-06-06", "medium"))

    # 5. Month-only "Exp 06/24" — low (ambiguous, no silent guess)
    r = parse_messy_date("Exp 06/24")
    failures += not assert_eq("Exp 06/24 → low/ambiguous", (r["date"], r["confidence"], r["reason"]),
                              (None, "low", "ambiguous_month_only"))

    # 6. "5/24" — low (no silent guess)
    r = parse_messy_date("5/24")
    failures += not assert_eq("5/24 → low", (r["date"], r["confidence"], r["reason"]),
                              (None, "low", "ambiguous_month_only"))

    # 7. Typo "10/1124" — low with reason
    r = parse_messy_date("10/1124")
    failures += not assert_eq("10/1124 → low/typo", (r["confidence"], r["reason"]),
                              ("low", "typo_concatenated_year"))

    # 8. Impossible "23/22/24" — unparseable (month=22 invalid)
    r = parse_messy_date("23/22/24")
    failures += not assert_eq("23/22/24 → impossible", (r["date"], r["confidence"], r["reason"]),
                              (None, "unparseable", "impossible_value"))

    # 9. Yes/Y short answers — held, no date
    r = parse_messy_date("YES")
    failures += not assert_eq("YES → held", (r["date"], r["confidence"], r.get("held")),
                              (None, "medium", True))

    # 10. N — not held
    r = parse_messy_date("N")
    failures += not assert_eq("N → not_held", (r["date"], r["confidence"], r.get("not_held")),
                              (None, "high", True))

    print()
    if failures:
        print(f"FAIL — {failures} case(s) failed")
        return 1
    print("OK — 10/10 cases passed (no silent best-guesses)")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
