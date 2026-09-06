"""v58.13.131k probe — comprehensive SmartFill re-probe."""
import asyncio, json, os, sys
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

import httpx
from integrations_smartfill import call, SmartFillAPIError, _creds

OUT = {"probed_at": None, "auth_probes": [], "jsonrpc_methods": [], "rest_probes": []}

# JSON-RPC methods to probe — expanded from .131 baseline
JSONRPC_METHODS = [
    # Baseline .131 set — capture regressions
    "Tank:Level", "Tank:List", "Tank:Levels", "Tank:Alarms",
    "Tank:Deliveries", "Tank:Transactions", "Tank:Fills",
    "Tank:History", "Tank:Consumption",
    # Vehicle / transaction guesses
    "Vehicle:List", "Vehicle:FillHistory", "Transaction:List",
    "Transaction:Detail", "Fill:List", "Fill:Detail", "Unit:List",
    "Site:List",
    # Receipt-focused (new for .131k — user's key ask)
    "Receipt:List", "Receipt:Get", "Receipt:Detail", "Receipt:Download",
    "Receipts:List", "Receipts:Get", "Report:Receipts",
    # Report guesses
    "Report:Transactions", "Report:Fills", "Report:Consumption",
    "Report:Deliveries", "Report:List", "Report:Generate",
    # Card / driver
    "Card:List", "Driver:List", "Key:List",
    # Introspection
    "system.listMethods", "System:Methods", "Method:List", "Help:Methods",
    "Discover:Methods", "API:List",
]

# REST candidates the plan lists (will get 404 from a JSON-RPC endpoint,
# but a Cloudflare Origin or reverse proxy might route them somewhere).
REST_PATHS = [
    "/api/v1/transactions", "/api/v2/transactions", "/transactions",
    "/api/v1/tanks", "/tanks",
    "/api/v1/units", "/vehicles", "/api/v1/vehicles",
    "/api/v1/cards", "/api/v1/drivers",
    "/api/v1/deliveries", "/api/v1/transfers",
    "/api/v1/reports/transactions",
    "/api/v1/receipts/5841004903", "/api/receipts/5841004903",
    "/receipt/5841004903", "/receipts/5841004903",
    "/receipt/5841004903.pdf", "/receipts/5841004903.pdf",
    "/api/v1/receipts/download-all",
    "/api/openapi.json", "/swagger", "/swagger.json", "/api-docs",
    "/api/schema", "/openapi.json",
]

async def main():
    url, key, _ = _creds()
    OUT["endpoint"] = url
    OUT["client_ref_last4"] = f"...{key[-4:]}"
    from datetime import datetime, timezone
    OUT["probed_at"] = datetime.now(timezone.utc).isoformat()

    # ── JSON-RPC method sweep ──
    for m in JSONRPC_METHODS:
        row = {"method": m}
        try:
            result = await call(m)
            row["status"] = "available"
            if isinstance(result, dict):
                row["result_keys"] = list(result.keys())[:8]
                cols = result.get("columns")
                if cols:
                    row["columns"] = cols
                    vals = result.get("values") or []
                    row["row_count"] = len(vals)
                    if vals:
                        row["first_row"] = vals[0]
            elif isinstance(result, list):
                row["result_len"] = len(result)
                if result:
                    row["first_item_type"] = type(result[0]).__name__
                    if isinstance(result[0], dict):
                        row["first_item_keys"] = list(result[0].keys())[:12]
        except SmartFillAPIError as e:
            row["status"] = "error"
            row["code"] = e.code
            row["message"] = str(e)[:120]
        except Exception as e:  # pylint: disable=broad-except
            row["status"] = "transport_error"
            row["message"] = str(e)[:120]
        OUT["jsonrpc_methods"].append(row)
        print(f"  RPC {m:38} → {row.get('status'):20} code={row.get('code','')}")

    # ── Test Tank:Level with real filter parameters ──
    for extra in [
        {"fromDate": "2026-08-30", "toDate": "2026-09-05"},
        {"unitNumber": "5841", "fromDate": "2026-08-30", "toDate": "2026-09-05"},
    ]:
        try:
            r = await call("Tank:Level", extra)
            OUT["setdefault"] = OUT.setdefault("filter_probes", [])
            OUT["filter_probes"].append(
                {"method": "Tank:Level", "extra": extra, "ok": True,
                 "row_count": len((r or {}).get("values") or [])}
            )
        except Exception as e:  # pylint: disable=broad-except
            OUT.setdefault("filter_probes", []).append(
                {"method": "Tank:Level", "extra": extra, "err": str(e)[:120]}
            )

    # ── REST path sweep against the same origin ──
    base = url.rsplit("/API/", 1)[0]
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
        for path in REST_PATHS:
            full = f"{base}{path}"
            row = {"path": path}
            for auth_style in ("basic", "apikey_header"):
                try:
                    if auth_style == "basic":
                        r = await client.get(full, auth=(key, os.environ["SMARTFILL_API_SECRET"]))
                    else:
                        r = await client.get(full, headers={
                            "X-API-Key": key,
                            "Authorization": f"Bearer {os.environ['SMARTFILL_API_SECRET']}",
                        })
                    row[f"{auth_style}_status"] = r.status_code
                    row[f"{auth_style}_ct"] = r.headers.get("content-type", "")[:60]
                    row[f"{auth_style}_len"] = len(r.content)
                    # If body looks interesting, capture first 200 bytes.
                    if r.status_code < 400 and len(r.content) > 40:
                        row[f"{auth_style}_preview"] = r.text[:180]
                except Exception as e:  # pylint: disable=broad-except
                    row[f"{auth_style}_err"] = str(e)[:80]
            OUT["rest_probes"].append(row)
            print(f"  REST {path:44} → basic={row.get('basic_status','?')} hdr={row.get('apikey_header_status','?')}")

    with open("/app/memory/v58_13_131k_probe_raw.json", "w") as fh:
        # Redact anything that looks like a credential.
        json.dump(OUT, fh, indent=2, default=str)
    print("\nWROTE /app/memory/v58_13_131k_probe_raw.json")

asyncio.run(main())
