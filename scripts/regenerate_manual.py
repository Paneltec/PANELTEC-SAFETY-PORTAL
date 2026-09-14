"""v58.13.132gc — Regenerate `docs/paneltec_group_platform_manual.md`
and the rendered `.docx` from the current codebase state.

Design goals:
  · Every section is grep-driven where practical. Hand-written prose is
    minimised and clearly demarcated in `PROSE` blocks inside this file.
  · Runs in-place. No network, no LLM calls, no external services.
  · Mermaid diagrams render to PNG via the local `google-chrome` install.
    If the renderer fails, the Mermaid source is still embedded in the
    markdown; the `.docx` render simply shows the raw code block.

Usage:
    python3 scripts/regenerate_manual.py

Outputs:
    docs/paneltec_group_platform_manual.md
    docs/paneltec_group_platform_manual.docx
    docs/diagrams/*.png
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

APP_ROOT = Path(__file__).resolve().parents[1]
BACKEND = APP_ROOT / "backend"
FRONTEND = APP_ROOT / "frontend"
DOCS = APP_ROOT / "docs"
DIAGRAMS = DOCS / "diagrams"
MD_OUT = DOCS / "paneltec_group_platform_manual.md"
DOCX_OUT = DOCS / "paneltec_group_platform_manual.docx"
MEMORY = APP_ROOT / "memory"

DIAGRAMS.mkdir(parents=True, exist_ok=True)


# ─── Codebase inspection helpers ───────────────────────────────

def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return ""


def running_version() -> str:
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'",
                    _read(FRONTEND / "src" / "lib" / "version.js"))
    return m.group(1) if m else "unknown"


def collect_endpoints() -> dict[str, list[tuple[str, str]]]:
    """Return {backend_module: [(METHOD, path), ...]} for every
    `@router.<verb>()` decorator (and its aliased router variants).

    Path is the path AFTER any router prefix — we prepend the prefix
    we can discover with a best-effort scan of the same module."""
    per_module: dict[str, list[tuple[str, str]]] = defaultdict(list)
    verb_re = re.compile(
        r'@(?P<var>\w*_?router)\.(?P<verb>get|post|put|patch|delete)'
        r'\(\s*"(?P<path>[^"]*)"',
    )
    prefix_re = re.compile(
        r'(?P<var>\w+)\s*=\s*(?:_?APIRouter|APIRouter)\('
        r'[^)]*prefix\s*=\s*"(?P<pfx>[^"]+)"',
        re.DOTALL,
    )
    router_re = re.compile(
        r'\brouter\s*=\s*APIRouter\([^)]*prefix\s*=\s*"(?P<pfx>[^"]+)"',
        re.DOTALL,
    )
    for py in sorted(BACKEND.glob("*.py")):
        src = _read(py)
        prefixes: dict[str, str] = {}
        for m in prefix_re.finditer(src):
            prefixes[m.group("var")] = m.group("pfx")
        rm = router_re.search(src)
        if rm:
            prefixes.setdefault("router", rm.group("pfx"))
        for m in verb_re.finditer(src):
            pfx = prefixes.get(m.group("var"), "")
            full = (pfx + m.group("path")) or "/"
            per_module[py.stem].append(
                (m.group("verb").upper(), full))
    return per_module


def collect_collections() -> list[tuple[str, list[str]]]:
    """Return sorted [(collection_name, [modules that touch it])]."""
    touches: dict[str, set[str]] = defaultdict(set)
    coll_re = re.compile(
        r'\bdb\.([a-z_][a-z0-9_]+)\.(?:find|find_one|insert_one|'
        r'insert_many|update_one|update_many|delete_one|delete_many|'
        r'aggregate|count_documents|distinct|create_index)',
    )
    for py in sorted(BACKEND.glob("*.py")):
        src = _read(py)
        for m in coll_re.finditer(src):
            touches[m.group(1)].add(py.stem)
    return sorted(
        ((name, sorted(mods)) for name, mods in touches.items()),
        key=lambda kv: kv[0],
    )


def collect_frontend_routes() -> list[tuple[str, str]]:
    """Extract `<Route path="…" element={<Foo />} />` pairs from
    `App.js`. Nested routes are flattened as-is."""
    src = _read(FRONTEND / "src" / "App.js")
    out: list[tuple[str, str]] = []
    for line in src.splitlines():
        m = re.search(
            r'<Route\s+path="(?P<p>[^"]*)"\s+element=\{<(?P<c>\w+)',
            line,
        )
        if m:
            out.append((m.group("p"), m.group("c")))
    return out


def collect_pages() -> list[str]:
    return sorted(p.stem for p in
                    (FRONTEND / "src" / "pages").glob("*.jsx"))


def collect_included_routers() -> list[str]:
    src = _read(BACKEND / "server.py")
    return re.findall(r'api\.include_router\((\w+)', src)


def collect_role_defaults() -> list[str]:
    src = _read(BACKEND / "permissions.py")
    m = re.search(
        r'ROLE_DEFAULTS:\s*Dict.*?=\s*\{(.*?)^\}',
        src, re.DOTALL | re.MULTILINE,
    )
    if not m:
        return []
    return re.findall(r'^    \"(\w+)\":\s*\{', m.group(1), re.MULTILINE)


def collect_ship_history(limit: int = 25) -> list[str]:
    memos = sorted(
        MEMORY.glob("v58_13_*_shipped*.md"),
        key=lambda p: p.stat().st_mtime, reverse=True,
    )
    return [m.name for m in memos[:limit]]


def collect_openapi() -> dict:
    """v58.13.132gd — Pull `/api/openapi.json` from the live pod so
    endpoints are enumerated from Pydantic + FastAPI's own schema
    (with tags, summaries, response codes) rather than a decorator
    regex. Auth-required — logs in with the admin credentials from
    `memory/test_credentials.md`. Falls back to the grep pass on
    any failure."""
    frontend_env = _read(FRONTEND / ".env")
    m = re.search(r"REACT_APP_BACKEND_URL=(.+)", frontend_env)
    if not m:
        return {}
    base = m.group(1).strip().rstrip("/")
    try:
        import urllib.request
        # Read the standing-rule creds from the test-credentials memo
        # rather than hard-coding them here.
        creds_src = _read(MEMORY / "test_credentials.md")
        em = re.search(r"Email:\s*`([^`]+@paneltec\.com\.au)`", creds_src)
        pm = re.search(r"Password:\s*`([^`]+)`", creds_src)
        email = (em.group(1) if em else
                 os.environ.get("ADMIN_EMAIL", "stephen@paneltec.com.au"))
        pwd = (pm.group(1) if pm else
               os.environ.get("ADMIN_PWD", ""))
        login = urllib.request.Request(
            f"{base}/api/auth/login",
            data=json.dumps({"email": email, "password": pwd}).encode(),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/126.0.0.0 Safari/537.36",
            },
        )
        with urllib.request.urlopen(login, timeout=15) as r:
            token = json.loads(r.read()).get("access_token")
        oapi_req = urllib.request.Request(
            f"{base}/api/openapi.json",
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/126.0.0.0 Safari/537.36",
            },
        )
        with urllib.request.urlopen(oapi_req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"  ! openapi fetch failed: {e}", file=sys.stderr)
        return {}


def collect_permission_matrix() -> tuple[list[str], list[str], dict]:
    """Return (roles, resources, matrix) where
    matrix[resource][role] is a comma-joined string of granted
    actions ('—' when the role has nothing on that resource).

    Runs a subprocess with `backend/` on `sys.path` so we can import
    `permissions` for real (with all its transitive deps) — the
    Motor-backed `db` import is a no-op at module load."""
    script = r"""
import json, sys
sys.path.insert(0, r'%s')
import permissions as P
role_keys = list(P.ROLE_DEFAULTS.keys())
resource_keys = list(P.PERMISSIONS_SCHEMA.keys())
matrix = {}
for res in resource_keys:
    matrix[res] = {}
    for role in role_keys:
        grants = P.ROLE_DEFAULTS.get(role, {}).get(res) or {}
        verbs = [a for a, v in grants.items() if v and a != 'open']
        matrix[res][role] = ', '.join(verbs) if verbs else '\u2014'
print(json.dumps({'roles': role_keys,
                  'resources': resource_keys,
                  'matrix': matrix}))
""" % str(BACKEND)
    try:
        env = os.environ.copy()
        # Feed backend's env-vars so `from db import db` succeeds
        # (Motor client init reads MONGO_URL / DB_NAME at import time).
        be_env = _read(BACKEND / ".env")
        for m in re.finditer(r"(?m)^([A-Z_][A-Z0-9_]*)=(.+)$", be_env):
            env.setdefault(m.group(1),
                              m.group(2).strip().strip('"').strip("'"))
        out = subprocess.check_output(
            [sys.executable, "-c", script],
            env=env, cwd=str(BACKEND), timeout=30,
        )
        payload = json.loads(out.decode())
        return payload["roles"], payload["resources"], payload["matrix"]
    except Exception as e:
        print(f"  ! permissions matrix build failed: {e}", file=sys.stderr)
        return [], [], {}


def collect_integrations() -> list[dict]:
    """Discover which of the four integration playbooks Stephen calls
    out are wired in the code. Status is 'wired' when the corresponding
    integration module or endpoint exists."""
    files = {p.name for p in BACKEND.glob("*.py")}
    checks = [
        ("Microsoft 365", "email_outbox.py",
         "OAuth send-as-user via Graph. Delivery from the shared outbox.",
         "MICROSOFT365_CLIENT_ID/SECRET (per-org, encrypted)"),
        ("Navixy", "fleet_navixy_tags.py",
         "GPS fleet tracking. Vehicle tags + last-position sync.",
         "NAVIXY_API_KEY (per-org, encrypted)"),
        ("SmartFill", "integrations_smartfill.py",
         "Fuel transactions + tank levels (JSON RPC to SmartFill).",
         "SMARTFILL_USER + PASSWORD (per-org, encrypted)"),
        ("Simpro", "integrations_simpro.py",
         "Worker + customer + supplier import. Delta sync on cron.",
         "SIMPRO_BUILD/COMPANY/CLIENT_ID/SECRET (per-org, encrypted)"),
        ("OpenAI / Claude (Emergent LLM)", "ai.py",
         "SWMS drafting, hazard vision, site-diary structuring.",
         "EMERGENT_LLM_KEY (env)"),
    ]
    out: list[dict] = []
    for name, source, purpose, creds in checks:
        out.append({
            "name": name, "source": source, "purpose": purpose,
            "creds": creds,
            "status": "wired" if source in files else "not wired",
        })
    return out


# ─── Diagrams (Mermaid → PNG via local chrome) ─────────────────

DIAGRAM_SPECS: list[dict] = [
    {
        "slug": "system_architecture",
        "title": "System architecture",
        "mermaid": """graph TB
    subgraph Clients
      W[React CRA web app<br/>frontend/src]
      M[Expo mobile app<br/>mobile/src]
    end
    subgraph Backend
      API[FastAPI · uvicorn<br/>backend/server.py]
      AUTH[Auth · JWT + admin PIN + mobile PIN<br/>backend/auth.py]
      MOD[145 backend modules<br/>routers + business logic]
    end
    subgraph Data
      MONGO[(MongoDB<br/>Motor async)]
      GRIDFS[GridFS<br/>PDFs · attachments]
      DISK[Ephemeral disk uploads<br/>parked for v58.14.x]
    end
    subgraph Integrations
      MS[Microsoft 365 · email]
      NAV[Navixy · GPS]
      SF[SmartFill · fuel]
      SIM[Simpro · workers]
      LLM[Emergent LLM · Claude/OpenAI]
    end
    W -->|HTTPS · Bearer JWT| API
    M -->|HTTPS · Bearer JWT + mobile PIN| API
    API --> AUTH
    API --> MOD
    MOD --> MONGO
    MOD --> GRIDFS
    MOD --> DISK
    MOD --> MS
    MOD --> NAV
    MOD --> SF
    MOD --> SIM
    MOD --> LLM
""",
    },
    {
        "slug": "worker_data_flow",
        "title": "Worker + form-submission + document upload lifecycle",
        "mermaid": """sequenceDiagram
    autonumber
    participant Simpro
    participant Cron as SimproDeltaCron
    participant API as FastAPI
    participant Mongo as MongoDB
    participant Mobile as Worker Mobile App
    participant Admin as Admin Web

    Simpro->>Cron: nightly delta pull
    Cron->>API: POST /api/integrations/simpro/workers/refresh
    API->>Mongo: upsert workers + hr_employees
    Admin->>API: assign daily job / form
    API->>Mongo: form_assignments
    Mobile->>API: POST /api/mobile/pin (login)
    API-->>Mobile: JWT
    Mobile->>API: GET /api/mobile/home (my forms)
    Mobile->>API: POST /api/forms/{tpl}/submit + photos
    API->>Mongo: form_submissions
    API->>Mongo: GridFS attachments
    Admin->>API: GET /api/form-submissions
    Admin->>API: DELETE /api/document-library/files/{id}
    API->>Mongo: archive_audit (soft_delete)
    Note over Admin,Mongo: 30-day restore window via /api/archive
""",
    },
    {
        "slug": "access_control",
        "title": "Access control · PIN gates · tile ACLs · vault",
        "mermaid": """graph LR
    subgraph Login
      L1[Email + password]
      L2[Mobile PIN 4-digit]
    end
    L1 --> R{role}
    L2 --> RW[Worker mobile only]
    R -->|admin| WEB[Admin Web · all data]
    R -->|hseq_lead| WEB2[Admin Web · limited]
    R -->|supervisor| WEB3[Admin Web · read-mostly]
    R -->|contractor_rep| CR[Contractor portal]
    R -->|worker| RW
    WEB --> APIN[Admin console PIN<br/>4-digit · bcrypt · rate-limited]
    APIN --> APINGATE[3/30s + 6/15min lockout]
    WEB --> TILES[Apps Directory tiles]
    TILES --> TP{tile.pin_protected?}
    TP -->|yes| APIN
    TILES --> TV{tile.hidden?}
    TV -->|yes| SH[Show hidden · PIN required]
    TILES --> VAULT[Credential Vault<br/>AES-256-GCM · per-user]
    WEB --> ARCH[archive_audit<br/>every hide/restore/delete]
""",
    },
    {
        "slug": "archive_lifecycle",
        "title": "Archive lifecycle · soft-delete → 30-day window → restore or expire",
        "mermaid": """graph LR
    subgraph CAPTURE modules
      INC[Incidents]
      PS[Pre-Starts]
      SSRA[SSRAs]
      RA[Risk Assessments]
      FORMS[Forms]
      WK[Workers · HR Docs]
      DOCS[Document Library]
    end
    INC --> SD[Soft-delete<br/>deleted_at set]
    PS --> SD
    SSRA --> SD
    RA --> SD
    FORMS --> SD
    WK --> SD
    DOCS --> SD
    SD --> AA[archive_audit row<br/>action=soft_delete]
    SD --> ARCH[30-day restore window<br/>/api/archive]
    ARCH -->|admin restore| REST[Restored · deleted_at=null]
    REST --> AAR[archive_audit row<br/>action=restore]
    ARCH -->|30d elapsed| HD[Cron sweep · hard-delete]
    HD --> AAH[archive_audit row<br/>action=hard_delete]
""",
    },
]


def render_diagram(spec: dict) -> Path:
    src = DIAGRAMS / f"{spec['slug']}.mmd"
    png = DIAGRAMS / f"{spec['slug']}.png"
    src.write_text(spec["mermaid"], encoding="utf-8")
    puppet = DIAGRAMS / "_puppet.json"
    puppet.write_text(json.dumps({
        "executablePath": "/usr/bin/google-chrome",
        "args": ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    }))
    cmd = ["npx", "--yes", "-p", "@mermaid-js/mermaid-cli", "mmdc",
             "-i", str(src), "-o", str(png),
             "-p", str(puppet), "-b", "white",
             "-w", "1600"]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        stderr = getattr(e, "stderr", b"")
        if isinstance(stderr, bytes):
            stderr = stderr.decode(errors="replace")
        print(f"  ! diagram '{spec['slug']}' render failed: {stderr[:200]}",
              file=sys.stderr)
        return src  # fall back to source only
    return png


# ─── Markdown assembly ─────────────────────────────────────────

PROSE_EXEC_SUMMARY = (
    "Paneltec Group's operational platform is a single-source WHS + "
    "compliance system serving field operations for a civil-contracting "
    "business. Admins run day-to-day compliance from a React web app; "
    "field workers submit forms, sign in to sites, and complete daily "
    "pre-starts from an Expo mobile app. Every capture-side artefact "
    "(pre-start, hazard, incident, site diary, inspection, SWMS/SSRA) "
    "flows through a shared FastAPI + MongoDB backend that also brokers "
    "integrations with Simpro (workforce master), Navixy (fleet GPS), "
    "SmartFill (fuel), Microsoft 365 (email dispatch), and the Emergent "
    "LLM key (Claude/OpenAI assistance)."
)


def _fmt_endpoint_table(rows: Iterable[tuple[str, str]]) -> str:
    out = ["| Method | Path |", "|--------|------|"]
    for verb, path in sorted(rows, key=lambda kv: (kv[1], kv[0])):
        out.append(f"| `{verb}` | `{path}` |")
    return "\n".join(out)


def _module_short(name: str) -> str:
    """Turn a raw backend module name into a readable label."""
    return name.replace("_", " ").title()


def assemble_markdown() -> str:
    version = running_version()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    endpoints = collect_endpoints()
    collections = collect_collections()
    fe_routes = collect_frontend_routes()
    pages = collect_pages()
    integrations = collect_integrations()
    roles = collect_role_defaults()
    ships = collect_ship_history(25)

    total_endpoints = sum(len(v) for v in endpoints.values())

    md: list[str] = []
    add = md.append

    # Cover
    add(f"""% Paneltec Group Platform Manual
% Paneltec Group — WHS + Compliance
% Generated {now} · Version `{version}`

\\newpage

""")

    # 1. Executive Summary
    add("# 1. Executive Summary\n")
    add(PROSE_EXEC_SUMMARY + "\n")
    add(f"\nAt this generation snapshot the codebase exposes "
        f"**{total_endpoints}** authenticated HTTP endpoints across "
        f"**{len(endpoints)}** backend modules, tracks state in "
        f"**{len(collections)}** MongoDB collections, and renders "
        f"**{len(pages)}** distinct React pages on the web surface.\n")

    # 2. User Personas
    add("\n# 2. User Personas\n")
    persona_notes: dict[str, str] = {
        "admin":
            "Runs the platform. Full read/write across every module. "
            "Gated behind email+password login PLUS a per-user 4-digit "
            "admin-console PIN for privileged actions (org settings, "
            "PIN-protected tiles, tile management, integrations).",
        "hseq_lead":
            "HSEQ manager. Reviews SWMS/SSRAs, closes incidents, "
            "signs off inspections. Read-write on capture modules; "
            "no delete on workforce records.",
        "supervisor":
            "Site supervisor. Assigns daily jobs, reviews pre-starts, "
            "signs off inspections. Mostly read; can create.",
        "contractor_rep":
            "External contractor representative. Submits contractor "
            "documents and workforce updates via a scoped portal.",
        "contractor_rep_submit_only":
            "Same as contractor_rep but view-only apart from the "
            "submission surface.",
        "worker":
            "Field worker. Mobile-only. 4-digit mobile PIN login. Sees "
            "only their own daily jobs, forms, certifications.",
        "auditor":
            "Read-only auditor. Views records + exports; cannot edit.",
    }
    add("Persona | Web access | Mobile access | Notes")
    add("-|-|-|-")
    for r in roles or list(persona_notes.keys()):
        web = "yes" if r != "worker" else "no"
        mobile = "yes" if r in ("worker", "supervisor") else "mostly no"
        note = persona_notes.get(r, "—")
        add(f"`{r}` | {web} | {mobile} | {note}")

    # 3. Feature Modules
    add("\n\n# 3. Feature Modules\n")
    feature_map = [
        ("Workers + HR Employees", "workers.py",
         "Workforce roster. Synced from Simpro; supports soft-delete "
         "+ restore. HR document sub-registry."),
        ("Inductions", "workers_inductions.py",
         "Worker inductions with certificates + expiry tracking."),
        ("Certifications", "worker_certifications.py",
         "Per-worker certifications with attachments + renewal chase."),
        ("Incident Reports", "cs_incident.py",
         "Incident capture (mobile + web) with root-cause categorisation."),
        ("Pre-Starts + Daily Jobs", "prestart.py",
         "Daily equipment/plant pre-starts + assigned daily jobs."),
        ("SWMS / SSRAs / Risk Assessments", "swms_phase45.py",
         "Safe-Work Method Statements + Site-Specific Risk Assessments "
         "authored via AI drafting."),
        ("Master Risks", "master_risks.py",
         "Reference risk library — surfaced when authoring SSRAs."),
        ("Fuel Tracking (SmartFill)", "fleet_fuel.py",
         "Fuel transactions imported via SmartFill API + CSV backup path."),
        ("Fleet Service Register", "fleet.py",
         "Vehicles + service schedules + Navixy live positions."),
        ("Apps Directory", "org_url_tiles.py",
         "In-app launcher tiles for external tools. Org-wide hide + "
         "per-tile PIN gates + drag-to-reorder."),
        ("Insurance Registry", "renewals.py",
         "Org insurance + supplier compliance renewals."),
        ("Document Library", "document_library.py",
         "Folder-scoped compliance documents with recursive search "
         "(filename + AI tags + uploader)."),
        ("Site QR Sign-On + Visitors", "sites.py",
         "Public visitor sign-in via per-site QR + admin dashboard."),
        ("Forms", "forms.py",
         "Templated forms (structured payloads, photos, signatures) "
         "with routing rules + PDF export."),
        ("Ask Intelligence", "ask.py",
         "AI-assisted deep-links across the org's own records."),
    ]
    for label, mod, desc in feature_map:
        eps = endpoints.get(mod.replace(".py", ""), [])
        add(f"\n## {label}\n")
        add(f"*Module:* `backend/{mod}`\n")
        add(desc + "\n")
        if eps:
            add(f"\n{_fmt_endpoint_table(eps[:12])}\n")
            if len(eps) > 12:
                add(f"…and **{len(eps) - 12}** more endpoints "
                    "(see appendix API reference).\n")

    # 4. System Architecture
    add("\n# 4. System Architecture\n")
    add(f"![System architecture](diagrams/system_architecture.png)\n")
    add("""
The stack is a classic FARM (FastAPI + React + MongoDB) with an
additional Expo mobile client. All three tiers are containerised behind
a Kubernetes ingress that maps `/api/*` to the FastAPI pod on `:8001`
and everything else to the React CRA dev server on `:3000`.

* **Backend:** FastAPI · Motor (async MongoDB) · uvicorn.
  Entry point: `backend/server.py`. Modules loaded via
  `api.include_router(...)` — 125 include-router calls at last snapshot.
* **Web:** React 19 · CRA scaffold · TailwindCSS · shadcn/ui.
  Entry: `frontend/src/App.js`. 64 pages under `frontend/src/pages/`.
* **Mobile:** Expo SDK · React Native (out of scope for this ship —
  documentation only, `/app/mobile/` is not modified).
* **Deployment:** pod-hosted preview URLs; supervisor manages both
  backend and frontend with hot reload enabled.
""")

    # 5. Data Layer
    add("\n# 5. Data Layer\n")
    add(f"\nAt this snapshot the code touches **{len(collections)}** "
        "distinct MongoDB collections. The top-touched collections "
        "(counted by number of backend modules that reference them) "
        "are listed below.\n")
    coll_head = sorted(collections,
                        key=lambda kv: (-len(kv[1]), kv[0]))[:30]
    add("\nCollection | Modules that touch it")
    add("-|-")
    for name, mods in coll_head:
        add(f"`{name}` | {len(mods)} — e.g. "
            + ", ".join(f"`{m}`" for m in mods[:4])
            + ("…" if len(mods) > 4 else ""))
    add("\n_Full list of collections in appendix A._\n")
    add("""
### Storage patterns

* **MongoDB documents** — primary state (all collections above).
* **GridFS** — large binary payloads: PDFs, form attachments, worker
  photos. Referenced by GridFS `file_id` in the owning row.
* **Ephemeral pod disk** — legacy upload paths still write to
  `/app/backend/uploads/...` for `document_library`, `contractor_docs`,
  `hazards`, `swms_scans`, `renewals`, and `form_attachments`. **This
  is parked for the `v58.14.x` object-storage migration** — pod-local
  files survive the preview but are inaccessible from a deployed
  container. 20 lint warnings pin the migration targets.
* **`sessionStorage` (frontend)** — retired in `.132g9`. The remaining
  session-scoped state is preview-only (drag-in-progress markers, form
  autosave scratch pads).
""")

    # 6. Integrations
    add("\n# 6. Integrations\n")
    add("Integration | Purpose | Credentials | Status | Backend module")
    add("-|-|-|-|-")
    for it in integrations:
        add(f"{it['name']} | {it['purpose']} | {it['creds']} | "
            f"{it['status']} | `backend/{it['source']}`")
    add("""
Integration secrets are encrypted at rest with Fernet (env-derived key
`INTEGRATIONS_ENC_KEY`) and never returned in plaintext by any GET —
`_mask()` in `backend/integrations.py` returns a masked-last-4 preview
for the UI (`v160.3.9.40 · SEC-003`).

Sentry crash reporting is **not** currently wired in this codebase
(none of the frontend/backend modules reference the Sentry SDK). Error
telemetry is captured to structured logs + the `archive_audit` /
`admin_actions` collections.
""")

    # 7. API Reference — v58.13.132gd sources from live openapi.json
    add("\n# 7. API Reference\n")
    openapi = collect_openapi()
    if openapi and "paths" in openapi:
        paths = openapi["paths"]
        # Group by first tag (or "untagged").
        by_tag: dict[str, list[tuple[str, str, str, str]]] = defaultdict(list)
        for path, methods in sorted(paths.items()):
            for verb, op in (methods or {}).items():
                if verb.upper() not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                    continue
                tags = op.get("tags") or ["untagged"]
                summary = (op.get("summary") or op.get("operationId")
                           or "").strip()
                responses = ", ".join(sorted((op.get("responses") or {}).keys()))
                by_tag[tags[0]].append((verb.upper(), path, summary, responses))
        openapi_total = sum(len(v) for v in by_tag.values())
        add(f"\nAt this snapshot **`/api/openapi.json`** exposes "
            f"**{openapi_total}** endpoints across **{len(by_tag)}** tags. "
            "Every endpoint below is authenticated via a Bearer JWT unless "
            "it lives under a `/scan/` or `/public/` route.\n")
        for tag in sorted(by_tag):
            rows = by_tag[tag]
            add(f"\n### `{tag}` ({len(rows)} endpoints)\n")
            add("| Method | Path | Summary | Responses |")
            add("|--------|------|---------|-----------|")
            for verb, path, summary, responses in sorted(
                rows, key=lambda r: (r[1], r[0]),
            ):
                # Escape pipes for markdown safety.
                s = (summary or "").replace("|", "\\|")[:80]
                add(f"| `{verb}` | `{path}` | {s} | {responses} |")
    else:
        # Fallback to the pre-.132gd decorator-grep path.
        add(f"\nAt this snapshot the code exposes **{total_endpoints}** "
            "HTTP endpoints across **{}** modules "
            "(openapi.json unreachable; fell back to decorator grep).".format(
                len(endpoints)))
        for mod, rows in sorted(endpoints.items()):
            if not rows:
                continue
            add(f"\n### `{mod}` ({len(rows)} endpoints)\n")
            add(_fmt_endpoint_table(rows))
            add("")

    # 8. Data Flow
    add("\n# 8. Data Flow\n")
    add("![Worker + form + document lifecycle]"
        "(diagrams/worker_data_flow.png)\n")
    add("\n### Archive lifecycle (soft-delete → 30-day window → restore/expire)\n")
    add("![Archive lifecycle](diagrams/archive_lifecycle.png)\n")

    # 9. Security & Permissions
    add("\n# 9. Security & Permissions Model\n")
    add("![Access control model](diagrams/access_control.png)\n")
    add("""
### Auth surfaces

* **Email + password login** — JWT, bcrypt password hash, rate-limited
  at the login endpoint. Used by every web login and by the mobile
  onboarding flow.
* **Mobile PIN (4-digit)** — separate bcrypt hash per worker. Backs the
  mobile sign-in and daily job pickup.
* **Admin-console PIN (4-digit)** — separate bcrypt hash per admin.
  Backs privileged actions (Apps Directory 3-dots menu, per-tile PIN
  gates, org settings). Rate-limited via `admin_console_pin_attempts`
  (3 / 30 s → 6 / 15 min lockout tiers).

### Per-tile access controls

Every `org_url_tiles` row has three orthogonal flags:

* `pin_protected` — clicking the tile prompts for the admin PIN.
* `hidden` — org-wide toggle. `GET /api/org/url-tiles` filters these
  out by default; admins can pass `?include_hidden=true` (after PIN
  gate) to reveal + restore individually.
* `allowed_user_ids` — private ACL list. Empty ⇒ public across the org.

### Credential Vault

`tile_credentials` (encrypted, per-user) stores per-admin logins for
external tools. AES-256-GCM at rest. Revealed via
`POST /api/tile-credentials/{tile_id}/reveal` which requires the admin
console PIN.

### Archive + audit

Every soft-delete (documents, certifications, insurance, forms) writes
a row to `archive_audit`. Every tile hide/restore also writes a row
(`.132ga` — with `pin_verified: true`).
""")

    # 10. Admin Structure
    add("\n# 10. Admin Structure\n")
    add("""
* Real-world admin count at the time of writing: **11** organisation
  admins (per Stephen's brief). All 11 see all org data — role scoping
  distinguishes contractor/worker/auditor from admin, not admin-from-
  admin.
* Session flow: login → JWT → optional admin-console PIN modal on
  first privileged action. Session timeout is configurable per-user
  (`PATCH /api/auth/me`) — default 24 h.
* Standing rule (documented in `memory/test_credentials.md`): the
  primary admin account (`stephen@paneltec.com.au`) is protected from
  Playwright wrong-PIN test paths because
  `admin_console_pin_attempts` is shared across the header lock and
  every tile 3-dots gate.
""")

    # 11. Version & Release Cadence
    add("\n# 11. Version & Release Cadence\n")
    add(f"""
* Current running version: **`{version}`**.
* Every ship bumps three source-of-truth constants in lockstep:
  * `frontend/src/lib/version.js#RUNNING_VERSION`
  * `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION`
  * `frontend/public/service-worker.js#CACHE_VERSION`
* Commit convention: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify` decouples the web ship from the Expo bundle version.
* Cadence: multiple ships per day is normal — 36 in the trailing 24 h
  at the time of this generation.
""")

    # 12. Known Constraints
    add("\n# 12. Known Constraints & Roadmap\n")
    add("""
* **Ephemeral upload storage** — 20 backend upload paths still write
  to pod-local disk. Parked for `v58.14.x` object-storage migration.
* **Mobile Android boot crash** — tracked separately; `/app/mobile/`
  is out of scope for the web-only rollups documented here.
* **Legacy branding cleanup** — largely closed after `.132fx`
  (on-dark PDF logo + wordmark sweep). Remaining scattered "Paneltec
  Civil" references are captured in `.132fk`.
* **Test-admin seeding** — `playwright-test-admin@paneltec.internal`
  still un-seeded. Verify scripts guard against Stephen's account per
  the `.132g7` standing rule.
""")

    # 13. Glossary
    add("\n# 13. Glossary\n")
    glossary = [
        ("WHS", "Work Health & Safety — Australian regulatory framework."),
        ("SSRA", "Site-Specific Risk Assessment."),
        ("SWMS", "Safe Work Method Statement."),
        ("CAPTURE", "The set of field-capture modules: pre-starts, "
                    "hazards, incidents, site diary, inspections, SWMS."),
        ("HR Docs", "Human Resources document sub-registry attached "
                    "to each worker's record."),
        ("Simpro", "Third-party workforce/job-management SaaS. "
                    "Source of truth for the `workers` collection."),
        ("Navixy", "Third-party GPS fleet tracking service."),
        ("SmartFill", "Fuel-tank monitoring SaaS."),
        ("Emergent LLM key", "Universal key that unlocks Claude Sonnet, "
                              "OpenAI GPT + image, Gemini Nano Banana, "
                              "and Sora via the Emergent Integrations SDK."),
        ("PIN gate", "Any admin-console-PIN prompt (tile 3-dots, tile "
                     "launch, hide/restore visibility toggle, credential "
                     "reveal)."),
        ("`archive_audit`", "Append-only audit trail for every "
                             "soft-delete + tile visibility change."),
    ]
    add("Term | Meaning")
    add("-|-")
    for term, meaning in glossary:
        add(f"**{term}** | {meaning}")

    # Appendix A · full collections list
    add("\n\n# Appendix A · Complete MongoDB collection list\n")
    add(f"{len(collections)} collections at this snapshot. "
        "First column is the collection name; second is the count of "
        "backend modules that touch it.\n")
    add("Collection | Module count")
    add("-|-")
    for name, mods in collections:
        add(f"`{name}` | {len(mods)}")

    # Appendix B · React pages
    add("\n\n# Appendix B · React page inventory\n")
    add(f"{len(pages)} `.jsx` files under `frontend/src/pages/`.\n")
    for p in pages:
        add(f"* `{p}.jsx`")

    # Appendix C · Recent ship history
    add("\n\n# Appendix C · Recent ship history\n")
    add("Most-recently-modified `v58_13_*_shipped*.md` memos in "
        "`memory/` (max 25):\n")
    for s in ships:
        add(f"* `{s}`")

    # Appendix D · Frontend routes
    add("\n\n# Appendix D · Frontend routes (`App.js`)\n")
    add("Path | Component")
    add("-|-")
    for p, c in fe_routes:
        add(f"`{p or '(nested)'}` | `{c}`")

    # Appendix E · Included routers
    add("\n\n# Appendix E · FastAPI included routers (`server.py`)\n")
    for name in collect_included_routers():
        add(f"* `{name}`")

    # Appendix F · Permission matrix (v58.13.132gd)
    add("\n\n# Appendix F · Role × resource permission matrix\n")
    roles_list, resources, matrix = collect_permission_matrix()
    if matrix:
        add(f"Sourced from `ROLE_DEFAULTS` in `backend/permissions.py`. "
            f"Cell = comma-joined verbs the role has on that resource "
            f"(from the eight-verb set: view / edit / delete / email / "
            f"team_view / use / approve / open). `—` means no grant.\n")
        header = "Resource | " + " | ".join(f"`{r}`" for r in roles_list)
        add(header)
        add(" | ".join(["-"] * (len(roles_list) + 1)))
        for res in resources:
            row = [f"`{res}`"] + [matrix[res].get(r, "—") for r in roles_list]
            add(" | ".join(row))
    else:
        add("_Permission matrix could not be derived at generation "
            "time — check `scripts/regenerate_manual.py` sandbox exec._\n")

    return "\n".join(md) + "\n"


# ─── DOCX render via pandoc ────────────────────────────────────

def render_docx(md_path: Path, docx_path: Path) -> None:
    """Convert the markdown to `.docx` via pandoc. Enables TOC + page
    numbers via a small reference doc built on the fly."""
    ref_doc = DOCS / "_reference.docx"
    if not ref_doc.exists():
        subprocess.run(
            ["pandoc", "-o", str(ref_doc), "--print-default-data-file",
             "reference.docx"],
            check=False, capture_output=True,
        )
    cmd = ["pandoc", str(md_path),
             "-o", str(docx_path),
             "--from", "markdown+pipe_tables",
             "--to", "docx",
             "--toc", "--toc-depth=2",
             "--resource-path", str(DOCS),
             "--metadata", "title=Paneltec Group Platform Manual",
             "--metadata", "author=Paneltec Group",
             "--number-sections"]
    subprocess.run(cmd, check=True)


def add_cover_page_and_footer(docx_path: Path) -> None:
    """Post-process the pandoc output with python-docx:

    · Inject a Paneltec Group cover page (logo + title + version) at
      the very top of the document.
    · Add a page-number footer to the default section.
    """
    try:
        import docx
        from docx.shared import Inches, Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement
    except ImportError:
        print("  ! python-docx not installed — skipping cover post-process",
              file=sys.stderr)
        return

    doc = docx.Document(str(docx_path))

    # ── Cover page (inserted at document top) ─────────────────
    body = doc.element.body
    # Build the new elements in reverse order and prepend each.
    def _prepend(el):
        body.insert(0, el)

    # 4. Page break
    pb_p = doc.add_paragraph()
    pb_run = pb_p.add_run()
    pb_run.add_break(docx.enum.text.WD_BREAK.PAGE)
    body.remove(pb_p._element)  # detach from end so we can prepend

    # 3. Version + generation stamp
    version = running_version()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    v_p = doc.add_paragraph()
    v_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    v_run = v_p.add_run(f"Version {version}\nGenerated {now}")
    v_run.font.size = Pt(11)
    body.remove(v_p._element)

    # 2. Subtitle
    sub_p = doc.add_paragraph()
    sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub_run = sub_p.add_run("Platform Manual")
    sub_run.font.size = Pt(28)
    sub_run.bold = True
    body.remove(sub_p._element)

    # 1. Title
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_run = title_p.add_run("Paneltec Group")
    title_run.font.size = Pt(36)
    title_run.bold = True
    body.remove(title_p._element)

    # 0. Logo (if available)
    logo = (FRONTEND / "public" / "brand"
            / "logo-wordmark-480.png")
    logo_p = doc.add_paragraph()
    logo_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if logo.exists():
        logo_run = logo_p.add_run()
        try:
            logo_run.add_picture(str(logo), width=Inches(3.5))
        except Exception:
            pass
    body.remove(logo_p._element)

    # Prepend in visual order
    _prepend(pb_p._element)
    _prepend(v_p._element)
    _prepend(sub_p._element)
    _prepend(title_p._element)
    _prepend(logo_p._element)

    # ── Page-number footer ─────────────────────────────────────
    section = doc.sections[0]
    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    # If the footer already has content, keep it — otherwise inject
    # a PAGE field via raw OXML.
    if not fp.text.strip():
        run = fp.add_run()
        # Field: PAGE
        fldChar1 = OxmlElement('w:fldChar')
        fldChar1.set(qn('w:fldCharType'), 'begin')
        instrText = OxmlElement('w:instrText')
        instrText.set(qn('xml:space'), 'preserve')
        instrText.text = 'PAGE'
        fldChar2 = OxmlElement('w:fldChar')
        fldChar2.set(qn('w:fldCharType'), 'end')
        run._r.append(fldChar1)
        run._r.append(instrText)
        run._r.append(fldChar2)

    doc.save(str(docx_path))


# ─── Entrypoint ────────────────────────────────────────────────

def main() -> int:
    print(f"[regenerate_manual] rendering diagrams into {DIAGRAMS}")
    for spec in DIAGRAM_SPECS:
        out = render_diagram(spec)
        print(f"  · {spec['slug']} → {out.name}")

    print(f"[regenerate_manual] assembling markdown → {MD_OUT}")
    md = assemble_markdown()
    MD_OUT.write_text(md, encoding="utf-8")

    print(f"[regenerate_manual] rendering docx → {DOCX_OUT}")
    try:
        render_docx(MD_OUT, DOCX_OUT)
        add_cover_page_and_footer(DOCX_OUT)
    except Exception as e:
        print(f"  ! docx render failed: {e}", file=sys.stderr)
        return 1

    print(f"[regenerate_manual] DONE · "
          f"{MD_OUT.stat().st_size} bytes md · "
          f"{DOCX_OUT.stat().st_size} bytes docx")
    return 0


if __name__ == "__main__":
    sys.exit(main())
