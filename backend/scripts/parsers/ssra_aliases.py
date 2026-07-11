"""SSRA per-family field alias table.

v160.3.0-adjust-16f — Initial alias table shipped for the two SSRA
families (VTS SSRA and Construction & Excavation SSRA).

v160.3.0-adjust-20c — Coverage last-mile:
  * ~30 new aliases per family covering TAILGATE items, PPE, Excavation
    controls, Overhead-wire controls, Employee-block name fields, and
    common Simpro paraphrases of the compliance question labels.
  * Aliases target the exact wording Simpro's Job Form PDF exporter
    emits (verified against `pdftotext -layout` output). Each entry is
    a paraphrase of the seeded template's canonical label; the parser
    consults these only AFTER the canonical label fails to match, so
    additions are purely additive and never break a working match.

Keyed by `template_id` (submissions store this directly). Aliases are
matched using the parser's existing `fuzzy_match_field` (word-overlap
≥ 3).
"""
from __future__ import annotations

VTS_SSRA_ID = "c69f9483-c845-4bfe-9524-26cc220d1806"
CE_SSRA_ID = "dc28f66a-a385-4a64-b5f0-d92bfd7b1798"

SSRA_FIELD_ALIASES: dict[str, dict[str, list[str]]] = {
    VTS_SSRA_ID: {
        # ── Site block ──
        "6d441330-2052-48d8-92be-359afcb688f5": [
            "Please enter the Site Address",
            "Site address for today's works",
            "What is the Site Address today",
        ],
        "9cafed50-3eac-43e2-861f-b77a1bb8390b": [
            "Who is the Company (PCBU) you are working for",
            "Company (PCBU)",
            "Customer / Asset Owner (PCBU)",
            "PCBU responsible for the workplace",
            "Asset Owner and PCBU on site",
        ],
        "50d94b22-c465-4916-b873-82ba3ca7d917": [
            "If other, please list",
            "If you selected Other above, please enter the customer here",
            "Please list the customer name if 'Other' selected",
        ],
        "c96f28dd-bc0f-4e96-a77d-a1b9871e3872": [
            "Site Contact Name",
            "Nominated Site Contact Person Name",
            "Client site contact name today",
        ],
        "0c6d1856-65b6-4ded-b62f-9f6abb56daf9": [
            "Site Contact Phone Number",
            "Site Contact Mobile",
            "Contact number for the client on site",
        ],
        "12def45c-c3c2-4ac8-b87e-784cdb3425cb": [
            "Please Select the Rest of your Traffic Management Team from the List Below",
            "Rest of your Traffic Management Team",
            "Additional Traffic Controllers on site today",
            "Traffic Management crew on site",
        ],
        "62bbd89d-04db-47ac-9b1d-4ed7faa8e6ed": [
            "Please enter the Registration Number of all Traffic Utes on Site below",
            "Registration Number of all Traffic Utes",
            "Rego numbers for Traffic Utes on site",
            "Traffic Ute rego plates today",
        ],
        "1d5259d1-e599-4aae-beda-ca0b9f85bb15": [
            "Please enter the Worksite Diary Number that will accompany this SSRA",
            "Worksite Diary Number that will accompany",
            "Diary Number linked to this SSRA",
            "Worksite Diary reference",
        ],
        # ── TAILGATE block (NEW aliases for adjust-20c) ──
        "b94e1774-6356-4f32-8430-331337215f17": [
            "Discuss The Scope of Works",
            "Tailgate topic Scope of Works",
            "Confirm scope of works discussed",
        ],
        "f6962b55-54b0-462e-b554-3d5ddfeabafa": [
            "Discuss The Placement of Vehicles and Plant",
            "Tailgate topic placement of vehicles and plant",
            "Confirm vehicle and plant placement discussed",
        ],
        "ee8621f4-3a47-4405-9943-2944935ccb0b": [
            "Discuss The Proposed Movement of Vehicles and Plant",
            "Proposed movement of vehicles and plant discussed",
            "Tailgate topic movement of vehicles",
        ],
        "be129098-dc0f-4b77-93d9-9c6b242f584b": [
            "Discuss Proposed Lunch Break Time",
            "Lunch break timing and potential site closure",
            "Tailgate topic lunch break and relief",
        ],
        "be954e4d-5f10-4835-b057-8dc38fc99c6e": [
            "Designate Two Way Radio Channel",
            "Nominated UHF channel for site",
            "Tailgate topic two-way radio channel",
        ],
        "82b04029-a262-4f6b-a173-e114937d1321": [
            "Identify any No Go Areas or Hazardous Areas",
            "No-go zones and hazardous areas identified",
            "Tailgate topic no-go areas",
        ],
        "732388c6-489f-4871-b3c9-5847d5423012": [
            "Confirm no one is exceeding 14hr in a 24hr period",
            "Fatigue management 14 hour rule confirmed",
            "No worker exceeding 14 hours in 24 hours",
        ],
        # ── Emergency / SWMS / TGS ──
        "7b2c395c-45e5-4e6e-bbd5-9c5a34af4d1f": [
            "Designate below a Location for the Emergency Assembly Point",
            "Emergency Assembly Point",
            "Muster point 100m upwind of site",
            "Assembly Point location for emergency",
        ],
        "469e6b8e-b26c-45fd-9453-00d547db35d6": [
            "Please confirm that you have a copy of the below SWMS onsite",
            "copy of the below SWMS onsite by checking the boxes",
            "SWMS codes available on site today",
            "Applicable SWMS documents present",
        ],
        "1263e0cb-4db1-4c48-87f7-f8d59a845c22": [
            "Do any changes need to be made to the SWMS due to variable",
            "changes need to be made to the SWMS",
            "SWMS amendments required for today's conditions",
            "Variable site conditions requiring SWMS change",
        ],
        "4af5919a-dd6d-45ab-af9f-54b60436dd39": [
            "TGS type used",
            "Traffic Guidance Scheme (TGS) in use",
            "Which TGS is deployed today",
        ],
        "c91ecdeb-474f-41f0-a9bf-d4fb52b131d3": [
            "If A or B is used above please note the TGS number below",
            "please note the plan number below",
            "please note the TGS number below",
            "TGS number or plan reference",
        ],
        "1a97156e-2267-485f-86fb-4e1e58f9b884": [
            "If you are using a Viatec Generic TGS please identify the scheme",
            "please identify the scheme in the checkbox",
            "Viatec Generic scheme name",
        ],
        # ── Compliance questions ──
        "c210aeec-f60f-4bca-9d73-4da9cd8d1066": [
            "I confirm that all existing speed signs within the site have been covered up",
            "existing speed signs within the site have been covered up",
            "Speed signs covered with cones placed below",
        ],
        "49fd5d0c-e7f8-4ff5-8c65-016fae85f3e9": [
            "Have all Vehicle Daily Pre-starts Been Completed",
            "Daily pre-starts for every vehicle completed",
            "Pre-start checks done for this crew's vehicles",
        ],
        "b4884693-3160-4d4b-9415-868a8a02232b": [
            "Have all vehicles and equipment been parked on site in an area",
            "parked on site in an area that will reduce",
            "Vehicles and equipment positioned to reduce risk",
        ],
        "d7c1f7ce-5a03-44fa-ad99-d33a031ea598": [
            "Have all potential slips trips and falls been identified",
            "potential slips trips and falls been identified",
            "Slip trip fall hazards identified and controlled",
        ],
        "11b51e70-bb86-4f39-bc5d-8962efde9cb9": [
            "Have all other trades/civil teams on site been communicated with regarding the scope of works",
            "other trades civil teams on site been communicated",
            "Communication with other trades regarding scope",
        ],
        "1e9c729a-aff4-4578-8770-b69155a25534": [
            "Has an assessment been made for any potential falling objects on the site",
            "assessment been made for any potential falling objects",
            "Falling object risk assessed for site",
        ],
        "1936e474-7e1a-4591-8f03-778d205ccca4": [
            "Has an assessment been made of the potential for workers or pedestrians being hit by moving plant",
            "workers or pedestrians being hit by moving plant",
            "Pedestrian/plant interaction assessment done",
        ],
        "56f4c22e-658d-4a9b-ac79-0268d6949dae": [
            "Has the risk of injury been assessed from any impaling hazards",
            "impaling hazards present in your work area",
            "Impalement risk assessment completed",
        ],
        # ── Overhead electrical (NEW for adjust-20c) ──
        "2b6a5447-b4b8-4f29-aca1-17bf41f921f2": [
            "Has an overhead electrical wire assessment been conducted",
            "3m clearance from HV per WHS Proc 17",
            "Overhead electrical clearance assessment done",
        ],
        "7d1b00f2-7708-461a-913c-4051d6db3788": [
            "Please provide detail on the rectification or control measures implemented",
            "rectification or control measures implemented",
            "Details of hazard controls implemented today",
        ],
        # ── PPE block (NEW for adjust-20c) ──
        "4196e4c9-70e4-47a6-905b-212a28110c13": [
            "PPE Hard Hat worn",
            "Hard hat worn by all crew",
            "Head protection PPE compliance",
        ],
        "06125c81-c3c0-4e51-994a-712654662a92": [
            "PPE Safety Glasses worn",
            "Eye protection worn by all crew",
            "Safety eyewear PPE compliance",
        ],
        "0b657ca2-1efd-444b-bda1-8ab4ab0951af": [
            "PPE Steel Toed Safety Boots",
            "Steel-cap safety boots worn",
            "Foot protection PPE compliance",
        ],
        "e4225893-6470-4965-9677-f306a40657c8": [
            "PPE Highly Visible Clothing with Retro-Reflective Striping",
            "Hi-vis clothing with retro-reflective striping worn",
            "High-visibility PPE compliance",
        ],
        "f12ae549-342d-4067-92ea-b3b229dc4271": [
            "PPE Construction Gloves on or Clipped",
            "Hand protection PPE worn or clipped",
            "Construction gloves on or clipped to belt",
        ],
        # ── Emergency procedures + employees (NEW) ──
        "3a6a6ca6-47a7-4196-a658-d89a615dec8d": [
            "Emergency Procedures are located in Lucidity Management System",
            "Aware of emergency procedures location in Lucidity",
            "Emergency procedures WHS-05 in Lucidity",
        ],
        "90abcab1-b6e4-48e8-88c4-97d955522a0f": [
            "Employee 1 on site Name",
            "First additional crew member name",
        ],
        "293817b7-f574-4fc5-a0d3-8d8e186b6465": [
            "Employee 2 on site Name",
            "Second additional crew member name",
        ],
        "7cc435fe-ee4f-453e-94a0-967d9b50f7b9": [
            "Employee 3 on site Name",
            "Third additional crew member name",
        ],
        "668058ff-4692-4589-90c4-201fa99e3a85": [
            "SSRA Complete",
            "Status Complete",
            "SSRA sign-off completion status",
        ],
    },
    CE_SSRA_ID: {
        # ── Site block ──
        "072d035f-a1be-4267-9fcb-b4067934c4f2": [
            "Please enter the Site Address",
            "Nearest house number if in Road Reserve",
            "Site address including town if outside Launceston",
        ],
        "da474ff1-2655-4b26-8200-c3da37596982": [
            "Please Populate the Time Below",
            "Site start time today",
            "What time did site works commence",
        ],
        "c481655b-a8d0-4dd5-8500-c65436686d7a": [
            "Who is the Company (PCBU) you are working for",
            "Company (PCBU)",
            "Asset Owner PCBU responsible for the workplace",
        ],
        "e211c65c-b4e9-47df-8fb1-a5da3331166e": [
            "Please enter the Worksite Diary Number that will accompany",
            "Worksite Diary Number that will accompany",
            "Diary Number linked to this SSRA",
            "Worksite Diary reference number",
        ],
        "26b3970e-7806-4fc3-8092-93a69de4a9da": [
            "Please Select the Rest of your Civil Team from the List Below",
            "Rest of your Civil Team",
            "Additional civil crew members on site",
            "Civil team members on site today",
        ],
        "72b2f85d-a4db-4470-8d13-2eb760f3badc": [
            "Please select the appropriate Work Description Below",
            "appropriate Work Description",
            "Civil work description for today",
            "Category of civil works being performed",
        ],
        # ── TAILGATE (NEW for adjust-20c) ──
        "f3c1b071-8392-45f2-acfa-32354c8b615a": [
            "Discuss scope of works",
            "Tailgate topic scope of works",
            "Confirm scope of works discussed",
        ],
        "91d7c8a7-3b98-4eb7-bb52-7cbcf295140b": [
            "Discuss placement of vehicles and plant",
            "Placement of vehicles and plant on site",
        ],
        "a0240822-7093-4b1e-9354-02588fc43eb3": [
            "Discuss proposed movement of vehicles and plant",
            "Proposed movement of vehicles and plant",
        ],
        "4b213cf9-8f5e-441b-b0f6-8d5466b4f082": [
            "Discuss proposed lunch break time",
            "Lunch break potential site closure or relief",
        ],
        "2197bb57-d53f-4120-9809-9fa32291f88f": [
            "Designate two-way radio channel",
            "Nominated UHF channel for civil crew",
        ],
        "291a45f1-3da6-49f6-9665-a0e1c0d672c1": [
            "Review BYDA enquiry with excavation team and spotter",
            "BYDA enquiry review with excavation crew",
            "Before You Dig enquiry review with team",
        ],
        "4f74cabd-37ac-4863-9f5d-374615f28b8e": [
            "Identify No-Go Areas",
            "No-go zones and hazardous areas identified",
            "Hazardous areas identified for civil crew",
        ],
        "f6cfce0a-c8cc-492f-b324-7e36ba7e8bde": [
            "Confirm no one is exceeding 14hr in a 24hr period",
            "Fatigue management 14 hour rule confirmed",
        ],
        # ── Emergency / BYDA / TGS / SWMS ──
        "4a564ba8-a845-4aba-819b-eeb1d92efadc": [
            "Designate below a Location for the Emergency Assembly Point",
            "Emergency Assembly Point",
            "Muster point 100m upwind of site",
        ],
        "ded3e7d4-bf86-4ac5-8c3d-6ae0f0bfc435": [
            "BYDA enquiry reference",
            "BYDA reference number",
            "Before You Dig Australia enquiry",
            "BYDA number must be within last 28 days",
        ],
        "57bdcffa-acb5-4380-a716-75d34a328c09": [
            "TGS type used",
            "Traffic Guidance Scheme (TGS) in use",
            "Which TGS is deployed today",
        ],
        "dcc6ffe2-c021-4eda-b2ea-b283f3e9ac11": [
            "If A or B is used above please note the TGS number below",
            "please note the TGS number below",
            "TGS number for civil site",
        ],
        "d72154ea-9863-44ea-89ed-41dc89da5e18": [
            "Please confirm that you have a copy of the below SWMS onsite",
            "copy of the below SWMS onsite by checking the boxes",
            "Applicable SWMS documents present on civil site",
        ],
        # ── Compliance questions ──
        "8413616f-646d-4959-a619-56977bced265": [
            "Have all vehicles and equipment been parked on site in an area",
            "Vehicles and plant parked to reduce incident risk",
        ],
        "9e05348b-b11e-4120-b6f4-fd97d2fce6ff": [
            "Have all potential slips trips and falls been identified",
            "Slips trips falls identified and controlled on civil site",
        ],
        "96e726e2-8695-4c5d-b293-4b6b603ea68e": [
            "Have all other trades/civil teams on site been communicated with regarding the scope of works",
            "Other trades traffic controllers informed of scope",
        ],
        "76facb64-5f13-471e-b105-22faa7658d1e": [
            "Has an assessment been made for any potential falling objects on the site",
            "Falling object risk assessed for civil site",
        ],
        "bedeb1d1-8cbe-4fe6-91b1-b0c2350e41d3": [
            "Has an assessment been made of the potential for workers or pedestrians being hit by moving plant",
            "Pedestrian and plant interaction assessment done",
        ],
        "65c25ae7-c7fa-4e16-aaed-c809fc81b7c5": [
            "Has the risk of injury from open trenches",
            "Risk of injury from excavations been assessed",
            "Open trench excavation risk assessment",
        ],
        "e5f1a340-5f92-4b39-8ffe-9c44f425ffff": [
            "Has an overhead electrical wire assessment been conducted",
            "3m clearance from HV per WHS Proc 17 confirmed",
            "Overhead electrical clearance assessment done",
        ],
        # ── Excavation controls (NEW) ──
        "fb1f4b13-c171-4a65-a6e7-46896cf2526c": [
            "Short-term pothole cones used",
            "Pothole cones for excavations under 600mm depth",
        ],
        "13d3aa09-46be-40bb-95b7-37a22acdb717": [
            "Tiger-tailed sticks used",
            "Tiger tails for excavations over 600mm depth",
        ],
        "58f30738-32f4-4f9e-a30b-b63cc5b3f7c9": [
            "Manhole guards used",
            "Manhole guard controls in place",
        ],
        "439a6216-36da-462e-ae55-a840457040eb": [
            "Mesh fencing used as excavation control",
            "Mesh fencing around excavation",
        ],
        "f4f2ff80-4e29-4601-8da6-17921747093a": [
            "Temporary fencing used as excavation control",
            "Temporary fencing around civil works",
        ],
        # ── Overhead-wire controls (NEW) ──
        "a2e67e1a-4f58-424d-afb3-ce2f8440a5c8": [
            "Cover boards used as overhead wire control",
            "Overhead wire cover boards installed",
        ],
        "71e46a8d-5bfc-467a-a238-e2873c35308b": [
            "Spotter used as overhead wire control",
            "Dedicated spotter for overhead wire clearance",
        ],
        "c2e9d4a5-9524-4d3e-af7d-95d5663f2d86": [
            "Physical exclusion zone used as overhead wire control",
            "Exclusion zone under overhead wires",
        ],
        "5a472cb9-48ea-4d8f-b960-0f8e7f107b63": [
            "De-energised used as overhead wire control",
            "Overhead lines de-energised prior to works",
        ],
        "0cf43934-e5b8-4165-9ad3-fe26b6d56845": [
            "Other overhead wire control used",
            "Other overhead wire control specified",
        ],
        "bf507ae0-6383-4f51-bdac-6ff5c993d618": [
            "Closest TasNetworks Pole Number",
            "TasNetworks pole reference for emergency",
            "Pole number nearest to civil site",
        ],
        "f1bbc755-5698-43fc-b1c1-0f2afbcc4cd5": [
            "Please provide detail on the rectification or control measures implemented",
            "Details of hazard controls implemented on civil site",
        ],
        # ── PPE (NEW) ──
        "50135841-a2f3-48bb-81e7-f201ac244301": [
            "PPE Hard Hat worn",
            "Hard hat worn by all civil crew",
        ],
        "8f8258b6-43c9-4378-89f7-8e8d3cc0fbd6": [
            "PPE Safety Glasses worn",
            "Eye protection worn by civil crew",
        ],
        "d95de1e8-e857-4664-bb01-0dbc12dfdb62": [
            "PPE Steel Toed Safety Boots",
            "Steel-cap boots worn by civil crew",
        ],
        "e4a9e048-b68b-4112-bc94-06e9ae4f3d4b": [
            "PPE Highly Visible Clothing with Retro-Reflective Striping",
            "Hi-vis clothing worn by civil crew",
        ],
        "8d029086-ac2b-4e9f-8b76-2e2a5e4ea199": [
            "PPE Construction Gloves on or Clipped",
            "Gloves worn or clipped for civil crew",
        ],
        # ── Emergency procedures + employees (NEW) ──
        "94b976ea-6c45-4e2a-9b29-a8ce048fb1c4": [
            "Emergency Procedures are located in Lucidity Management System",
            "Aware of emergency procedures location in Lucidity",
            "Emergency procedures WHS-05 in Lucidity",
        ],
        "e91a2976-5ddd-4906-91dc-d16be4b1738f": [
            "Employee 1 on site Name",
            "First additional civil crew member",
        ],
        "9615c996-2a56-4440-8f2f-ee1943b8e181": [
            "Employee 2 on site Name",
            "Second additional civil crew member",
        ],
        "3092e7df-67c0-4450-9a11-6977c3722254": [
            "Employee 3 on site Name",
            "Third additional civil crew member",
        ],
        "3663a8a7-948e-45bc-9682-cf6c9fc3bed5": [
            "SSRA Complete",
            "Status Complete",
            "Civil SSRA sign-off completion",
        ],
    },
}


def get_aliases(template_id: str | None, field_id: str) -> list[str]:
    """Return alias list for a (template_id, field_id) pair.
    Empty list if no aliases configured."""
    if not template_id:
        return []
    return SSRA_FIELD_ALIASES.get(template_id, {}).get(field_id, [])
