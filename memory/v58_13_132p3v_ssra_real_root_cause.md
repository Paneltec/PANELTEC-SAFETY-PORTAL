# Ship `.132p3v` — SSRA real root cause: form_routing.py startup migration

## ACTUAL ROOT CAUSE
`backend/form_routing.py` line 107-133: `NAME_PATTERN_SEED_RULES` hardcoded
all three SSRA templates with `"destination_category": "risk_assessment"`.

On every backend startup, `ensure_form_routing_rules()` (called from
`server.py:1060`) checks each template's category against the rule's
`destination_category`. If they differ, it **overwrites** the template's
category (line 280-289). So:

1. User sets "Construction & Excavation SSRA" to `category: "ssra"` ✓
2. Backend restarts (deploy, crash, scheduler reload)
3. `ensure_form_routing_rules()` sees `ssra != risk_assessment` → flips it back
4. User sees "General" or "Risk Assessment" instead of "SSRA"

This is why previous fixes (.132p3p ALLOWED_CATEGORIES, .132p3q cache bump)
didn't help — the backend startup migration overwrote the fix on every restart.

## Fix
Changed `destination_category` from `"risk_assessment"` to `"ssra"` for all
three SSRA templates in `NAME_PATTERN_SEED_RULES`. Now the startup migration
flips TO `ssra` instead of away from it.

## Verification
1. Restarted backend → all 3 templates now `category: "ssra"` ✓
2. Set to general via PATCH → `general` ✓
3. Set back to ssra → `ssra` ✓
4. **Restarted backend again** → `category: "ssra"` (not reverted!) ✓
5. Routing rules also updated to `destination_category: "ssra"` ✓

## All write endpoints checked
| Endpoint | File:Line | Writes category? |
|----------|-----------|-----------------|
| POST /forms/templates | forms.py:1039 | Yes, via _norm_category() |
| PATCH /forms/templates/{id} | forms.py:1064 | Yes, via _norm_category() |
| ensure_form_routing_rules() | form_routing.py:275-289 | **Yes — THIS WAS THE BUG** |

## Files touched
- `backend/form_routing.py` — changed destination_category from "risk_assessment" to "ssra" in 3 rules
