# v58.13.122b — Pattern discovery report

Generated: 2026-09-05T07:39:30.670843+00:00

## Overview

- Total rows scanned: **689**
- Parseable KM: **665**
- Parseable hours: **17**
- Both extractable: **0**
- Unparseable: **7**
- Asset-kind heuristic fired on: **682** rows

## Asset kind distribution (via `registration_no` → `assets.rego_serial`)

- `plant`: 17
- `vehicle`: 667
- `trailer`: 5
- `unknown`: 0

## Top-30 `latest_usage_reading` strings

| # | Count | Reading |
|---|-------|---------|
| 1 | 27 | `11,043.00` |
| 2 | 23 | `189,517.00` |
| 3 | 22 | `116,758.00` |
| 4 | 22 | `190,075.00` |
| 5 | 21 | `149,497.00` |
| 6 | 21 | `184,685.00` |
| 7 | 20 | `193,694.00` |
| 8 | 19 | `6,326.00` |
| 9 | 18 | `138,563.00` |
| 10 | 18 | `123,281.00` |
| 11 | 18 | `155,077.00` |
| 12 | 18 | `145,837.00` |
| 13 | 17 | `143,112.00` |
| 14 | 16 | `129,735.00` |
| 15 | 16 | `102,386.00` |
| 16 | 16 | `222,854.00` |
| 17 | 16 | `296,174.00` |
| 18 | 15 | `137,877.00` |
| 19 | 15 | `87,962.00` |
| 20 | 14 | `153,665.00` |
| 21 | 14 | `119,043.00` |
| 22 | 14 | `120,329.00` |
| 23 | 14 | `310,604.00` |
| 24 | 11 | `127,409.00` |
| 25 | 11 | `99,235.00` |
| 26 | 11 | `158,000.00` |
| 27 | 10 | `63,444.00` |
| 28 | 10 | `110,223.00` |
| 29 | 10 | `125,115.00` |
| 30 | 10 | `44,753.00` |

## Unparseable samples (up to 20)

| _id | Reading | Kind | Reason |
|-----|---------|------|--------|
| `6a6d65e97c9931ca73130331` | `6,362,349.00` | vehicle | bare_implausible_km kind=vehicle v=6362349.0 |
| `6a6d65e97c9931ca73130337` | `6,362,349.00` | vehicle | bare_implausible_km kind=vehicle v=6362349.0 |
| `6a6d65e97c9931ca731306ed` | `6,362,349.00` | vehicle | bare_implausible_km kind=vehicle v=6362349.0 |
| `6a6d65e97c9931ca73130743` | `6,362,349.00` | vehicle | bare_implausible_km kind=vehicle v=6362349.0 |
| `6a6d65e97c9931ca731307c5` | `6,362,349.00` | vehicle | bare_implausible_km kind=vehicle v=6362349.0 |
| `6a6d65e97c9931ca7313083b` | `6,362,349.00` | vehicle | bare_implausible_km kind=vehicle v=6362349.0 |
| `6a6d65e97c9931ca731308cd` | `6,362,349.00` | vehicle | bare_implausible_km kind=vehicle v=6362349.0 |
