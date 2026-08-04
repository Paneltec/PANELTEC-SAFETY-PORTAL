"""v160.3.9.46 — Role hygiene: P2-GENERAL trim, P2-CREATOR fix,
P2-CLEANUP ephemeral test-fixture sweep. Bundled + idempotent."""
from __future__ import annotations
import logging, re
from datetime import datetime, timezone
from collections import Counter

log = logging.getLogger("paneltec.migrations.v46")

MARKER_ID = "v160_3_9_46_role_hygiene"

_EPHEMERAL_ROLE_NAME_RE = re.compile(
    r"^(Test Auditor |Schema Filter |Forms Test |CacheBust |Fallback Test |"
    r"Curl (Demo Auditor|Forms Demo)|Demo Regional Auditor|"
    r"Test Custom Role QA|Test Forms QA Role)"
)

# v46 Part E — Ephemeral test-fixture USER sweep. Strict regex + hard
# exclusion of Stephen and the primary admin. Only deletes users whose
# email OR name unambiguously signals "test fixture".
_STEPHEN_EXCLUDES = {"stephen@paneltec.com.au", "admin@paneltec.com.au"}
_EPHEMERAL_USER_EMAIL_RE = re.compile(
    r"^(pytest|__probe|__v[0-9_]+|__test|test[0-9]+@|warmup-test|"
    r"cachebust|receipt_mgr@|tester@|testagent@|test_agent|test_user|"
    r"testuser|test_outbox|test1@|test2@)",
    re.IGNORECASE,
)
_EPHEMERAL_USER_TEST_DOMAINS = ("@example.com", "@example.invalid",
                                "@example.org", "@example.net")
_EPHEMERAL_USER_NAME_RE = re.compile(
    r"^(Pytest Ephemeral|Test One|Test Two|Test Outbox User|Warmup Test|"
    r"CacheBust|Curl Demo|Fixture|Demo Regional|Test User|Test Agent|"
    r"Alex Admin)",
    re.IGNORECASE,
)


async def run_v46_migration(db) -> dict:
    marker = await db.bk_migrations.find_one({"id": MARKER_ID})
    if marker and marker.get("completed_at"):
        log.info("[v46] role-hygiene migration already applied at %s",
                 marker.get("completed_at"))
        return {"skipped": True, "reason": "marker_present"}

    now = datetime.now(timezone.utc).isoformat()
    actions = {"general_user": None, "hseq_creator": None,
               "deleted_roles": [], "skipped_roles": [],
               "empty_overrides_deleted": 0}

    # ── Part A — general_user token trim + self-service cert view ──
    gu = await db.roles.find_one({"name": "General User"}, {"_id": 0, "permission_tokens": 1})
    if gu:
        before = list(gu.get("permission_tokens") or [])
        after = sorted(set(before) - {"contractors.edit"} | {"certifications.view"})
        await db.roles.update_one(
            {"name": "General User"},
            {"$set": {"permission_tokens": after, "updated_at": now}},
        )
        actions["general_user"] = {
            "before_count": len(before), "after_count": len(after),
            "removed": ["contractors.edit"] if "contractors.edit" in before else [],
            "added": ["certifications.view"] if "certifications.view" not in before else [],
        }

    # ── Part B — HSEQ Manager (Creator) — add forms.edit ──
    hc = await db.roles.find_one({"name": "HSEQ Manager (Creator)"},
                                  {"_id": 0, "permission_tokens": 1})
    if hc:
        before = list(hc.get("permission_tokens") or [])
        after = sorted(set(before) | {"forms.edit"})
        await db.roles.update_one(
            {"name": "HSEQ Manager (Creator)"},
            {"$set": {"permission_tokens": after, "updated_at": now}},
        )
        actions["hseq_creator"] = {
            "before_count": len(before), "after_count": len(after),
            "added": ["forms.edit"] if "forms.edit" not in before else [],
        }

    # ── Part C — Ephemeral fixture-role cleanup ──
    cursor = db.roles.find({}, {"_id": 0, "id": 1, "name": 1})
    async for r in cursor:
        name = r.get("name") or ""
        if not _EPHEMERAL_ROLE_NAME_RE.match(name):
            continue
        rid = r.get("id")
        if not rid:
            continue
        n_users = await db.users.count_documents({"role_id": rid})
        if n_users > 0:
            actions["skipped_roles"].append({"name": name, "users": n_users})
            log.warning("[v46] SKIPPING role '%s' (id=%s..) — %d active user(s)",
                        name, rid[:8], n_users)
            continue
        res = await db.roles.delete_one({"id": rid})
        if res.deleted_count == 1:
            actions["deleted_roles"].append(name)

    # ── Sweep empty user_permissions rows ──
    up_res = await db.user_permissions.delete_many({"overrides": {}})
    actions["empty_overrides_deleted"] = up_res.deleted_count

    # ── Part E — Ephemeral test-fixture USER sweep ──
    # Hard-exclude Stephen + primary admin. Match strict regex on email
    # OR test-domain OR test-name-prefix. Never touches production users.
    actions["deleted_users"] = []
    actions["skipped_users"] = []
    async for u in db.users.find(
        {}, {"_id": 0, "id": 1, "email": 1, "name": 1, "role_id": 1,
             "activation_status": 1},
    ):
        email = (u.get("email") or "").lower()
        name = u.get("name") or ""
        uid = u.get("id")
        if not uid or email in _STEPHEN_EXCLUDES:
            continue
        matches_email = (
            bool(_EPHEMERAL_USER_EMAIL_RE.search(email))
            or any(email.endswith(d) for d in _EPHEMERAL_USER_TEST_DOMAINS)
        )
        matches_name = bool(_EPHEMERAL_USER_NAME_RE.match(name))
        if not (matches_email or matches_name):
            continue
        # Extra safety: refuse to delete the last active admin in ANY org.
        if u.get("role_id") == "admin" and u.get("activation_status") == "active":
            org_id = u.get("org_id")
            others = await db.users.count_documents({
                "role_id": "admin", "activation_status": "active",
                "org_id": org_id, "id": {"$ne": uid},
            }) if org_id else 1
            if others == 0:
                actions["skipped_users"].append({
                    "id": uid, "email": email, "name": name,
                    "reason": "last-active-admin",
                })
                log.warning("[v46] SKIP delete %s — last active admin in org", email)
                continue
        res = await db.users.delete_one({"id": uid})
        if res.deleted_count == 1:
            actions["deleted_users"].append(
                {"id": uid, "email": email, "name": name,
                 "role_id": u.get("role_id"),
                 "status": u.get("activation_status")}
            )
    log.info("[v46] test-fixture user sweep: %d deleted, %d skipped",
             len(actions["deleted_users"]), len(actions["skipped_users"]))

    # ── Marker LAST (rollback-safe) ──
    await db.bk_migrations.update_one(
        {"id": MARKER_ID},
        {"$set": {"id": MARKER_ID, "completed_at": now, "actions": actions}},
        upsert=True,
    )
    log.info(
        "[v46] role-hygiene applied · general_user %d→%d · hseq_creator %d→%d · "
        "%d fixture roles deleted, %d skipped · %d empty overrides swept",
        (actions["general_user"] or {}).get("before_count", 0),
        (actions["general_user"] or {}).get("after_count", 0),
        (actions["hseq_creator"] or {}).get("before_count", 0),
        (actions["hseq_creator"] or {}).get("after_count", 0),
        len(actions["deleted_roles"]), len(actions["skipped_roles"]),
        actions["empty_overrides_deleted"],
    )
    return {"skipped": False, "actions": actions}


async def report_permissions_resolution(db) -> None:
    """v46 Part D — INFO log summarising how many active users resolve
    via `db.roles.permission_tokens` vs the hardcoded fallback."""
    try:
        role_docs_with_tokens = set()
        async for r in db.roles.find(
            {"permission_tokens": {"$exists": True, "$not": {"$size": 0}}},
            {"_id": 0, "name": 1},
        ):
            role_docs_with_tokens.add(
                (r.get("name") or "").lower().replace(" ", "")
            )
        via_db = via_fb = 0
        fb_counter: Counter[str] = Counter()
        async for u in db.users.find(
            {"is_archived": {"$ne": True}, "activation_status": "active"},
            {"_id": 0, "role_id": 1},
        ):
            rid = (u.get("role_id") or "").lower()
            if rid.startswith("custom_"):
                want = rid[7:].replace("_", "").replace(" ", "")
                if any(want == n for n in role_docs_with_tokens):
                    via_db += 1
                    continue
            via_fb += 1
            fb_counter[rid or "(none)"] += 1
        rank = ", ".join(f"{k}={v}" for k, v in fb_counter.most_common(6))
        log.info(
            "[permissions] resolution: %d via db.roles.tokens, %d via "
            "hardcoded fallback (rank order: %s)", via_db, via_fb, rank,
        )
    except Exception as e:
        log.warning("[permissions] resolution report failed: %s", e)
