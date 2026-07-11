"""SSRA per-family field alias table.

v160.3.0-adjust-16f — Maps template field labels to the various ways the
same information appears in legacy Simpro PDF exports for the two SSRA
templates (VTS SSRA and Construction & Excavation SSRA). The parser
consults this table AFTER the template's own label fails to match — so
adding an alias is purely additive and never breaks a working match.

Keyed by `template_id` (submissions store this directly). Field ids
were extracted from the seeded `form_templates` collection.

Aliases are matched using the parser's existing `fuzzy_match_field`
(word-overlap ≥ 3). They don't need to be the exact PDF label — just
enough discriminative words to fuzzy-match.
"""
from __future__ import annotations

# Template IDs (from the seeded Paneltec templates).
VTS_SSRA_ID = "c69f9483-c845-4bfe-9524-26cc220d1806"
CE_SSRA_ID = "dc28f66a-a385-4a64-b5f0-d92bfd7b1798"

SSRA_FIELD_ALIASES: dict[str, dict[str, list[str]]] = {
    VTS_SSRA_ID: {
        # Site Address
        "6d441330-2052-48d8-92be-359afcb688f5": [
            "Please enter the Site Address",
        ],
        # Customer (PCBU)
        "9cafed50-3eac-43e2-861f-b77a1bb8390b": [
            "Who is the Company (PCBU) you are working for",
            "Company (PCBU)",
            "Customer / Asset Owner (PCBU)",
        ],
        # Customer name if 'Other'
        "50d94b22-c465-4916-b873-82ba3ca7d917": [
            "If other, please list",
            "If you selected Other above, please enter the customer here",
        ],
        # Site Contact Name
        "c96f28dd-bc0f-4e96-a77d-a1b9871e3872": [
            "Site Contact Name",
        ],
        # Site Contact Phone Number
        "0c6d1856-65b6-4ded-b62f-9f6abb56daf9": [
            "Site Contact Phone Number",
        ],
        # Rest of Traffic Management Team on site
        "12def45c-c3c2-4ac8-b87e-784cdb3425cb": [
            "Please Select the Rest of your Traffic Management Team from the List Below",
            "Rest of your Traffic Management Team",
        ],
        # Registration numbers of all Traffic Utes on site
        "62bbd89d-04db-47ac-9b1d-4ed7faa8e6ed": [
            "Please enter the Registration Number of all Traffic Utes on Site below",
            "Registration Number of all Traffic Utes",
        ],
        # Worksite Diary Number
        "1d5259d1-e599-4aae-beda-ca0b9f85bb15": [
            "Please enter the Worksite Diary Number that will accompany this SSRA",
            "Worksite Diary Number that will accompany",
        ],
        # Emergency Assembly Point
        "7b2c395c-45e5-4e6e-bbd5-9c5a34af4d1f": [
            "Designate below a Location for the Emergency Assembly Point",
            "Emergency Assembly Point",
        ],
        # Applicable SWMS onsite
        "469e6b8e-b26c-45fd-9453-00d547db35d6": [
            "Please confirm that you have a copy of the below SWMS onsite",
            "copy of the below SWMS onsite by checking the boxes",
        ],
        # Do any changes need to be made to the SWMS
        "1263e0cb-4db1-4c48-87f7-f8d59a845c22": [
            "Do any changes need to be made to the SWMS due to variable",
            "changes need to be made to the SWMS",
        ],
        # TGS Type in use
        "4af5919a-dd6d-45ab-af9f-54b60436dd39": [
            "TGS type used",
            "Traffic Guidance Scheme (TGS) in use",
        ],
        # TGS / Plan Number (fill in if A or B above)
        "c91ecdeb-474f-41f0-a9bf-d4fb52b131d3": [
            "If A or B is used above please note the TGS number below",
            "please note the plan number below",
            "please note the TGS number below",
        ],
        # If Viatec Generic TGS, identify the scheme
        "1a97156e-2267-485f-86fb-4e1e58f9b884": [
            "If you are using a Viatec Generic TGS please identify the scheme",
            "please identify the scheme in the checkbox",
        ],
        # Have all existing speed signs within the site been covered up
        "c210aeec-f60f-4bca-9d73-4da9cd8d1066": [
            "I confirm that all existing speed signs within the site have been covered up",
            "existing speed signs within the site have been covered up",
        ],
        # Have all Vehicle Daily Pre-Starts been completed
        "49fd5d0c-e7f8-4ff5-8c65-016fae85f3e9": [
            "Have all Vehicle Daily Pre-starts Been Completed",
        ],
        # Have all vehicles and equipment been parked on site
        "b4884693-3160-4d4b-9415-868a8a02232b": [
            "Have all vehicles and equipment been parked on site in an area",
            "parked on site in an area that will reduce",
        ],
        # Have all potential slips/trips/falls been identified
        "d7c1f7ce-5a03-44fa-ad99-d33a031ea598": [
            "Have all potential slips trips and falls been identified",
            "potential slips trips and falls been identified",
        ],
        # Have all other trades/civil teams communicated
        "11b51e70-bb86-4f39-bc5d-8962efde9cb9": [
            "Have all other trades/civil teams on site been communicated with regarding the scope of works",
            "other trades civil teams on site been communicated",
        ],
        # Falling objects assessment
        "1e9c729a-aff4-4578-8770-b69155a25534": [
            "Has an assessment been made for any potential falling objects on the site",
            "assessment been made for any potential falling objects",
        ],
        # Pedestrians being hit by plant
        "1936e474-7e1a-4591-8f03-778d205ccca4": [
            "Has an assessment been made of the potential for workers or pedestrians being hit by moving plant",
            "workers or pedestrians being hit by moving plant",
        ],
        # Impaling hazards risk
        "56f4c22e-658d-4a9b-ac79-0268d6949dae": [
            "Has the risk of injury been assessed from any impaling hazards",
            "impaling hazards present in your work area",
        ],
        # Detail rectification of hazards or control measures
        "7d1b00f2-7708-461a-913c-4051d6db3788": [
            "Please provide detail on the rectification or control measures implemented",
            "rectification or control measures implemented",
        ],
        # SSRA Complete
        "668058ff-4692-4589-90c4-201fa99e3a85": [
            "SSRA Complete",
            "Status Complete",
        ],
    },
    CE_SSRA_ID: {
        # Site Address
        "072d035f-a1be-4267-9fcb-b4067934c4f2": [
            "Please enter the Site Address",
        ],
        # Site Start Time
        "da474ff1-2655-4b26-8200-c3da37596982": [
            "Please Populate the Time Below",
        ],
        # Customer / Asset Owner (PCBU)
        "c481655b-a8d0-4dd5-8500-c65436686d7a": [
            "Who is the Company (PCBU) you are working for",
            "Company (PCBU)",
        ],
        # Worksite Diary Number
        "e211c65c-b4e9-47df-8fb1-a5da3331166e": [
            "Please enter the Worksite Diary Number that will accompany",
            "Worksite Diary Number that will accompany",
        ],
        # Rest of Civil Team on site
        "26b3970e-7806-4fc3-8092-93a69de4a9da": [
            "Please Select the Rest of your Civil Team from the List Below",
            "Rest of your Civil Team",
        ],
        # Work Description
        "72b2f85d-a4db-4470-8d13-2eb760f3badc": [
            "Please select the appropriate Work Description Below",
            "appropriate Work Description",
        ],
        # Emergency Assembly Point
        "4a564ba8-a845-4aba-819b-eeb1d92efadc": [
            "Designate below a Location for the Emergency Assembly Point",
            "Emergency Assembly Point",
        ],
        # BYDA Enquiry Number
        "ded3e7d4-bf86-4ac5-8c3d-6ae0f0bfc435": [
            "BYDA enquiry reference",
            "BYDA reference number",
            "Before You Dig Australia enquiry",
        ],
        # Traffic Guidance Scheme (TGS) in use
        "57bdcffa-acb5-4380-a716-75d34a328c09": [
            "TGS type used",
            "Traffic Guidance Scheme (TGS) in use",
        ],
        # TGS Number
        "dcc6ffe2-c021-4eda-b2ea-b283f3e9ac11": [
            "If A or B is used above please note the TGS number below",
            "please note the TGS number below",
        ],
        # Applicable SWMS
        "d72154ea-9863-44ea-89ed-41dc89da5e18": [
            "Please confirm that you have a copy of the below SWMS onsite",
            "copy of the below SWMS onsite by checking the boxes",
        ],
        # Vehicles/equipment parked
        "8413616f-646d-4959-a619-56977bced265": [
            "Have all vehicles and equipment been parked on site in an area",
        ],
        # Slips/trips/falls
        "9e05348b-b11e-4120-b6f4-fd97d2fce6ff": [
            "Have all potential slips trips and falls been identified",
        ],
        # Communicated with other trades/traffic controllers
        "96e726e2-8695-4c5d-b293-4b6b603ea68e": [
            "Have all other trades/civil teams on site been communicated with regarding the scope of works",
        ],
        # Falling objects
        "76facb64-5f13-471e-b105-22faa7658d1e": [
            "Has an assessment been made for any potential falling objects on the site",
        ],
        # Pedestrians hit by plant
        "bedeb1d1-8cbe-4fe6-91b1-b0c2350e41d3": [
            "Has an assessment been made of the potential for workers or pedestrians being hit by moving plant",
        ],
        # Detail rectification
        "f1bbc755-5698-43fc-b1c1-0f2afbcc4cd5": [
            "Please provide detail on the rectification or control measures implemented",
        ],
    },
}


def get_aliases(template_id: str | None, field_id: str) -> list[str]:
    """Return alias list for a (template_id, field_id) pair.
    Empty list if no aliases configured."""
    if not template_id:
        return []
    return SSRA_FIELD_ALIASES.get(template_id, {}).get(field_id, [])
