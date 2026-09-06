# v58.13.122b — Dry-run diff report

Generated: 2026-09-05T07:24:58.126642+00:00

**No writes performed.** Re-run with `--apply` after the user green-lights this diff.

## Would-write counts

- Would write **km only**: 665
- Would write **hours only**: 17
- Would write **both**: 0
- Would **skip · low confidence** (parseable but ambiguous): 0
- Would **skip · implausible** (>2,000,000 km / >100,000 hrs): 7
- Would touch **682 rows** total.

## First 50 proposed rows

| _id | rego | kind | reading | current_km | current_hrs | → km | → hrs | conf | reason |
|-----|------|------|---------|-----------:|------------:|-----:|------:|:----:|--------|
| `6a6d65e8…` | XT96AZ | vehicle | `6,326.00` | — | — | 6326 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | I25RE | vehicle | `149,497.00` | — | — | 149497 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT48AK | vehicle | `116,758.00` | — | — | 116758 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT36DO | vehicle | `24,040.00` | — | — | 24040 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT35DO | vehicle | `24,295.00` | — | — | 24295 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | J46QW | vehicle | `63,444.00` | — | — | 63444 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | D67YQ | vehicle | `138,563.00` | — | — | 138563 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | L10QF | vehicle | `46,500.00` | — | — | 46500 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | L08QF | vehicle | `29,579.00` | — | — | 29579 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | K54JU | vehicle | `47,343.00` | — | — | 47343 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | D67YQ | vehicle | `138,563.00` | — | — | 138563 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | K68JF | vehicle | `129,735.00` | — | — | 129735 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT44DL | vehicle | `34,903.00` | — | — | 34903 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | I26RE | vehicle | `137,877.00` | — | — | 137877 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT04CS | vehicle | `53,096.00` | — | — | 53096 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT02AX | vehicle | `123,281.00` | — | — | 123281 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT42BN | vehicle | `87,962.00` | — | — | 87962 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | J46QW | vehicle | `63,444.00` | — | — | 63444 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT26AR | vehicle | `153,665.00` | — | — | 153665 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | H89MY | vehicle | `110,223.00` | — | — | 110223 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | K39JZ | vehicle | `119,043.00` | — | — | 119043 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | K86NY | vehicle | `102,386.00` | — | — | 102386 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | L07QF | vehicle | `29,397.00` | — | — | 29397 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT77AJ | vehicle | `75,875.00` | — | — | 75875 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | J45AL | vehicle | `65,579.00` | — | — | 65579 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT96AZ | vehicle | `6,326.00` | — | — | 6326 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | XT96AZ | vehicle | `6,326.00` | — | — | 6326 | — | medium | bare_km kind=vehicle |
| `6a6d65e8…` | L07QF | vehicle | `29,397.00` | — | — | 29397 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | K76KT | vehicle | `99,478.00` | — | — | 99478 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | K54JU | vehicle | `47,343.00` | — | — | 47343 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | M02HZ | vehicle | `13,737.00` | — | — | 13737 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | XT42BN | vehicle | `87,962.00` | — | — | 87962 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | XT44DL | vehicle | `34,903.00` | — | — | 34903 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | XT30DK | vehicle | `13,027.00` | — | — | 13027 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | XT29DK | vehicle | `13,173.00` | — | — | 13173 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | I26RE | vehicle | `137,877.00` | — | — | 137877 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | XT48AK | vehicle | `116,758.00` | — | — | 116758 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | I28RE | vehicle | `155,077.00` | — | — | 155077 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | C43ZW | vehicle | `125,115.00` | — | — | 125115 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | L09QF | vehicle | `25,036.00` | — | — | 25036 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | J46QW | vehicle | `63,444.00` | — | — | 63444 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | D03RF | vehicle | `184,685.00` | — | — | 184685 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | D05RF | vehicle | `190,075.00` | — | — | 190075 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | I28RE | vehicle | `155,077.00` | — | — | 155077 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | H00PU | vehicle | `143,112.00` | — | — | 143112 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | L09QF | vehicle | `25,036.00` | — | — | 25036 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | L07QF | vehicle | `29,397.00` | — | — | 29397 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | XT44DL | vehicle | `34,903.00` | — | — | 34903 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | L07QF | vehicle | `29,397.00` | — | — | 29397 | — | medium | bare_km kind=vehicle |
| `6a6d65e9…` | K39JZ | vehicle | `119,043.00` | — | — | 119043 | — | medium | bare_km kind=vehicle |

_(+ 632 more rows omitted for brevity — full log lands in `apply_log.md`.)_
