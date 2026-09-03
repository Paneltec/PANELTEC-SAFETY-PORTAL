# Comms Architecture Explainer — v58.13.86 pre-ship pause

> **Status**: architectural review, NO code changes made in this pass.
> Purpose: reset shared mental model before shipping anything else on
> comms. Every claim below is grounded in a code reference.

---

## 1. Comms Safe Mode — the real story

### What it ACTUALLY blocks

Safe Mode is a **boundary intercept on outbound comms** (email + SMS).
It does NOT stop the app API from working; it does NOT turn off any
database access; it does NOT affect Simpro / Navixy / MongoDB / any
other integration.

Concretely — every outbound comms path runs this check just before
handing bytes to the provider:

**Email path** (`backend/email_outbox.py:288-331`):
```
    from comms_safe_mode import is_blocked as _safe_blocked, record_blocked as _record_blocked
    safe_blocked = await _safe_blocked(org_id)
    ...
    if safe_blocked:
        doc["status"] = "blocked"
        doc["provider"] = "safe_mode"
        doc["error"] = "comms_safe_mode_on"
        await _record_blocked(channel="email", ...)  # audit row in comms_outbox_blocked
        await db.outbound_emails.insert_one(dict(doc))  # visible in Outbox UI
        return doc                                       # NEVER calls Microsoft Graph
```

**SMS path** (`backend/integrations_textmagic.py:180-196` for the manual
`POST /integrations/textmagic/send-sms` route, and lines 66-89 inside
`safe_send_sms()` used by cron/event flows):
```
    from comms_safe_mode import is_blocked, record_blocked
    if await is_blocked(user["org_id"]):
        await record_blocked(channel="sms", ...)
        return {"blocked": True, "reason": "comms_safe_mode_on", ...}
    ...                                                  # NEVER calls TextMagic
```

**Pattern**: "queue an audit row + return a success-shaped response
that says `blocked=true`." No upstream HTTP call is made. The row in
`comms_outbox_blocked` is for the admin to see what WOULD have been
sent; the row in `outbound_emails` (with `status="blocked"`) is what
shows up in the normal Outbox UI.

### What was its ORIGINAL purpose

Confirmed from code comments:

`backend/comms_safe_mode.py:1-14`:
> "Phase 4.7.3 — Comms Safe Mode.
> A single kill-switch that intercepts BOTH email and SMS at the
> provider boundary so previews / dev environments can't accidentally
> fire real messages at real recipients."

`backend/email_outbox.py:288-291`:
> "Phase 4.7.3 — Comms Safe Mode kill switch. Intercepts at the
> boundary so neither Graph API nor the queued-then-cron flow can
> fire while safe mode is on."

`frontend/src/lib/version.js:7839-7859` (v58.7.1 changelog):
> "User reported clicking 'Turn OFF' did nothing — root cause was
> that the locked-state visual signal was too subtle... `COMMS_SAFE_MODE=on`
> in `backend/.env` is untouched (that's an operator lift, not an app
> change)."

**Reading**: Safe Mode was introduced in Phase 4.7.3 as an emergency
"no more spam" switch. The user's recollection ("used to stop the
emails immediately because you were testing live messages to our
employees") matches the Phase 4.7.3 design intent verbatim. The env
var was added later (v58.7.x era) so an operator can lock it ON at
the environment level and no per-org UI toggle can flip it back off.

### Does the SYSTEM need it to be ON to function?

**No — architecturally, no.** The rest of the app (dashboards,
records, permissions, MongoDB, Simpro sync, Navixy sync, backup
service, notifications bell, PDF viewer, everything) works
identically whether Safe Mode is ON or OFF. Nothing depends on
Safe Mode being ON.

The user's statement "you need to turn it on otherwise the system
won't work" is a **policy statement, not an architectural one**.
Translation: *"leave it ON; if you turn it OFF you'll start
spraying live emails/SMS at real workers."* That is correct
guidance and the code will oblige — the ON position is the safe
default and IS what's currently active on preview.

### What Safe Mode disarms

Only the two outbound-comms integrations. Confirmed at
`backend/health_extras.py:191, 240` (`_check_m365` and
`_check_textmagic` accept a `safe_mode_on: bool` and return
`disarmed: True` when ON) vs `_check_simpro` (line 87) and
`_check_navixy` (line 138) which take no safe-mode arg — they
ignore it entirely.

Summary:
| Integration | Affected by Safe Mode |
|---|---|
| Microsoft 365 (email) | YES — outbound Graph calls suppressed |
| TextMagic (SMS) | YES — outbound HTTP calls suppressed |
| Simpro (data sync) | **NO** |
| Navixy (vehicle tracking) | **NO** |
| MongoDB / GridFS | **NO** |
| Server Tools (LibreOffice / Tesseract / Poppler) | **NO** |
| In-app notifications (bell) | **NO** — see §2 |

### Current state

| Environment | `COMMS_SAFE_MODE` env | `org_settings.comms_safe_mode` | Effective |
|---|---|---|---|
| Preview (right now) | `on` (env-locked) | unset | **ON** (env wins) |
| Prod | (user to confirm — I don't have prod pod access) | ? | ? |

Env lock precedence: `comms_safe_mode.py:44-46`:
```
async def effective_mode(org_id: str) -> str:
    if env_is_master_on():
        return "on"                           # env locks ON
    return await org_setting(org_id)          # otherwise per-org
```

### How was it originally triggered

I cannot see git history in this environment (`git log` returns
empty). Based on the code comments and the v58.7.1 UX-hardening
changelog entry ("User reported clicking 'Turn OFF' did nothing"),
the sequence appears to have been:
1. **Phase 4.7.3** — a live-test incident where testing on the
   preview pod fired real emails/SMS at real Paneltec workers.
   Response: introduce Safe Mode as a kill switch.
2. **v58.7.1** — UX hardening after user pain around the env lock
   not being visually obvious enough (they clicked Turn OFF and
   nothing happened; the greyed-out state wasn't loud enough).
3. **v58.13.85** — discovery of 3 SMS bypass sites that were making
   raw `httpx` calls to TextMagic, bypassing Safe Mode entirely.
   Fixed by centralising all SMS through `safe_send_sms()`.

If the user wants me to search for a specific dated incident
(support ticket, email, Slack message), I can't from here — the
code trail is the only evidence available.

---

## 2. "Notices" vs "Emails" — the user's distinction

Confirmed: the user is separating **in-app notifications** from
**outbound email/SMS**. The code makes exactly this distinction.

### In-app notifications (the bell icon)

- Backend: `backend/notifications.py`
- Docstring (lines 1-14):
  > "v160.3.9.57 — Notifications API for the header bell.
  > Aggregates unread compliance signals from four sources:
  > 1. Expiring certifications      → worker_certifications
  > 2. Overdue / expired renewals   → renewal_links
  > 3. Failed integration syncs     → integration_configs
  > 4. Pending approvals            → swms (status: awaiting_approval / draft)"
- **Zero references to `safe_mode` / `queue_email_doc` / `safe_send_sms`
  anywhere in `notifications.py`** (grep confirms). The bell is
  entirely read-only aggregation of what's already in the DB. It
  never touches Graph or TextMagic. **Safe Mode does not affect the
  bell.**

### Outbound email / SMS

- Backend: `backend/email_outbox.py`, `backend/integrations_textmagic.py`
- Both gated by Safe Mode (§1).

### The user's directive verbatim reconciles with the code

> "coms safe mode... this has nothing to do with the notices being
> sent out it was used to stop the emails"

**Correct.** The bell (notices) is completely separate. Safe Mode is
about outbound comms only. My earlier ships were conflating the two
in my head; they are architecturally distinct.

---

## 3. The Blocked Outbox — what it ACTUALLY records

Definition: `db.comms_outbox_blocked` collection. Every insert comes
from **one and only one function**: `comms_safe_mode.record_blocked()`
(`backend/comms_safe_mode.py:53-101`).

### What gets recorded

An entry is written IF AND ONLY IF a call to `queue_email_doc` or
`safe_send_sms` (or the old direct `tm_send`) reached the Safe Mode
branch AND Safe Mode returned `is_blocked == True`. The row includes:
- `channel` ("email" | "sms")
- `to` (recipients)
- `subject` / `body` (for the outbox composer's view)
- `triggered_by_endpoint` (e.g. `"queue_email_doc"`, `"asset_service.scan_reminders"`)
- `actor_user_id` (if a real user id was passed in `created_by`) or
  `None` (system source)
- `ts` (ISO)

**No filtering** — every intercepted send is recorded. It is NOT
category-selective and NOT legacy scaffolding.

### Pre-.85 vs post-.85

| State | Count | Composition | Cause |
|---|---|---|---|
| Pre-.85 preview | 175 rows | 112 form_assignment_notifier + 39 system cron + 24 real Stephen actions | Safe Mode ON; every automated + user-triggered send got captured |
| .85 preview one-off prune | 100 rows | Retention rule kept the last 100 | Applied `keep newest 100 OR last 7 days` on-insert prune |
| .85 admin Clear button | 0 rows | Emptied by admin | `DELETE /api/admin/comms-outbox-blocked` fired |

### Interpretation

The 175 pre-.85 rows are evidence of **both** things happening:
1. Safe Mode was **doing its job correctly** — it caught 175 sends
   that would otherwise have hit real recipients.
2. The **automated call sites were still firing anyway**, generating
   noise in the audit log. The user is saying "I don't want them to
   fire at all — not even to be intercepted."

Those two views can be reconciled: **Safe Mode is a safety net;
deleting the automatic call sites is the *right* fix**. Safe Mode
stays ON as insurance, but nothing routine should ever land in the
blocked outbox because nothing routine should even attempt a send.

---

## 4. Is my proposed v58.13.86 "Auto Comms" flag redundant?

**Short answer: not strictly redundant, but overengineered given the
user's stated preference.**

### What Safe Mode does today
- Every send call site runs
- Safe Mode boundary intercepts
- Audit row queued to `comms_outbox_blocked`
- Row in `outbound_emails` with `status="blocked"` shows in the Outbox UI

Result: **all sends are blocked, but they all execute up to the
provider boundary — filling audit rows.**

### What my proposed AUTO_COMMS_ENABLED does today (already shipped in
`.86` code, but not yet green-lit)
- If `source == "system"` AND `auto_comms_enabled == false`
- Return silently BEFORE writing to either `outbound_emails` or
  `comms_outbox_blocked`
- Log line only; no user-visible audit row

Result: **automatic sends never reach the audit log. Only manual
sends can appear in the outbox at all.**

### The distinction
- Safe Mode = **belt** — catch anything that slipped through and
  hold it visibly for audit
- Auto Comms = **stop-at-source** — never even attempt automatic
  sends; audit log stays clean

They serve different purposes and compose. But for the user's stated
policy ("I don't want anything sent automatically. When I want to
send an email or SMS, I'll click a button.") there is a THIRD, simpler
option:

### Option 3 — delete the automatic call sites entirely

Instead of a new toggle:
1. Delete the `run_reminder_scan()` call at `server.py:837-842` —
   this is the ONLY startup-fired automatic scan in the codebase.
2. Delete or gate the `dispatch_diff()` call in
   `asset_service.py:711` and `:756` — currently fires an
   assignment-notification email whenever an admin saves the
   applies-to targets on a form template.
3. Keep the on-demand admin endpoints
   (`POST /assets/service/scan-reminders`, `POST /worker-
   certifications/reminders/scan`) so an admin can still fire a
   scan manually when they want to.

Result: **the system has zero automated send paths.** Every send
requires a click. Safe Mode is now purely a paranoia safety net —
even if a future junior dev adds a new automatic send, Safe Mode
will still catch it.

This matches the user's actual policy 1:1, needs the least code, and
removes a class of bug rather than adding a new gate.

---

## 5. Every send site — enumerated with trigger classification

Grep of `queue_email_doc` and `safe_send_sms` callers, plus the
`tm_send` `POST /integrations/textmagic/send-sms` route (grep
`backend/*.py`, verified against wire behaviour):

| # | Site | File:line | Trigger | Frequency | Currently gated |
|---|---|---|---|---|---|
| 1 | `_send_invite_email` (invite + password reset) | `auth_invite.py:129` | **User click** — admin clicks Send Invite / Send Reset; OR user clicks "Forgot Password" on login page | On-demand only | Safe Mode ON → blocked to outbox |
| 2 | `send_email` (POST /email/send from the Outbox composer) | `email_outbox.py:371-378` | **User click** — admin composes an email in the Outbox and clicks Send | On-demand only | Safe Mode ON → blocked to outbox |
| 3-12 | 10 record-scoped `email_XXX` helpers (SWMS, prestart, site_diary, hazard, incident, inspection, contractor, renewal, audit_export, and 1 duplicate) | `email_outbox.py:576-756` | **User click** — admin clicks "Email" on a record detail page | On-demand only | Safe Mode ON → blocked to outbox |
| 13 | `send_renewal` (POST /suppliers/{id}/send-renewal) | `suppliers.py:238` | **User click** — admin clicks "Send Renewal" on a supplier row | On-demand only | Safe Mode ON → blocked to outbox |
| 14 | `_send_one_reminder` inside `run_reminder_scan` | `worker_certifications.py:886, 912` (email) + `:863` (SMS) | **Automatic** on backend startup (`server.py:838`) — cron **not** installed; only fires once at process start | Once per pod restart | Safe Mode ON → blocked to outbox |
| 15 | `_send_one_reminder` inside `send_cert_reminder_now` (POST /worker-certifications/{id}/reminders/send-now) | same helper, `worker_certifications.py:956` | **User click** — admin fires a specific cert reminder manually | On-demand only | Safe Mode ON → blocked to outbox |
| 16 | `asset_service.scan_reminders` (POST /assets/service/scan-reminders) | `asset_service.py:1406` (email) + `:1426` (SMS) | **User click** — admin manually triggers the scan | On-demand only | Safe Mode ON → blocked to outbox |
| 17 | `form_assignment_notifier.dispatch_diff` — side effect of `POST /form-templates/{id}/assignments` | `form_assignment_notifier.py:103` (email) + `:128` (SMS) | **Automatic** on user save (admin saves assignments → email/SMS fires at newly-exposed workers) | Whenever an admin saves template assignments | Safe Mode ON → blocked to outbox |
| 18 | `tm_send` (POST /integrations/textmagic/send-sms) — the raw single-SMS admin endpoint | `integrations_textmagic.py:180-197` | **User click** — admin sends a one-off SMS via the integration test UI | On-demand only | Safe Mode ON → 200 with `blocked:true` |

### Summary counts

| Category | Sites | Notes |
|---|---|---|
| **User-click, on-demand** | 14 sites (#1-13, #15, #16, #18) | Aligns with user's directive — an explicit button click |
| **Automatic (startup fire)** | 1 site (#14) | Startup-only. Only true "cron-like" behaviour. |
| **Automatic (event side-effect)** | 1 site (#17) | Fires as side effect of assignment save — no explicit send button |

**No scheduled cron jobs for comms.** APScheduler jobs at
`server.py:1018-1200` cover Navixy sync, Simpro sync, SWMS purge,
meter history, bulk-import watchdog, backups — none of them touch
comms.

### The two paths that the user's directive says to eliminate

**Path A — `run_reminder_scan()` at startup** (`server.py:837-842`).
Fires on every backend restart. This is what creates the "39 system
cron" rows in the blocked outbox. Deleting these 6 lines makes the
scan purely on-demand (the admin endpoint `POST /worker-
certifications/reminders/scan` still exists — line 1029 — so an
admin can still fire it when wanted).

**Path B — `dispatch_diff()` side effect on assignment save**
(`asset_service.py:709-716` and `:728-758`). Every time an admin
saves a template's `applies_to`, this fires an email + SMS at newly
exposed workers. This is what creates the "112 form_assignment
notifier" rows. Recommended replacement: return the diff to the
caller so the admin sees "You just added 5 new workers to this form
— [Notify them now] [Skip]" and can choose. Keep the notifier
function but only fire from an explicit button click.

---

## 6. Manual-send UX — what exists today

Grep of `Send invite | Send reset | Send renewal | Send reminder |
Notify` across `/app/frontend/src/`:

| Send flow | Manual button exists? | Where |
|---|---|---|
| Invite user | REMOVED in v160.3.9.32-4c.1 (`AccessKebab.jsx:88` comment: `"Send invite…" removed. Backend returns 410`) — so no button; server rejects the call | N/A |
| Reset user password | YES — `AccessKebab.jsx:111` "Send reset link" + `UsersManagement.jsx:2531` "Send reset link" | Admin User panel + kebab menu |
| Password reset self-serve | YES — login page "Forgot Password" | Auth flow |
| Send renewal to supplier | YES — `Suppliers.jsx` (grep found in the file but not immediate visible button name — needs a click-through to confirm; the endpoint `POST /suppliers/{id}/send-renewal` requires a caller UI) | `Suppliers.jsx` |
| Notify worker on cert expiring | YES — admin can call `POST /worker-certifications/{id}/reminders/send-now` (visible in `worker_certifications.py:940-960`) | Requires UI verification — I haven't traced the exact React button |
| Notify workers on assignment save | **NO** — currently automatic side effect (Path B above) |
| Email record for review (SWMS/prestart/etc.) | YES — 10 record-scoped `Email` buttons | Each record page |
| Send single test SMS via TextMagic UI | YES — `TextMagicAdmin.jsx` "Test connection" + `POST /integrations/textmagic/send-sms` for a one-off | Admin integrations page |

### Gaps to note (NO code change in this pass)

1. **Invite flow has no button** — the create-user flow currently
   does NOT auto-fire an invite email (`AccessKebab.jsx` says "Send
   invite removed. Backend returns 410"). If the user wants to
   invite someone they need to trigger a password-reset flow instead.
   Not obvious. **This is a UX gap** — recommend adding a "Send
   invite link" button next to the create-user Save button.

2. **Assignment save auto-notifies** — no button, fires side-effect
   comms. Recommend replacing with a "N workers newly assigned —
   [Notify them] [Skip]" prompt after save.

3. **Cert expiry reminder button visibility** — the endpoint exists,
   but I haven't traced the exact button placement in
   `WorkerCertifications.jsx` / similar. If the admin can't easily
   find it, they can't fire it. **UX audit needed.**

---

## Where I got confused and what I now think is right

**My earlier framing (v58.13.85 / v58.13.86)**: two switches
(Safe Mode + Auto Comms), with fancy gate ordering. The user's
critique: "I've been trying to say — I want nothing automatic. Full
stop." My framing added complexity that wasn't required.

**Cleaner framing given the user's directive**:
1. **Delete the two automatic call sites** (Path A + Path B above).
   That's the whole feature the user is asking to remove.
2. **Leave Safe Mode as-is** — env-locked ON on preview, admin-
   controllable on prod once the user is ready to enable outbound.
3. **Optionally KEEP the AUTO_COMMS_ENABLED toggle** as insurance,
   but its scope shrinks to "safety net if a future dev re-adds an
   automatic call site". It becomes a nice-to-have, not the main
   fix.
4. **Add the missing manual-send buttons** where gaps exist
   (invite flow, assignment-diff-notify, cert reminder discovery).
5. **The blocked outbox retention + Clear button from v58.13.85 stay**
   — even in the "delete-the-sources" world, they're useful because
   Safe Mode will still capture the user's own on-demand sends.

That's what I should propose for the actual v58.13.86 (or .87)
scope. But I'll wait for the user's decision.

---

## What I need from the user before shipping

Confirm which of these to do in the next ship, and I'll scope it
accordingly:

1. **Delete Path A** (`server.py:837-842` startup reminder scan)?
2. **Refactor Path B** (assignment-save side-effect notify) —
   remove the auto-fire, add a "Notify N workers?" prompt in the
   admin UI?
3. **Keep the `AUTO_COMMS_ENABLED` toggle** I built in v58.13.86, or
   revert it as overengineered?
4. **Add the missing manual-send buttons** (invite, cert reminder
   discovery) in this ship or a follow-up?
5. **On prod**: leave `COMMS_SAFE_MODE` unset (defaults ON) or
   explicitly set `COMMS_SAFE_MODE=on` in `backend/.env`?
6. **Preview state right now**: Safe Mode locked ON via env var,
   Auto Comms disabled per org — matching the user's stated policy.
   No sends will fire until Safe Mode is turned OFF. Confirm this
   is the desired state.

---

**End of explainer. No code changes made. Awaiting green light on
the next scope.**
