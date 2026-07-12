# v160.3.4 — Simpro ZIP Re-Dry-Run (Auto-Taxonomy Preview)
**Generated**: 2026-07-12T02:53:15.909710+00:00
**Org**: `3116f250-a4eb-43f3-98a5-2a3656d6cb63`
**ZIPs scanned**: 5 — ['z0.zip', 'z1.zip', 'z2.zip', 'z3.zip', 'z4.zip']
**Mode**: READ-ONLY dry-run · **NO writes** to Mongo, GridFS or Simpro.
---
## Executive summary
| Metric | Before (v160.3.3) | After auto-accept (v160.3.4) |
|---|---:|---:|
| Total files across 5 ZIPs | 338 | 338 |
| Matched to a cert_kind | 227 | 307 |
| Unmatched | **111** | **31** |
| Coverage % | 67.2% | **90.8%** |
| Would-create new cert_kinds | 0 | **66** |
| Routed to existing (fuzzy hit ≥ 0.80) | 0 | 6 |

---
## Per-ZIP breakdown
| ZIP | Worker | Score | Total | Attach | Create | HR | Unmatched |
|---|---|---:|---:|---:|---:|---:|---:|
| `z0.zip` | DANIEL BUTLER | 0.90 | 120 | 0 | 70 | 9 | 40 |
| `z1.zip` | AARON FOSTER | 0.90 | 19 | 2 | 3 | 6 | 7 |
| `z2.zip` | AARON HOLMES | 0.90 | 43 | 0 | 18 | 10 | 13 |
| `z3.zip` | ALEXANDER KINGSTON | 1.10 | 141 | 0 | 64 | 26 | 50 |
| `z4.zip` | AMANDA GUY | 0.90 | 15 | 0 | 12 | 1 | 1 |

---
## Proposed new cert_kinds (auto-accept default candidates)
Rows with `auto_accept_default: true` (count ≥ 3 OR confidence ≥ 0.85) would be checked by default in the UI.

| Suggested slug | Label | Files | Confidence | Auto-accept default | Sample filenames |
|---|---|---:|---:|:---:|---|
| `petuna` | Petuna | 6 | 0.55 | ✅ | `Petuna Induction - DB - EXP 28 05 2027.pdf`, `PETUNA INDUCTION - DANIEL BUTLER - EXP14 09 2024.pdf`, `Petuna Induction - DB - EXP 16 09 2025.pdf` |
| `tasrail-track-safety` | Tasrail Track Safety | 4 | 0.90 | ✅ | `TasRail Track Safety - DB - EXP 26 03 2027.pdf`, `TASRAIL INDUCTION (TRACK SAFETY) - DANIEL BUTLER - EXP14 04 2025.pdf`, `TasRail Track Safety - AF - EXP 23 03 2028.pdf` |
| `george-town` | George Town | 3 | 0.85 | ✅ | `George Town Induction - DB - EXP 05 06 2028.pdf`, `George Town Induction - AH - EXP 05 06 2028.pdf`, `George Town Induction - AK - EXP 05 06 2028.pdf` |
| `taswater-loto` | Taswater Loto | 3 | 0.85 | ✅ | `TasWater LOTO - DB - EXP 08 10 2027.pdf`, `TasWater LOTO - AF - EXP 23 03 2028.pdf`, `TasWater LOTO - AK - EXP 04 06 2027.pdf` |
| `graymont` | Graymont | 3 | 0.55 | — | `Graymont Induction - AH - EXP 21 10 2027.pdf`, `Graymont Induction - AK - EXP 01 04 2026.pdf`, `GRAYMONT INDUCTION - ALEXANDER KINGSTON - EXP02 05 2023.pdf` |
| `timberlink` | Timberlink | 3 | 0.55 | — | `Timberlink Induction - AH - EXP 03 04 2026.pdf`, `Timberlink Induction - AK - EXP 27 11 2026.pdf`, `Timberlink - AK - EXP 07 11 2025.pdf` |
| `child-safety-and-wellbeing` | Child Safety And Wellbeing | 2 | 0.85 | ✅ | `Child Safety and Wellbeing - DB - EXP 14 05 2026.pdf`, `Child Safety and Wellbeing - DB - EXP 14 05 2026(1).pdf` |
| `heavy-vehicle-knowledge-test` | Heavy Vehicle Knowledge Test | 2 | 0.85 | ✅ | `Heavy Vehicle Knowledge Test - Daniel Butler - ISS 10 06 2017.pdf`, `Heavy Vehicle Knowledge Test - Alexander Kingston - EXP 08 04 2025.pdf` |
| `opal` | Opal | 2 | 0.55 | — | `OPAL INDUCTION - DANIEL BUTLER - EXP10 12 2023.pdf`, `Opal Induction -Daniel_Butler_Exp - 17 06 2021.pdf` |
| `liberty-bell-bay` | Liberty Bell Bay | 2 | 0.90 | ✅ | `Liberty Bell Bay Induction - AK - EXP 17 06 2028.pdf`, `Liberty Bell Bay Induction - Alexander Kingston - Exp 16 12 2023.pdf` |
| `graymont-alex` | Graymont Alex | 2 | 0.85 | ✅ | `GRAYMONT INDUCTION - ALEX KINGSTON - EXP14 04 2024.pdf`, `GRAYMONT INDUCTION - ALEX KINGSTON - EXP22 04 2025.pdf` |
| `petuna-alex` | Petuna Alex | 2 | 0.85 | ✅ | `PETUNA INDUCTION - ALEX KINGSTON - EXP18 04 2025.pdf`, `PETUNA INDUCTION - ALEX KINGSTON - EXP20 04 2024.pdf` |
| `load-and-unload` | Load And Unload | 1 | 0.90 | ✅ | `Butler_Daniel_RII30820_8865279 load and unload.pdf` |
| `follow-whs-pocedures` | Follow Whs Pocedures | 1 | 0.90 | ✅ | `Follow_WHS_Pocedures.pdf` |
| `load-unload-plant` | Load Unload Plant | 1 | 0.90 | ✅ | `Load & Unload Plant - Daniel Butler - EXP 04 03 2027.pdf` |
| `timberlink-dec` | Timberlink Dec | 1 | 0.85 | ✅ | `TimberLink-Dec-2019.pdf` |
| `fulton-hogan` | Fulton Hogan | 1 | 0.85 | ✅ | `DANIEL BUTLER - FULTON HOGAN - ISS04 11 2022.pdf` |
| `fulton-hogan-construction-southern` | Fulton Hogan Construction Southern | 1 | 0.85 | ✅ | `FULTON HOGAN  CONSTRUCTION (SOUTHERN HSE INDUCTION - DANIEL BUTLER - ISS11 11 22.pdf` |
| `fulton-hogan-general` | Fulton Hogan General | 1 | 0.90 | ✅ | `FULTON HOGAN GENERAL HSE INDUCTION - DANIEL BUTLER - ISS 11 11 2022.pdf` |
| `department-of-health` | Department Of Health | 1 | 0.90 | ✅ | `Department of Health Induction - DB - EXP 14 05 2026.pdf` |
| `opal-general` | Opal General | 1 | 0.85 | ✅ | `OPAL GENERAL INDUCTION - DANIEL BUTLER - EXP02 08 2025.pdf` |
| `taswater-loto-awareness` | Taswater Loto Awareness | 1 | 0.90 | ✅ | `TASWATER LOTO AWARENESS INDUCTION - DANIEL BUTLER - EXP30 10 2025.pdf` |
| `trility-general` | Trility General | 1 | 0.85 | ✅ | `Trility General DB-10-12-2021.pdf` |
| `trility-general-site` | Trility General Site | 1 | 0.90 | ✅ | `TRILITY_General_Site_Induction - Daniel Butler - Iss04 05 2023.pdf` |
| `trility-treatment-plant` | Trility Treatment Plant | 1 | 0.90 | ✅ | `Trility Treatment Plant-DB-10-12-2021.pdf` |
| `optus` | Optus | 1 | 0.55 | — | `Optus 2017- Daniel Butler.pdf` |
| `orora` | Orora | 1 | 0.55 | — | `Orora Induction - DDB-17 06 2019.pdf` |
| `tc` | Tc | 1 | 0.55 | — | `Daniel B TC Ticket -2017.pdf` |
| `traffic` | Traffic | 1 | 0.55 | — | `Traffic - DB -28 04 2020.pdf` |
| `meander-valley` | Meander Valley | 1 | 0.85 | ✅ | `Meander Valley Induction - JF - EXP 23 03 2027.pdf` |
| `hardings` | Hardings | 1 | 0.55 | — | `Hardings Induction - AF - EXP 23 03 2028.pdf` |
| `class` | Class | 1 | 0.55 | — | `Class C Licence - AF - EXP 29 04 2027.pdf` |
| `burnie-bulk-aholmes` | Burnie Bulk Aholmes | 1 | 0.90 | ✅ | `Burnie Bulk Induction - AHolmes - EXP 15 10 2026.pdf` |
| `east-tamar-site-aholmes` | East Tamar Site Aholmes | 1 | 0.85 | ✅ | `East Tamar Site Induction - AHolmes - EXP 15 10 2026.pdf` |
| `tasrail-aholmes` | Tasrail Aholmes | 1 | 0.85 | ✅ | `TasRail Induction - AHolmes - EXP 15 10 2026.pdf` |
| `taswater-loto-aholmes` | Taswater Loto Aholmes | 1 | 0.90 | ✅ | `TasWater LOTO - AHolmes - EXP 14 10 2026.pdf` |
| `track-safety-aholmes` | Track Safety Aholmes | 1 | 0.90 | ✅ | `Track Safety - AHolmes - EXP 15 10 2026.pdf` |
| `veritas-aholmes` | Veritas Aholmes | 1 | 0.85 | ✅ | `Veritas - AHolmes - EXP 03 2025.pdf` |
| `damstra` | Damstra | 1 | 0.55 | — | `Damstra CDO - AH.pdf` |
| `airport-restricted` | Airport Restricted | 1 | 0.85 | ✅ | `AIRPORT RESTRICTED INDUCTION -A.KINGSTON - EXP26 03 2025.pdf` |
| `alex-traffic-management` | Alex Traffic Management | 1 | 0.90 | ✅ | `Alex Kingston - Traffic Management Training - EXP 07 02 2023.pdf` |
| `operate-loading-system` | Operate Loading System | 1 | 0.90 | ✅ | `OPERATE A VAC LOADING SYSTEM - ALEXANDER KINGSTON - EXP 17 09 2024.pdf` |
| `visitor-awareness-presentation` | Visitor Awareness Presentation | 1 | 0.90 | ✅ | `Alexander Kingston BBA Visitor Awareness Presentation - Iss20 09 2022.pdf` |
| `burnie-bulk` | Burnie Bulk | 1 | 0.85 | ✅ | `Burnie Bulk Induction - AK - EXP 03 09 2026.pdf` |
| `damp-asic` | Damp Asic | 1 | 0.85 | ✅ | `DAMP TRAINING (ASIC) - ALEXANDER KINGSTON - EXP30 10 2026.pdf` |
| `east-tamar-junction` | East Tamar Junction | 1 | 0.90 | ✅ | `East Tamar Junction Induction - AK - EXP 05 08 2026.pdf` |
| `fire-extinguisher` | Fire Extinguisher | 1 | 0.85 | ✅ | `Fire Extinguisher - AK - EXP 27 10 2026.pdf` |
| `bell-aluminium-alex` | Bell Aluminium Alex | 1 | 0.90 | ✅ | `BELL BAY ALUMINIUM - ALEX KINGSTON - EXP26 09 2024.pdf` |
| `bell-bay` | Bell Bay | 1 | 0.85 | ✅ | `Bell Bay Induction - AK - EXP 25 09 2025.png` |
| `hydro-alex` | Hydro Alex | 1 | 0.85 | ✅ | `HYDRO_INDUCTION___ALEX_KINGSTON___EXP03_05_2025_0.pdf` |
| `launceston-airport-restricted` | Launceston Airport Restricted | 1 | 0.90 | ✅ | `Launceston Airport - Restricted Induction - A Kingston Exp 16.1.24.pdf` |
| `liberty-bell-alex` | Liberty Bell Alex | 1 | 0.90 | ✅ | `LIBERTY BELL BAY INDUCTION - ALEX KINGSTON - EXP 16 12 2023.pdf` |
| `liberty-alex` | Liberty Alex | 1 | 0.85 | ✅ | `LIBERTY INDUCTION  - ALEX KINGSTON - EXP20 12 2025.pdf` |
| `tasrail-general-alex` | Tasrail General Alex | 1 | 0.90 | ✅ | `TASRAIL GENERAL INDUCTION - ALEX KINGSTON - EXP05 04 2026.pdf` |
| `tasrail-alex` | Tasrail Alex | 1 | 0.85 | ✅ | `TasRail Induction - Alex Kingston - EXP 21 03 2024.pdf` |
| `tasrail-supplier-contractor-alex` | Tasrail Supplier Contractor Alex | 1 | 0.85 | ✅ | `TasRail Supplier-Contractor Induction - Alex Kingston - EXP21 03 2024.pdf` |
| `taswater-general` | Taswater General | 1 | 0.85 | ✅ | `TASWATER GENERAL INDUCTION - ALEXANDER KINGSTON - EXP13 02 2026.pdf` |
| `track-safety-awareness-alex` | Track Safety Awareness Alex | 1 | 0.85 | ✅ | `Track Safety Awareness Induction - Alex Kingston - EXP 21 03 2024.pdf` |
| `wilson-homes` | Wilson Homes | 1 | 0.85 | ✅ | `WILSON HOMES INDUCTION - A.KINGSTON  - EXP23 02 2026.pdf` |
| `alex-vehicle-knowledge-test` | Alex Vehicle Knowledge Test | 1 | 0.85 | ✅ | `ALEX KINGSTON - HR VEHICLE KNOWLEDGE TEST.pdf` |
| `asic` | Asic | 1 | 0.55 | — | `ASIC - AK - EXP 31 07 2027.pdf` |
| `hydro` | Hydro | 1 | 0.55 | — | `Hydro Induction - AK - EXP 14 10 2028.pdf` |
| `msic` | Msic | 1 | 0.55 | — | `MSIC - AK - EXP 30 06 2026.jpg` |
| `tasrail-track-safety-awareness-alex` | Tasrail Track Safety Awareness Alex | 1 | 0.70 | — | `TASRAIL TRACK SAFETY AWARENESS - ALEX KINGSTON - EXP05 04 2026.pdf` |
| `alex` | Alex | 1 | 0.55 | — | `HR LICENCE - ALEX KINGSTON - EXP08 04 2025.pdf` |
| `hltpat-jane` | Hltpat Jane | 1 | 0.85 | ✅ | `SOA HLTPAT005 - Amanda Jane Guy.pdf` |

---
## Routed-to-existing (dedupe against catalogue)
Suggestions that fuzzy-hit an existing `cert_kinds` slug (≥ 0.80). These do **not** create a new kind — files are attached to the existing slug.

| Suggested slug | Existing hit | Files | Confidence |
|---|---|---:|---:|
| `tasrail` | `tas-rail` | 4 | 0.55 |
| `work-safely-at-heights` | `work-safely-heights` | 3 | 0.85 |
| `taswater` | `tas-water` | 2 | 0.55 |
| `forklift` | `fork-lift` | 1 | 0.55 |
| `operate-drain-cleaning-system` | `operate-drain-cleaning` | 1 | 0.85 |
| `high-risk-alex` | `high-risk-lf` | 1 | 0.90 |

---
## Files still unmatched after auto-taxonomy
**11 file(s)** could not produce a usable slug (all filename tokens were noise / dates / initials).

  - `WTC- DB.pdf`
  - `DCC INDUCTION - DANIEL BUTLER - EXP 06 06 2024.pdf`
  - `DCC INDUCTION - DANIEL BUTLER - EXP07 06 2026.pdf`
  - `WTC -DB.pdf`
  - `Licence Exp 2022.pdf`
  - `HC License - AH - EXP 05 02 2030.pdf`

These land in the per-worker **Unmatched Documents** triage tab for manual reclassification.

---
## Notes
- **Task D (live commit) is held pending explicit `GO LIVE` approval.** This dry-run performs zero writes.
- Existing `worker_certifications` rows are **never overwritten** by ZIP import — matched files attach to existing cert rows (updating `doc_file_id` only), and unmatched-after-auto-taxonomy files land in `worker_unmatched_documents` (soft-delete + 30d GridFS retention).
- Coverage target for auto-taxonomy pass: **≥ 90%** — actual: **90.8%**.
