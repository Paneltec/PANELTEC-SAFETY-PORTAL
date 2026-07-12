# Simpro Worker Sync — Phase B Dry-Run

**Generated**: 2026-07-12T01:44:16.114710+00:00
**Org**: `3116f250-a4eb-43f3-98a5-2a3656d6cb63` — Simpro tenant `https://paneltec.simprosuite.com` (Companies: ['2', '3'])
**Mode**: `--dry-run` — **ZERO writes** to Mongo, ZERO writes to Simpro.
**PII allowlist**: `['address', 'date_of_birth', 'emergency_contact']`  ·  **denylist**: `['banking', 'masked_ssn', 'ssn', 'tfn']`
**Licence mapping seed**: `/app/backend/scripts/seed_data/simpro_licence_mapping_seed.json` (158 raw→slug rows)

---

## 🎯 Executive summary

| Metric | Value |
|---|---:|
| Simpro employees fetched | **71** (Company 2: 39, Company 3: 32) |
| Simpro licences fetched | **694** (org-wide) |
| Our workers in scope | **60** |
| **Matched (would be enriched)** | **61** |
|   — matched by `simpro_employee_id` | 60 |
|   — matched by email fallback | 1 |
|   — of which archived in Simpro | 0 |
| **Unmatched (would be SKIPPED)** | **10** |
| Licences to ADD | 36 |
| Licences to CHANGE (expiry / ref / slug drift) | 0 |
| Licences UNCHANGED | 0 |
| Manual-only certs to preserve (not in Simpro) | 0 |
| PII fields to ADD | 172 |
| PII fields to CHANGE | 0 |

---

## 1 · Unmatched Simpro employees (skipped — informational only)

Per user policy "**only workers already in our portal**", these are NOT imported. Listed for review; add them to `workers` first if you want them enriched next cycle.

| Simpro ID | Company | Name | Position | Email | Archived | Licences would-add |
|---:|---:|---|---|---|:---:|---:|
| 394 | 2 | NORMAN SLATER | Construction Worker L2 | `normslater1234@gmail.com` |  | 0 |
| 389 | 2 | PATRICK MONAGHAN | Operations Manager | `patrick@paneltec.com.au` |  | 0 |
| 1023 | 2 | PAUL RICHARDSON | Construction Worker L2 | `norm071335@gmail.com` |  | 0 |
| 1026 | 2 | ROBERT SPENCER | Construction Worker L2 | `roodog75@hotmail.com` |  | 0 |
| 278 | 2 | SCOTT CAMPBELL | Construction Worker L2 | `scottcampbell76@bigpond.com` |  | 0 |
| 60 | 2 | STUART MANSELL | Construction Worker L2 | `stuart.mansell@gmx.com` |  | 0 |
| 61 | 2 | TIM GUY | Construction Worker L2 | `tim.guy@paneltec.com.au` |  | 0 |
| 353 | 2 | TONY WALKER | Construction Worker L2 | `brookentony@outlook.com` |  | 0 |
| 912 | 3 | WAYNE NIPPERS | Traffic Controller | `waynenippers@outlook.com` |  | 0 |
| 979 | 3 | WILLIAM BROWN | Traffic Controller | `william.g.brown.99@gmail.com` |  | 0 |

---

## 2 · Per-worker diff (matched)

### 2a · Workers with proposed changes (61)

#### AARON FOSTER  ·  `AARONFOSTER002@ICLOUD.COM`  ·  Simpro ID `1077` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1987-04-08'
    - `address`: **add** — street='65 Galvin Street' · city='South Launceston' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **add** — name='Trish Foster' · relationship='Mum' · cell_phone='0437770650'

#### AARON HOLMES  ·  `holmes2010@live.com.au`  ·  Simpro ID `1004` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1995-11-21'
    - `address`: **add** — street='25 Rothesay Close' · city='Newnham' · state='TAS' · postal_code='7248' · country='Australia'
    - `emergency_contact`: **add** — name='Gabby Holmes' · relationship='Wife' · cell_phone='0459 960 910'

#### ADAM GARCIE  ·  `adzy.garcie72@gmail.com`  ·  Simpro ID `758` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1972-05-15'
    - `address`: **add** — street='74 Tasman Highway' · city='Waverley' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Polly Allen' · relationship='Partner' · cell_phone='0476 404 758'

#### ALEXANDER KINGSTON  ·  `alexkingston@outlook.com.au`  ·  Simpro ID `595` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1994-02-28'
    - `address`: **add** — street='140 Alanvale Rd ' · city='NEWNHAM' · postal_code='7248' · country='Australia'
    - `emergency_contact`: **add** — name='Elizabeth Deayton' · relationship='Partner' · cell_phone='0488 927 477'

#### ALLISON FONTYN  ·  `ally.fontyn21@outlook.com`  ·  Simpro ID `965` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1966-02-21'
    - `address`: **add** — street='48 Outram Street' · city='Summerhill' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Stephen Morgan' · relationship='Partner' · cell_phone='0438 391 172' · address='48 Outram St\r\nSummerhill  7250'

#### AMANDA GUY  ·  `amanda.guy@paneltec.com.au`  ·  Simpro ID `50` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Office Manager`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1981-02-10'
    - `address`: **add** — street='2/10 Sienna Place' · city='Youngtown' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **add** — name='Stephen Guy' · relationship='FATHER' · cell_phone='0408176442'

#### Amanda Guy  ·  `amanda.guy@paneltec.com.au`  ·  Simpro ID `1086` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `—`
- **PII allowlist diff**:
    - `date_of_birth`: **—** — —
    - `address`: **add** — country='Australia'
    - `emergency_contact`: **—** — —

#### BOBBY MCGOWAN  ·  `bobbylbp@hotmail.com`  ·  Simpro ID `271` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1975-04-18'
    - `address`: **add** — street='9 Simmons St' · city='Carrick' · state='TAS' · postal_code='7291' · country='Australia'
    - `emergency_contact`: **add** — name='Louise McGowan' · relationship='wife' · cell_phone='0439048790' · work_phone='0439 048 790'

#### BRENDAN WALKER  ·  `bwjwalker.bw@gmail.com`  ·  Simpro ID `744` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1972-02-26'
    - `address`: **add** — street='105 Talbot Road' · city='South Launceston' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Brian Walker' · relationship='Father' · cell_phone='0418 127 781'

#### BRENDON BRADY  ·  `wolfdog1986@gmail.com`  ·  Simpro ID `978` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1986-02-14'
    - `address`: **add** — street='3 Cavell Place' · city='Ravenswood' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Lexy Brady' · relationship='Wife' · cell_phone='0467 607 878'

#### BROCK WATERWORTH  ·  `brock.w@hotmail.com`  ·  Simpro ID `977` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Plumber`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1999-01-16'
    - `address`: **add** — street='650 Westwood Road' · city='Westwood' · state='TAS' · postal_code='7292' · country='Australia'
    - `emergency_contact`: **add** — name='Susan' · relationship='Mother'

#### COURTNEY SPIKINS  ·  `c.spikins2102@gmail.com`  ·  Simpro ID `1075` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '2005-02-21'
    - `address`: **add** — street='16 Carr Street' · city='Kings Meadows' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **—** — —

#### CRAIG LARGE  ·  `craig@paneltec.com.au`  ·  Simpro ID `1030` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Safety and Compliance Manager`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1966-08-30'
    - `address`: **add** — street='79 Hardwicke Street' · city='Summerhill' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Kelli Large' · relationship='Spouse' · cell_phone='0417 713 990'

#### DAMON WARNER  ·  `damonjwarner@hotmail.com`  ·  Simpro ID `1012` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1979-04-23'
    - `address`: **add** — street='18 Vale Street' · city='Prospect Vale' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Peter Warner' · relationship='Father' · cell_phone='0418 812 143'

#### DANIEKA WEST  ·  `niekahall@gmail.com`  ·  Simpro ID `514` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1995-11-08'
    - `address`: **add** — street='6 Brooks Road\r\n' · city='Lalla' · state='TAS' · postal_code='7267' · country='Australia'
    - `emergency_contact`: **add** — name='Sonya West' · relationship='Mother' · cell_phone='0488 015 110'

#### DANIEL BUTLER  ·  `danielbutler564@gmail.com`  ·  Simpro ID `133` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1994-08-05'
    - `address`: **add** — street='6 Munford Street' · city='Kings Meadows' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **add** — name='Michelle Webb' · relationship='Mother' · cell_phone='0407222730'

#### DANIEL CARR  ·  `danielcarr71@outlook.com`  ·  Simpro ID `219` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L3`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1971-10-07'
    - `address`: **add** — street='30 Pitcairn St ' · city='Port Sorell' · postal_code='7307' · country='Australia'
    - `emergency_contact`: **add** — name='Donna Fenlon' · relationship='Wife' · cell_phone='0488 686 856' · address='30 Pitcairn St, Port Sorell'

#### DANIEL ELLIOTT  ·  `djelliott13@gmail.com`  ·  Simpro ID `1045` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1991-07-13'
    - `address`: **add** — street='16 Winkleigh Road' · city='Exeter' · state='TAS' · postal_code='7275' · country='Australia'
    - `emergency_contact`: **add** — name='Amy Brown' · relationship='Partner' · cell_phone='0417 668 217'

#### DANNY KIRKLAND  ·  `dkirkland371@gmail.com`  ·  Simpro ID `101` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Machine Operator`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1969-10-30'
    - `address`: **add** — street='58 BOND ST ' · city='KINGS MEADOWS' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **add** — name='Cathy' · relationship='Partner' · cell_phone='0487 544 793'
- **Licences to ADD (4)**:
    - `mr-licence-danny-kirkland` — raw `MR Licence - Danny Kirkland` · ref `—` · expiry `2027-05-21` · simpro_id `59496`
    - `tasgas-induction` — raw `TasGas Induction` · ref `—` · expiry `2024-06-25` · simpro_id `59500`
    - `taswater-cdo-induction` — raw `TasWater CDO Induction` · ref `—` · expiry `2024-07-23` · simpro_id `59502`
    - `taswater-induction` — raw `TasWater Induction` · ref `—` · expiry `2025-05-04` · simpro_id `59503`

#### DOMINIC GOOLD  ·  `dominiccharlesgoold@gmail.com`  ·  Simpro ID `332` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1979-08-23'
    - `address`: **add** — street='39 Button Street' · city='Mowbray' · state='TAS' · postal_code='7248' · country='Australia'
    - `emergency_contact`: **add** — name='Aaron Forster' · relationship='Friend' · cell_phone='0457 217 931'
- **Licences to ADD (4)**:
    - `a-drivers-licence-mr` — raw `A-Drivers Licence MR.` · ref `E78554` · expiry `2028-06-02` · simpro_id `58304`
    - `first-aid` — raw `First Aid` · ref `191983` · expiry `—` · simpro_id `58306`
    - `taswater-induction` — raw `TasWater Induction` · ref `—` · expiry `2024-12-02` · simpro_id `59523`
    - `white-card` — raw `White Card` · ref `0476236 - Qld` · expiry `2050-01-23` · simpro_id `58307`

#### DYLAN PARKER  ·  `d.j.parker6398@gmail.com`  ·  Simpro ID `1013` (Co 2)
- **match**: `simpro_employee_id`  ·  position: ` Construction Worker L1`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '2007-04-19'
    - `address`: **add** — street='3 Mulgrave Street' · city='Perth' · state='TAS' · postal_code='7300' · country='Australia'
    - `emergency_contact`: **add** — name='Gerard Parker' · relationship='Father' · cell_phone='0428 560 893'

#### David Buch  ·  `david@appzoola.com`  ·  Simpro ID `1085` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Administration`
- **PII allowlist diff**:
    - `date_of_birth`: **—** — —
    - `address`: **add** — country='Australia'
    - `emergency_contact`: **—** — —

#### David Buch  ·  `david@appzoola.com`  ·  Simpro ID `1084` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `—`
- **PII allowlist diff**:
    - `date_of_birth`: **—** — —
    - `address`: **add** — country='Australia'
    - `emergency_contact`: **—** — —

#### ELLIE BEADLE  ·  `ellie@paneltec.com.au`  ·  Simpro ID `756` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '2004-07-23'
    - `address`: **add** — street='107 Main Road' · city='Exeter' · state='TAS' · postal_code='7275' · country='Australia'
    - `emergency_contact`: **add** — name='Stephen Beadle' · relationship='Father' · cell_phone='0459 214 200'

#### EMMA NIPPERS  ·  `emmanippers04@gmail.com`  ·  Simpro ID `1035` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1998-04-23'
    - `address`: **add** — street='3 Youl Road' · city='Perth' · state='TAS' · postal_code='7300' · country='Australia'
    - `emergency_contact`: **add** — name='Braydon Jones' · relationship='Partner' · cell_phone='0478 705 573'

#### EMMANUEL QUEMUEL  ·  `emie-noel@hotmail.com`  ·  Simpro ID `102` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `CLEANER`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1956-07-03'
    - `address`: **add** — street='20 Glover Crest' · city='Blackstone Heights ' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Nolene Quemuel' · relationship='Wife' · cell_phone='0409 358 637'

#### GARY WARMSLEY  ·  `gary.j.warmsley@gmail.com`  ·  Simpro ID `1015` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1966-05-06'
    - `address`: **add** — street='275 Boomer Road' · city='Waverly' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Lynette Burr' · relationship='Friend' · cell_phone='0407 237 803'

#### GEORGE CHAMBERLAIN  ·  `service@paneltec.com.au`  ·  Simpro ID `715` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `MECHANIC`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1963-09-23'
    - `address`: **add** — street='11 Hubert Way' · city='Youngtown' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **add** — name='Helen Chamberlain' · relationship='Wife ' · cell_phone='0419516082'
- **Licences to ADD (1)**:
    - `mr-drivers-licence` — raw `MR DRIVERS LICENCE` · ref `—` · expiry `2024-11-04` · simpro_id `59422`

#### HARESH CHAUDHARI  ·  `haresh@paneltec.com.au`  ·  Simpro ID `1037` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1989-08-01'
    - `address`: **add** — street='44 Mitchell Street' · city='Mayfield' · state='TAS' · postal_code='7248' · country='Australia'
    - `emergency_contact`: **add** — name='Ruchika' · relationship='Wife' · cell_phone='0416 781 203'

#### IAN STUBBINGS  ·  `iangs1411@gmail.com`  ·  Simpro ID `203` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1970-11-14'
    - `address`: **add** — street='27 Watchorn Street\r\n' · city='South Launceston' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Barara Stubbings' · relationship='Mother' · cell_phone='0406 597 639' · address='160 Dexter St'

#### JACK TURNER  ·  `jackalexanderturner@outlook.com`  ·  Simpro ID `971` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1999-03-24'
    - `address`: **add** — street='16 Crandon Crescent' · city='Newnham' · state='TAS' · postal_code='7248' · country='Australia'
    - `emergency_contact`: **add** — name='Rick Turner' · relationship='Father' · cell_phone='0475 427 040'

#### JAMES HOLMES  ·  `mrqyt001@hotmail.com`  ·  Simpro ID `94` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1977-05-31'
    - `address`: **add** — street='7 Trevritch Place' · city='Prospect' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Chantelle Bulk' · relationship='Partner' · cell_phone='0448 173 683'

#### JARROD TARGETT  ·  `jarrod.targett@outlook.com`  ·  Simpro ID `982` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker CW2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1993-06-07'
    - `address`: **add** — street='212 Opossum Road' · city='Norwood' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Tanya Targett' · relationship='Mother' · cell_phone='0414 465 732'

#### JASON BIRD  ·  `netrage2026@outlook.com`  ·  Simpro ID `393` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1969-04-04'
    - `address`: **add** — street='19 Connector Park Drive' · city='Launceston' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Annette Weyen' · relationship='Defacto' · cell_phone='0408 277 872'

#### JASON DONNELLAN  ·  `jasonleedonnellan@live.com.au`  ·  Simpro ID `661` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Plumber`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1993-06-29'
    - `address`: **add** — street='34 Kooringal Avenue' · city='Legana' · state='TAS' · postal_code='7277' · country='Australia'
    - `emergency_contact`: **add** — name='Megan Donnellan' · relationship='Wife' · cell_phone='0437460774' · address='Same as Jason'

#### JASON PARKER  ·  `fusion9975@gmail.com`  ·  Simpro ID `593` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1995-11-28'
    - `address`: **add** — street='114 South Esk Drive' · city='HADSPEN' · state='TAS' · postal_code='7290' · country='Australia'
    - `emergency_contact`: **add** — name='Marion Parker' · cell_phone='0408 993 185'

#### JOHN GUY  ·  `john@paneltec.com.au`  ·  Simpro ID `12` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Director`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1969-02-04'
    - `address`: **add** — street='6 Sienna Place' · city='Youngtown' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **add** — name='Katrina Guy' · relationship='Wife' · cell_phone='0439398575' · address='7 Kintail Ctr'

#### KATRINA GUY  ·  `katrina.guy@paneltec.com.au`  ·  Simpro ID `13` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Administration`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1969-06-03'
    - `address`: **add** — street='7 Kintail Crt' · city='Newstead' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='John Guy' · relationship='Husband' · cell_phone='0408449023' · address='7 Kintail Crt\r\nNewstead'

#### KIM HODGE  ·  `kdh.lonnie@gmail.com`  ·  Simpro ID `1083` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1965-05-15'
    - `address`: **add** — street='181 Poplar Parade' · city='Youngtown' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **add** — name='Sue Fenton' · relationship='Partner' · cell_phone='0404 154 954'

#### LISA TAFARI  ·  `lisafunklush@hotmail.com`  ·  Simpro ID `450` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1968-12-02'
    - `address`: **add** — street='4 Cosgrove Court\r\n' · city='Beauty Point' · state='TAS' · postal_code='7270' · country='Australia'
    - `emergency_contact`: **add** — name='Taylor Tafari / Chyane Tafari' · relationship='Daughter' · cell_phone='0431 262 751 / 0436 424 090'

#### LOCHIE MORICE  ·  `lochiemorice@gmail.com`  ·  Simpro ID `710` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1999-06-26'
    - `address`: **add** — street='8 Jellico Street' · city='Mowbray' · state='TAS' · postal_code='7248' · country='Australia'
    - `emergency_contact`: **add** — name='DANIELLE MORICE' · relationship='MOTHER' · cell_phone='0499118633'
- **Licences to ADD (2)**:
    - `a-drivers-licence` — raw `A-Drivers Licence` · ref `—` · expiry `2025-02-19` · simpro_id `59421`
    - `boags` — raw `BOAGS` · ref `—` · expiry `2024-07-04` · simpro_id `59464`

#### LUKE GUY  ·  `luke@paneltec.com.au`  ·  Simpro ID `56` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1995-07-20'
    - `address`: **add** — street='43 Brookdale Street' · city='NORWOOD' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='JOHN GUY ' · relationship='FATHER' · cell_phone='0408449023'

#### MATHEW LOONE  ·  `mat.loone@paneltec.com.au`  ·  Simpro ID `454` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Business Development Manager`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1970-01-06'
    - `address`: **add** — street='6 Rosslyn Road' · city='Invermay' · state='TAS' · postal_code='7248' · country='Australia'
    - `emergency_contact`: **add** — name='Rachael' · relationship='Wife' · cell_phone='0458 090292'

#### MATTHEW SMITH  ·  `matbel52@hotmail.com`  ·  Simpro ID `812` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Plumber`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1979-10-11'
    - `address`: **add** — street='19 Connector Park Drive' · city='Blessington' · state='TAS' · postal_code='7212' · country='Australia'
    - `emergency_contact`: **add** — name='Belinda Smith' · relationship='Wife' · cell_phone='0407 348 476'

#### MATTHEW WELLS  ·  `matchu_03@hotmail.com`  ·  Simpro ID `913` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1979-05-16'
    - `address`: **add** — street='71 Chris Street' · city='Prospect Vale' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Nilu Perera' · relationship='Wife' · cell_phone='0434 585 583'

#### MELINDA LINFORD  ·  `melinda3260@gmail.com`  ·  Simpro ID `995` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Admin Assistant`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1996-07-03'
    - `address`: **add** — street='17 Deek Street' · city='Kings Meadows' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **add** — name='Francie Linford' · relationship='Mother' · cell_phone='0409971967'

#### NATHAN HOLMES  ·  `nathanholmes082@gmail.com`  ·  Simpro ID `1021` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L2`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1983-04-12'
    - `address`: **add** — street='12 Summer Rise' · city='Summerhill' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Kelly Gibson' · relationship='Partner' · cell_phone='0401 900 357'

#### NEVILLE YOUNG  ·  `nevyoung12@gmail.com`  ·  Simpro ID `445` (Co 2)
- **match**: `simpro_employee_id`  ·  position: `Construction Worker L3`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1967-05-17'
    - `address`: **add** — street='20 Hadspen Park Drive' · city='Launceston' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Sally Young' · relationship='WIFE' · cell_phone='0438 937 034'
- **Licences to ADD (12)**:
    - `a-drivers-licence-mr` — raw `A-Drivers Licence MR.` · ref `B50876` · expiry `2028-05-17` · simpro_id `58650`
    - `back-hoe-and-skid-steer-loader-op` — raw `Back Hoe & Skid Steer Loader Op.` · ref `9631` · expiry `—` · simpro_id `58651`
    - `cpr` — raw `CPR` · ref `—` · expiry `2023-12-03` · simpro_id `58652`
    - `excavator-operator` — raw `Excavator Operator` · ref `9631` · expiry `—` · simpro_id `58653`
    - `first-aid` — raw `First Aid` · ref `—` · expiry `2025-04-22` · simpro_id `58654`
    - `mv-and-nmc-induction` — raw `MV & NMC INDUCTION` · ref `—` · expiry `2024-08-07` · simpro_id `58655`
    - `tas-gas-induction` — raw `Tas Gas Induction` · ref `1720` · expiry `2024-02-01` · simpro_id `58657`
    - `tas-water` — raw `Tas Water` · ref `—` · expiry `—` · simpro_id `58658`
    - `tasnetworks` — raw `TasNetworks` · ref `83039` · expiry `2026-06-24` · simpro_id `59469`
    - `taswater-cdo-induction` — raw `TasWater CDO Induction` · ref `—` · expiry `—` · simpro_id `59531`
    - `traffic-control` — raw `Traffic Control` · ref `4632` · expiry `2024-02-29` · simpro_id `58659`
    - `white-card` — raw `White Card` · ref `1460997` · expiry `—` · simpro_id `58661`

#### PAUL ASHLIN  ·  `paul.ashlin@icloud.com`  ·  Simpro ID `67` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1964-07-21'
    - `address`: **add** — street='3/158 WEST TAMAR ROAD' · city='RIVERSIDE' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='DEBRA ASHLIN' · relationship='WIFE' · cell_phone='0438 097 725'

#### PHOEBE FAHEY  ·  `phoebe.fahey17@icloud.com`  ·  Simpro ID `962` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '2005-01-19'
    - `address`: **add** — street='61 Janet Street' · city='Launceston' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Noelle Button' · relationship='Mother' · cell_phone='0487 634 450'

#### RICK ANTRIM  ·  `rikantrim@gmail.com`  ·  Simpro ID `810` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1966-01-12'
    - `address`: **add** — street='132 Wellington Street,' · city='Longford' · state='TAS' · postal_code='7301' · country='Australia'
    - `emergency_contact`: **add** — name='Karen Summers' · relationship='Partner' · cell_phone='0417 793 466'

#### RYAN SMITH  ·  `ryannsmith92@gmail.com`  ·  Simpro ID `1057` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1992-04-02'
    - `address`: **add** — street='2/82A Main Road' · city='Exeter' · state='TAS' · postal_code='7275' · country='Australia'
    - `emergency_contact`: **add** — name='Emily Smith' · relationship='Wife' · cell_phone='0497 263 314'

#### SKYE FLANIGAN  ·  `skye.flanigan21@gmail.com`  ·  Simpro ID `1082` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '2000-05-05'
    - `address`: **add** — street='168 Agnes Street' · city='George Town' · state='TAS' · postal_code='7253' · country='Australia'
    - `emergency_contact`: **add** — name='Chelsea Jackson' · relationship='Partner' · cell_phone='0456 562 003'

#### STEPHEN BEADLE  ·  `stephen.beadle65@gmail.com`  ·  Simpro ID `658` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1965-05-03'
    - `address`: **add** — street='Unit 2/7 Rankine Street' · city='Riverside ' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Ellie Beadle' · relationship='Daughter' · cell_phone='0475 360 956'

#### STEPHEN MORGAN  ·  `stevejm90@gmail.com`  ·  Simpro ID `966` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1960-07-04'
    - `address`: **add** — street='48 Outram Street' · city='Summerhill' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Allison Fontyn' · relationship='Partner' · cell_phone='0400 084 941' · address='48 Outram Street\r\nSummerhill 7250'

#### STEVEN LYONS  ·  `redas0351@outlook.com`  ·  Simpro ID `753` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1963-12-29'
    - `address`: **add** — street='2/2 Kate Place' · city='Summerhill' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Cameron Lyons' · relationship='Son' · cell_phone='0487 303 462'

#### Stephen Guy  ·  `stephen@paneltec.com.au`  ·  Simpro ID `10` (Co 2)
- **match**: `email_fallback`  ·  position: `Construction Worker`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1949-02-07'
    - `address`: **add** — street='8 Sienna Place' · city='Youngtown' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **—** — —
- **Licences to ADD (13)**:
    - `asbestos-awareness` — raw `Asbestos Awareness` · ref `—` · expiry `—` · simpro_id `59068`
    - `fire-fighting-equiptment-portable` — raw `Fire fighting equiptment ( portable )` · ref `—` · expiry `—` · simpro_id `59070`
    - `fire-response-training` — raw `Fire Response Training` · ref `—` · expiry `—` · simpro_id `59071`
    - `first-aid` — raw `First Aid` · ref `—` · expiry `2025-04-08` · simpro_id `59072`
    - `fork-lift` — raw `Fork Lift` · ref `—` · expiry `—` · simpro_id `59073`
    - `gas-industry-operations-cert-111` — raw `Gas Industry Operations Cert 111` · ref `—` · expiry `—` · simpro_id `59074`
    - `gas-safety-awareness` — raw `Gas Safety Awareness` · ref `—` · expiry `—` · simpro_id `59075`
    - `permit-holder-tas-gas` — raw `Permit Holder ( Tas Gas )` · ref `—` · expiry `—` · simpro_id `59076`
    - `pssr` — raw `PSSR` · ref `T424537` · expiry `—` · simpro_id `59077`
    - `tas-gas-induction` — raw `Tas Gas Induction` · ref `775` · expiry `2024-02-01` · simpro_id `59078`
    - `traffic-control` — raw `Traffic Control` · ref `—` · expiry `—` · simpro_id `59079`
    - `traffic-management-advanced-prepare-plans` — raw `Traffic Management Advanced ( prepare plans )` · ref `—` · expiry `—` · simpro_id `59080`
    - `white-card` — raw `White card` · ref `—` · expiry `—` · simpro_id `59081`

#### Stephen Guy  ·  `stephen@paneltec.com.au`  ·  Simpro ID `1081` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **—** — —
    - `address`: **add** — street='8 Siena Place Youngtown' · city='Youngtown' · state='TAS' · postal_code='7249' · country='Australia'
    - `emergency_contact`: **—** — —

#### TOBY DALE  ·  `daletoby435@gmail.com`  ·  Simpro ID `1058` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '2003-10-13'
    - `address`: **add** — street='12 Dean Street' · city='Ravenswood' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **—** — —

#### TODD COATES  ·  `—`  ·  Simpro ID `424` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1967-10-26'
    - `address`: **add** — street='7/10 Butler Avenue' · city='Riverside' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Linda' · relationship='Partner' · cell_phone='0418 961 677'

#### TONY PURTON  ·  `—`  ·  Simpro ID `1087` (Co 3)
- **match**: `simpro_employee_id`  ·  position: `Traffic Controller`
- **PII allowlist diff**:
    - `date_of_birth`: **add** — '1971-04-10'
    - `address`: **add** — street='289 Peel Street West' · city='Prospect Vale' · state='TAS' · postal_code='7250' · country='Australia'
    - `emergency_contact`: **add** — name='Cherryl Purton' · relationship='Wife' · cell_phone='0428 579 636'

---

## 3 · Data integrity notes

- Simpro licence names with `cert_kind_slug = "unmapped"`: **0** rows. If >0, review `simpro_licence_mapping_seed.json`.
- No files, no photos, no attachments were fetched. Simpro API v1.0 doesn't expose them (see `SIMPRO_IMPORT_AUDIT.md § A2/A4`).
- No PII outside the allowlist was extracted. `Banking`, `MaskedSSN`, `PayRates`, `AccountSetup` remain untouched.
- **Licence coverage**: 36 / 694 licences attach to a current Simpro employee. **658 licences (94%) are ORPHANS** — they reference EmployeeIDs no longer in the active roster (Simpro keeps licence history for archived/ex-employees). Phase C will silently skip orphans.
- **Current-roster licence density**: only 6 of 71 current employees have ≥1 licence in Simpro. If you expected higher, check whether your team keeps LICENCE data in the Simpro Licences tab or in a document-folder (which is API-blocked — see audit §A4).

---

## 4 · Reviewer checklist before approving Phase C

- [ ] Unmatched employees in §1: OK to skip? (Add to portal first if any should be imported.)
- [ ] PII allowlist §exec: still just `date_of_birth`, `address`, `emergency_contact`?
- [ ] Licence mapping: browse `seed_data/simpro_licence_mapping_seed.json` — any auto-mapped rows to remap manually?
- [ ] `cert_kinds` catalogue: browse `seed_data/cert_kinds_seed.json` — consolidate duplicates (e.g. `working-at-heights` + `working-safely-heights`)?
- [ ] Archived-in-Simpro workers matched — should Phase C write to them anyway or skip?
- [ ] Manual-only certs preserved: confirm the merge rule "keep manual, add Simpro on top, dedupe by `simpro_licence_id`".
