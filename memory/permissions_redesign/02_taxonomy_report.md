# 01 — Raw taxonomy (parsed from users_permissions_matrix.xlsx)

Source: `/app/backend/scripts/inputs/users_permissions_matrix.xlsx` · sheet `Worksheet` · 121 rows × 70 cols

**Total users:** 112 · **Modules:** 12 · **Permission columns:** 62

## Row-6 module headings (merged)

| Range | Module |
|---|---|
| `H6:N6` | `competency` |
| `O6:T6` | `induction` |
| `U6:Z6` | `hr` |
| `AA6:AE6` | `incident` |
| `AF6:AJ6` | `risk` |
| `AK6:AP6` | `inform` |
| `AQ6:AT6` | `lucidityintranet` |
| `AU6:AY6` | `permittowork` |
| `AZ6:BD6` | `contractor` |
| `BE6:BJ6` | `asset` |
| `BK6:BN6` | `onsite` |
| `BO6:BQ6` | `access` |

## Metadata columns (A–G)

| Col | Header |
|---|---|
| `A` | Username |
| `B` | ID |
| `C` | First Name |
| `D` | Last Name |
| `E` | Email |
| `F` | Created At |
| `G` | Last Logged In |

## Roles per module (order of first appearance)

### `competency`
- Administrator
- Column Configuration
- Contractor Representative
- General User
- General User (Training / Inductions Only)
- Manager
- Report Emailing

### `induction`
- Administrator
- Column Configuration
- General User
- Manager
- Report Emailing
- Training / Inductions Only

### `hr`
- Administrator
- Column Configuration
- Contractor Representative
- General User
- Manager
- Report Emailing

### `incident`
- Administrator
- Column Configuration
- General User
- Report Emailing
- Responsible Manager

### `risk`
- Administrator
- Column Configuration
- Manager
- Read Only
- Report Emailing

### `inform`
- Administrator
- Column Configuration
- Contractor Representative
- General User
- Manager
- Report Emailing

### `lucidityintranet`
- Administrator
- Contractor Representative
- General User
- Manager

### `permittowork`
- Administrator
- Approver
- Column Configuration
- Manager (Creator)
- Read Only

### `contractor`
- Administrator
- Column Configuration
- Contractor Representative - only submit required documents
- Manager
- Report Emailing

### `asset`
- Administrator
- Column Configuration
- Contractor Representative
- Manager
- Mechanic Role
- Report Emailing

### `onsite`
- Administrator
- Column Configuration
- Manager
- Report Emailing

### `access`
- Administrator
- Column Configuration
- Report Emailing

## Distinct cell-value tokens per (module, role) column

Should be `'Yes'` or `None` throughout. Anything else = data-entry drift.

| Column | Yes | Blank | Other |
|---|---:|---:|---|
| `competency.Administrator` | 14 | 100 | — |
| `competency.Column Configuration` | 8 | 106 | — |
| `competency.Contractor Representative` | 2 | 112 | — |
| `competency.General User` | 93 | 21 | — |
| `competency.General User (Training / Inductions Only)` | 1 | 113 | — |
| `competency.Manager` | 1 | 113 | — |
| `competency.Report Emailing` | 1 | 113 | — |
| `induction.Administrator` | 14 | 100 | — |
| `induction.Column Configuration` | 8 | 106 | — |
| `induction.General User` | 93 | 21 | — |
| `induction.Manager` | 1 | 113 | — |
| `induction.Report Emailing` | 1 | 113 | — |
| `induction.Training / Inductions Only` | 1 | 113 | — |
| `hr.Administrator` | 14 | 100 | — |
| `hr.Column Configuration` | 8 | 106 | — |
| `hr.Contractor Representative` | 2 | 112 | — |
| `hr.General User` | 93 | 21 | — |
| `hr.Manager` | 1 | 113 | — |
| `hr.Report Emailing` | 1 | 113 | — |
| `incident.Administrator` | 14 | 100 | — |
| `incident.Column Configuration` | 8 | 106 | — |
| `incident.General User` | 93 | 21 | — |
| `incident.Report Emailing` | 1 | 113 | — |
| `incident.Responsible Manager` | 1 | 113 | — |
| `risk.Administrator` | 14 | 100 | — |
| `risk.Column Configuration` | 8 | 106 | — |
| `risk.Manager` | 1 | 113 | — |
| `risk.Read Only` | 92 | 22 | — |
| `risk.Report Emailing` | 1 | 113 | — |
| `inform.Administrator` | 14 | 100 | — |
| `inform.Column Configuration` | 8 | 106 | — |
| `inform.Contractor Representative` | 2 | 112 | — |
| `inform.General User` | 92 | 22 | — |
| `inform.Manager` | 3 | 111 | — |
| `inform.Report Emailing` | 1 | 113 | — |
| `lucidityintranet.Administrator` | 14 | 100 | — |
| `lucidityintranet.Contractor Representative` | 2 | 112 | — |
| `lucidityintranet.General User` | 93 | 21 | — |
| `lucidityintranet.Manager` | 1 | 113 | — |
| `permittowork.Administrator` | 14 | 100 | — |
| `permittowork.Approver` | 93 | 21 | — |
| `permittowork.Column Configuration` | 8 | 106 | — |
| `permittowork.Manager (Creator)` | 1 | 113 | — |
| `permittowork.Read Only` | 92 | 22 | — |
| `contractor.Administrator` | 14 | 100 | — |
| `contractor.Column Configuration` | 8 | 106 | — |
| `contractor.Contractor Representative - only submit required documents` | 2 | 112 | — |
| `contractor.Manager` | 1 | 113 | — |
| `contractor.Report Emailing` | 1 | 113 | — |
| `asset.Administrator` | 14 | 100 | — |
| `asset.Column Configuration` | 8 | 106 | — |
| `asset.Contractor Representative` | 2 | 112 | — |
| `asset.Manager` | 1 | 113 | — |
| `asset.Mechanic Role` | 1 | 113 | — |
| `asset.Report Emailing` | 1 | 113 | — |
| `onsite.Administrator` | 15 | 99 | — |
| `onsite.Column Configuration` | 8 | 106 | — |
| `onsite.Manager` | 1 | 113 | — |
| `onsite.Report Emailing` | 1 | 113 | — |
| `access.Administrator` | 8 | 106 | — |
| `access.Column Configuration` | 8 | 106 | — |
| `access.Report Emailing` | 1 | 113 | — |

## Users (username → count of grants)

| Row | Username | Email | Grants |
|---:|---|---|---:|
| 8 | `Craig.LARGE` | craig.large@aussiebb.com.au | 23 |
| 9 | `Ellie.BEADLE` | ellie.beadle@icloud.com | 23 |
| 10 | `Melinda.LINFORD` | melinda@paneltec.com.au | 23 |
| 11 | `AmandaGUY` | amanda.guy@paneltec.com.au | 23 |
| 12 | `ScottCRERAR` | scott@paneltec.com.au | 23 |
| 13 | `StephenGUY` | stephen@paneltec.com.au | 23 |
| 14 | `reportemailingadministrator` |  | 33 |
| 15 | `ADMINISTRATOR` | superadminlucidity+paneltec-administrator@ideagenplc.com | 23 |
| 16 | `Haresh.CHAUDHARI` | hareshchaudhari1889@gmail.com | 11 |
| 17 | `Philip.WOODS` | philthedragonslayer@gmail.com | 11 |
| 18 | `Norman.COLE` | norm.cole@paneltec.com.au | 11 |
| 19 | `Patrick.MONAGHAN` | patrick@paneltec.com.au | 11 |
| 20 | `Mathew.LOONE` | mat.loone@paneltec.com.au | 11 |
| 21 | `Luke.GUY` | luke@paneltec.com.au | 11 |
| 22 | `Katrina.GUY` | katrina.guy@paneltec.com.au | 11 |
| 23 | `onsite` |  | 1 |
| 24 | `Toby.Smith` | tobyasmith@hotmail.com | 6 |
| 25 | `Gregory.Jordan` | greg@gmechtas.com.au | 6 |
| 26 | `George.CHAMBERLAIN` | service@paneltec.com.au | 8 |
| 27 | `Tony.PURTON` | 243apurton1971@gmail.com | 9 |
| 28 | `Kim.HODGE` | kdh.lonnie@gmail.com | 9 |
| 29 | `Skye.FLANIGAN` | skye.flanigan21@gmail.com | 9 |
| 30 | `Aaron.FOSTER` | AARONFOSTER002@ICLOUD.COM | 9 |
| 31 | `Courtney.SPIKINS` | c.spikins2102@gmail.com | 9 |
| 32 | `Toby.DALE` | daletoby435@gmail.com | 9 |
| 33 | `Ryan.SMITH` | ryannsmith92@gmail.com | 9 |
| 34 | `Visanti.MAKRAVA` | vpmakrava@gmail.com | 9 |
| 35 | `Daniel.ELLIOTT` | djelliott13@gmail.com | 9 |
| 36 | `Emma.NIPPERS` | emmanippers04@gmail.com | 9 |
| 37 | `Robert.SPENCER` | roodog75@hotmail.com | 9 |
| 38 | `Paul.RICHARDSON` | norm071335@gmail.com | 9 |
| 39 | `Nathan.HOLMES` | nathanholmes082@gmail.com | 9 |
| 40 | `Joshua.STEPHENS` | joshstephens369@gmail.com | 9 |
| 41 | `Anthony.DENARDO` | ad23kc@gmail.com | 9 |
| 42 | `James.MARSHALL` | james.p.marshall@outlook.com | 9 |
| 43 | `Gary.WARMSLEY` | gary.j.warmsley@gmail.com | 9 |
| 44 | `Dylan.PARKER` | d.j.parker6398@gmail.com | 9 |
| 45 | `Melody.HENDERSON` | melodyhenderson33@gmail.com | 9 |
| 46 | `Damon.WARNER` | damonjwarner@hotmail.com | 9 |
| 47 | `Damien.JOHNSON` | dadcharlee10@gmail.com | 9 |
| 48 | `Zoe.WHILEY` | leannezoe66@gmail.com | 9 |
| 49 | `Aaron.HOLMES` | holmes2010@live.com.au | 9 |
| 50 | `Jasper.KRUSHKA` | j.krushka6@gmail.com | 9 |
| 51 | `Brodie.ELLIS` | brodieellis12@hotmail.com | 9 |
| 52 | `Ashley.HINGSTON` | hingstonashley5@gmail.com | 9 |
| 53 | `Jarrod.TARGETT` | jarrod.targett@outlook.com | 9 |
| 54 | `William.BROWN` | william.g.brown.99@gmail.com | 9 |
| 55 | `Brock.WATERWORTH` | brock.w@hotmail.com | 9 |
| 56 | `Brendon.BRADY` | wolfdog1986@gmail.com | 9 |
| 57 | `Luke.PURSEY` | dragons94eva@gmail.com | 9 |
| 58 | `Jack.TURNER` | jackalexanderturner@outlook.com | 9 |
| 59 | `Renae.CARTLEDGE` | renaeacartledge03@gmail.com | 9 |
| 60 | `Sandy.JOHNSON` | sandybrewer78@gmail.com | 9 |
| 61 | `Stephen.MORGAN` | stevejm90@gmail.com | 9 |
| 62 | `Allison.FONTYN` | ally.fontyn21@outlook.com | 9 |
| 63 | `Phoebe.FAHEY` | phoebe.fahey17@icloud.com | 9 |
| 64 | `Ebony.BARRETT` | ebonyb137@outlook.com | 9 |
| 65 | `Alex.BARBARI` | albarbari1986@outlook.com | 9 |
| 66 | `Matthew.WELLS` | matchu_03@hotmail.com | 9 |
| 67 | `Wayne.NIPPERS` | wayne.nippers@justtelco.net.au | 9 |
| 68 | `Danieka.WEST` | niekahall@gmail.com | 9 |
| 69 | `Corey.WHEELER-MARTIN` | coreymartin1717@gmail.com | 9 |
| 70 | `Todd.COATES` | toddacoates67@gmail.com | 9 |
| 71 | `Matthew.SMITH` | matbel52@hotmail.com | 9 |
| 72 | `Richard.ANTRIM` | rikantrim@gmail.com | 9 |
| 73 | `Nicholas.Price` | nick_price01@hotmail.com | 9 |
| 74 | `Carmen.Marsden` | marsden.carmen26@gmail.com | 9 |
| 75 | `Terry.OATES` | uncletoby5@icloud.com | 9 |
| 76 | `Steve.LYONS` | redas0351@outlook.com | 9 |
| 77 | `Stephen.BEADLE` | stephen.beadle65@gmail.com | 9 |
| 78 | `Ross.GRAY` | pteradon@hotmail.com | 9 |
| 79 | `Ross.BROWN` | 1957rossbrown@gmail.com | 9 |
| 80 | `Ranvir.RANA` | ranvirs158@gmail.com | 9 |
| 81 | `Peter.BAILLIE` | baip56@hotmail.com | 9 |
| 82 | `Paul.ASHLIN` | paul.ashlin@icloud.com | 9 |
| 83 | `Lisa.TAFARI` | lisafunklush@hotmail.com | 9 |
| 84 | `Kylie.IRVINE` | irvine_kylie@yahoo.com.au | 9 |
| 85 | `John.TAYLOR` | johnybeam70@gmail.com | 9 |
| 86 | `Jason.PARKER` | fusion9975@gmail.com | 9 |
| 87 | `James.ROLLBUSCH` | rollbusch18@gmail.com | 9 |
| 88 | `James.HOLMES` | mrqyt001@hotmail.com | 9 |
| 89 | `Ian.STUBBINGS` | iangs1411@gmail.com | 9 |
| 90 | `Antony.MCCALLUM` | tony.mccallum31@gmail.com | 9 |
| 91 | `Adam.GARCIE` | adzy.garcie72@gmail.com | 9 |
| 92 | `Tony.WALKER` | brookentony@outlook.com | 9 |
| 93 | `Tim.GUY` | timguy.com@yahoo.com | 9 |
| 94 | `Stuart.MANSELL` | stuart.mansell@gmx.com | 9 |
| 95 | `Scott.CAMPBELL` | scottcampbell76@bigpond.com | 9 |
| 96 | `Norman.SLATER` | normanslater432@gmail.com | 9 |
| 97 | `Neville.YOUNG` | nevyoung12@gmail.com | 9 |
| 98 | `Mitchell.GUY` | mitchellguy44@gmail.com | 9 |
| 99 | `Lachlan.MORICE` | lochiemorice@gmail.com | 9 |
| 100 | `John.GUY` | john@paneltec.com.au | 9 |
| 101 | `Jeremy.JOHNSON` | jezzajohnson@yahoo.com | 9 |
| 102 | `Jason.DONNELLAN` | jasonleedonnellan@live.com.au | 10 |
| 103 | `Jason.BIRD` | netrage2026@outlook.com | 9 |
| 104 | `James.MITCHELL` | jamesmitchell.tas@gmail.com | 9 |
| 105 | `Graeme.BLYTH` | boofey666@gmail.com | 9 |
| 106 | `Emmanuel.QUEMUEL` | emie-noel@hotmail.com | 9 |
| 107 | `Dominic.GOULD` | dominiccharlesgoold@gmail.com | 9 |
| 108 | `Dion.KING` | dion.king46@gmail.com | 9 |
| 109 | `Danny.KIRKLAND` | dkirkland371@gmail.com | 9 |
| 110 | `Daniel.CARR` | danielcarr71@outlook.com | 9 |
| 111 | `Daniel.BUTLER` | danielbutler564@gmail.com | 9 |
| 112 | `Brett.JENKINS` | brett.jenkins2021@gmail.com | 9 |
| 113 | `Brendan.WALKER` | bwjwalker.bw@gmail.com | 9 |
| 114 | `Bobby.MCGOWAN` | bobbylbp@hotmail.com | 9 |
| 115 | `Andrew.MADZIARA` | madz@gmx.com | 9 |
| 116 | `Alexander.KINGSTON` | alexkingston@outlook.com.au | 9 |
| 117 | `Alexander.BLYTH` | alexander.blyth123@gmail.com | 9 |
| 118 | `Ian.McLELLAND` | ianhmclelland@gmail.com | 9 |
| 119 | `J.DUPUIS` | jim@wojohq.com | 2 |

## Full grant matrix (one row per user × module)

### Craig.LARGE — craig.large@aussiebb.com.au
- **competency**: Administrator, Column Configuration
- **induction**: Administrator, Column Configuration
- **hr**: Administrator, Column Configuration
- **incident**: Administrator, Column Configuration
- **risk**: Administrator, Column Configuration
- **inform**: Administrator, Column Configuration
- **lucidityintranet**: Administrator
- **permittowork**: Administrator, Column Configuration
- **contractor**: Administrator, Column Configuration
- **asset**: Administrator, Column Configuration
- **onsite**: Administrator, Column Configuration
- **access**: Administrator, Column Configuration

### Ellie.BEADLE — ellie.beadle@icloud.com
- **competency**: Administrator, Column Configuration
- **induction**: Administrator, Column Configuration
- **hr**: Administrator, Column Configuration
- **incident**: Administrator, Column Configuration
- **risk**: Administrator, Column Configuration
- **inform**: Administrator, Column Configuration
- **lucidityintranet**: Administrator
- **permittowork**: Administrator, Column Configuration
- **contractor**: Administrator, Column Configuration
- **asset**: Administrator, Column Configuration
- **onsite**: Administrator, Column Configuration
- **access**: Administrator, Column Configuration

### Melinda.LINFORD — melinda@paneltec.com.au
- **competency**: Administrator, Column Configuration
- **induction**: Administrator, Column Configuration
- **hr**: Administrator, Column Configuration
- **incident**: Administrator, Column Configuration
- **risk**: Administrator, Column Configuration
- **inform**: Administrator, Column Configuration
- **lucidityintranet**: Administrator
- **permittowork**: Administrator, Column Configuration
- **contractor**: Administrator, Column Configuration
- **asset**: Administrator, Column Configuration
- **onsite**: Administrator, Column Configuration
- **access**: Administrator, Column Configuration

### AmandaGUY — amanda.guy@paneltec.com.au
- **competency**: Administrator, Column Configuration
- **induction**: Administrator, Column Configuration
- **hr**: Administrator, Column Configuration
- **incident**: Administrator, Column Configuration
- **risk**: Administrator, Column Configuration
- **inform**: Administrator, Column Configuration
- **lucidityintranet**: Administrator
- **permittowork**: Administrator, Column Configuration
- **contractor**: Administrator, Column Configuration
- **asset**: Administrator, Column Configuration
- **onsite**: Administrator, Column Configuration
- **access**: Administrator, Column Configuration

### ScottCRERAR — scott@paneltec.com.au
- **competency**: Administrator, Column Configuration
- **induction**: Administrator, Column Configuration
- **hr**: Administrator, Column Configuration
- **incident**: Administrator, Column Configuration
- **risk**: Administrator, Column Configuration
- **inform**: Administrator, Column Configuration
- **lucidityintranet**: Administrator
- **permittowork**: Administrator, Column Configuration
- **contractor**: Administrator, Column Configuration
- **asset**: Administrator, Column Configuration
- **onsite**: Administrator, Column Configuration
- **access**: Administrator, Column Configuration

### StephenGUY — stephen@paneltec.com.au
- **competency**: Administrator, Column Configuration
- **induction**: Administrator, Column Configuration
- **hr**: Administrator, Column Configuration
- **incident**: Administrator, Column Configuration
- **risk**: Administrator, Column Configuration
- **inform**: Administrator, Column Configuration
- **lucidityintranet**: Administrator
- **permittowork**: Administrator, Column Configuration
- **contractor**: Administrator, Column Configuration
- **asset**: Administrator, Column Configuration
- **onsite**: Administrator, Column Configuration
- **access**: Administrator, Column Configuration

### reportemailingadministrator — 
- **competency**: Administrator, Column Configuration, Report Emailing
- **induction**: Administrator, Column Configuration, Report Emailing
- **hr**: Administrator, Column Configuration, Report Emailing
- **incident**: Administrator, Column Configuration, Report Emailing
- **risk**: Administrator, Column Configuration, Report Emailing
- **inform**: Administrator, Column Configuration, Report Emailing
- **lucidityintranet**: Administrator
- **permittowork**: Administrator, Column Configuration
- **contractor**: Administrator, Column Configuration, Report Emailing
- **asset**: Administrator, Column Configuration, Report Emailing
- **onsite**: Administrator, Column Configuration, Report Emailing
- **access**: Administrator, Column Configuration, Report Emailing

### ADMINISTRATOR — superadminlucidity+paneltec-administrator@ideagenplc.com
- **competency**: Administrator, Column Configuration
- **induction**: Administrator, Column Configuration
- **hr**: Administrator, Column Configuration
- **incident**: Administrator, Column Configuration
- **risk**: Administrator, Column Configuration
- **inform**: Administrator, Column Configuration
- **lucidityintranet**: Administrator
- **permittowork**: Administrator, Column Configuration
- **contractor**: Administrator, Column Configuration
- **asset**: Administrator, Column Configuration
- **onsite**: Administrator, Column Configuration
- **access**: Administrator, Column Configuration

### Haresh.CHAUDHARI — hareshchaudhari1889@gmail.com
- **competency**: Administrator
- **induction**: Administrator
- **hr**: Administrator
- **incident**: Administrator
- **risk**: Administrator
- **inform**: Administrator
- **lucidityintranet**: Administrator
- **permittowork**: Administrator
- **contractor**: Administrator
- **asset**: Administrator
- **onsite**: Administrator

### Philip.WOODS — philthedragonslayer@gmail.com
- **competency**: Administrator
- **induction**: Administrator
- **hr**: Administrator
- **incident**: Administrator
- **risk**: Administrator
- **inform**: Administrator
- **lucidityintranet**: Administrator
- **permittowork**: Administrator
- **contractor**: Administrator
- **asset**: Administrator
- **onsite**: Administrator

### Norman.COLE — norm.cole@paneltec.com.au
- **competency**: Administrator
- **induction**: Administrator
- **hr**: Administrator
- **incident**: Administrator
- **risk**: Administrator
- **inform**: Administrator
- **lucidityintranet**: Administrator
- **permittowork**: Administrator
- **contractor**: Administrator
- **asset**: Administrator
- **onsite**: Administrator

### Patrick.MONAGHAN — patrick@paneltec.com.au
- **competency**: Administrator
- **induction**: Administrator
- **hr**: Administrator
- **incident**: Administrator
- **risk**: Administrator
- **inform**: Administrator
- **lucidityintranet**: Administrator
- **permittowork**: Administrator
- **contractor**: Administrator
- **asset**: Administrator
- **onsite**: Administrator

### Mathew.LOONE — mat.loone@paneltec.com.au
- **competency**: Administrator
- **induction**: Administrator
- **hr**: Administrator
- **incident**: Administrator
- **risk**: Administrator
- **inform**: Administrator
- **lucidityintranet**: Administrator
- **permittowork**: Administrator
- **contractor**: Administrator
- **asset**: Administrator
- **onsite**: Administrator

### Luke.GUY — luke@paneltec.com.au
- **competency**: Manager
- **induction**: Manager
- **hr**: Manager
- **incident**: Responsible Manager
- **risk**: Manager
- **inform**: Manager
- **lucidityintranet**: Manager
- **permittowork**: Manager (Creator)
- **contractor**: Manager
- **asset**: Manager
- **onsite**: Manager

### Katrina.GUY — katrina.guy@paneltec.com.au
- **competency**: Administrator
- **induction**: Administrator
- **hr**: Administrator
- **incident**: Administrator
- **risk**: Administrator
- **inform**: Administrator
- **lucidityintranet**: Administrator
- **permittowork**: Administrator
- **contractor**: Administrator
- **asset**: Administrator
- **onsite**: Administrator

### onsite — 
- **onsite**: Administrator

### Toby.Smith — tobyasmith@hotmail.com
- **competency**: Contractor Representative
- **hr**: Contractor Representative
- **inform**: Contractor Representative
- **lucidityintranet**: Contractor Representative
- **contractor**: Contractor Representative - only submit required documents
- **asset**: Contractor Representative

### Gregory.Jordan — greg@gmechtas.com.au
- **competency**: Contractor Representative
- **hr**: Contractor Representative
- **inform**: Contractor Representative
- **lucidityintranet**: Contractor Representative
- **contractor**: Contractor Representative - only submit required documents
- **asset**: Contractor Representative

### George.CHAMBERLAIN — service@paneltec.com.au
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **inform**: Manager
- **lucidityintranet**: General User
- **permittowork**: Approver
- **asset**: Mechanic Role

### Tony.PURTON — 243apurton1971@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Kim.HODGE — kdh.lonnie@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Skye.FLANIGAN — skye.flanigan21@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Aaron.FOSTER — AARONFOSTER002@ICLOUD.COM
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Courtney.SPIKINS — c.spikins2102@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Toby.DALE — daletoby435@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Ryan.SMITH — ryannsmith92@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Visanti.MAKRAVA — vpmakrava@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Daniel.ELLIOTT — djelliott13@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Emma.NIPPERS — emmanippers04@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Robert.SPENCER — roodog75@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Paul.RICHARDSON — norm071335@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Nathan.HOLMES — nathanholmes082@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Joshua.STEPHENS — joshstephens369@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Anthony.DENARDO — ad23kc@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### James.MARSHALL — james.p.marshall@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Gary.WARMSLEY — gary.j.warmsley@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Dylan.PARKER — d.j.parker6398@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Melody.HENDERSON — melodyhenderson33@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Damon.WARNER — damonjwarner@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Damien.JOHNSON — dadcharlee10@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Zoe.WHILEY — leannezoe66@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Aaron.HOLMES — holmes2010@live.com.au
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Jasper.KRUSHKA — j.krushka6@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Brodie.ELLIS — brodieellis12@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Ashley.HINGSTON — hingstonashley5@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Jarrod.TARGETT — jarrod.targett@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### William.BROWN — william.g.brown.99@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Brock.WATERWORTH — brock.w@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Brendon.BRADY — wolfdog1986@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Luke.PURSEY — dragons94eva@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Jack.TURNER — jackalexanderturner@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Renae.CARTLEDGE — renaeacartledge03@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Sandy.JOHNSON — sandybrewer78@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Stephen.MORGAN — stevejm90@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Allison.FONTYN — ally.fontyn21@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Phoebe.FAHEY — phoebe.fahey17@icloud.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Ebony.BARRETT — ebonyb137@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Alex.BARBARI — albarbari1986@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Matthew.WELLS — matchu_03@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Wayne.NIPPERS — wayne.nippers@justtelco.net.au
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Danieka.WEST — niekahall@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Corey.WHEELER-MARTIN — coreymartin1717@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Todd.COATES — toddacoates67@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Matthew.SMITH — matbel52@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Richard.ANTRIM — rikantrim@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Nicholas.Price — nick_price01@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Carmen.Marsden — marsden.carmen26@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Terry.OATES — uncletoby5@icloud.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Steve.LYONS — redas0351@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Stephen.BEADLE — stephen.beadle65@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Ross.GRAY — pteradon@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Ross.BROWN — 1957rossbrown@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Ranvir.RANA — ranvirs158@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Peter.BAILLIE — baip56@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Paul.ASHLIN — paul.ashlin@icloud.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Lisa.TAFARI — lisafunklush@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Kylie.IRVINE — irvine_kylie@yahoo.com.au
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### John.TAYLOR — johnybeam70@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Jason.PARKER — fusion9975@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### James.ROLLBUSCH — rollbusch18@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### James.HOLMES — mrqyt001@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Ian.STUBBINGS — iangs1411@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Antony.MCCALLUM — tony.mccallum31@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Adam.GARCIE — adzy.garcie72@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Tony.WALKER — brookentony@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Tim.GUY — timguy.com@yahoo.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Stuart.MANSELL — stuart.mansell@gmx.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Scott.CAMPBELL — scottcampbell76@bigpond.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Norman.SLATER — normanslater432@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Neville.YOUNG — nevyoung12@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Mitchell.GUY — mitchellguy44@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Lachlan.MORICE — lochiemorice@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### John.GUY — john@paneltec.com.au
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Jeremy.JOHNSON — jezzajohnson@yahoo.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Jason.DONNELLAN — jasonleedonnellan@live.com.au
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User, Manager
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Jason.BIRD — netrage2026@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### James.MITCHELL — jamesmitchell.tas@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Graeme.BLYTH — boofey666@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Emmanuel.QUEMUEL — emie-noel@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Dominic.GOULD — dominiccharlesgoold@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Dion.KING — dion.king46@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Danny.KIRKLAND — dkirkland371@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Daniel.CARR — danielcarr71@outlook.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Daniel.BUTLER — danielbutler564@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Brett.JENKINS — brett.jenkins2021@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Brendan.WALKER — bwjwalker.bw@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Bobby.MCGOWAN — bobbylbp@hotmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Andrew.MADZIARA — madz@gmx.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Alexander.KINGSTON — alexkingston@outlook.com.au
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Alexander.BLYTH — alexander.blyth123@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### Ian.McLELLAND — ianhmclelland@gmail.com
- **competency**: General User
- **induction**: General User
- **hr**: General User
- **incident**: General User
- **risk**: Read Only
- **inform**: General User
- **lucidityintranet**: General User
- **permittowork**: Approver, Read Only

### J.DUPUIS — jim@wojohq.com
- **competency**: General User (Training / Inductions Only)
- **induction**: Training / Inductions Only
