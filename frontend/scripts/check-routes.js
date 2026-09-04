#!/usr/bin/env node
/*
 * v58.13.109 — Route-link compile guard.
 *
 * Scans `frontend/src/**` for hard-coded navigation targets under
 * `/app/*` and cross-checks each against the routes registered in
 * `frontend/src/App.js`. Any usage whose target has no matching
 * `<Route path=...>` fails the check with a human-readable diff.
 *
 * USAGE
 *   node frontend/scripts/check-routes.js       # from repo root
 *   yarn --cwd frontend check-routes            # via package.json
 *
 * DELIBERATELY NOT WIRED INTO THE BUILD YET. This is a "run before
 * ship" utility; block-on-CI wiring is a separate ship (see PRD /
 * next action items in v58.13.109 memo). Run it manually or via a
 * pre-commit hook if you want.
 *
 * EXIT CODES
 *   0 — every referenced /app/* target has a registered Route
 *   1 — one or more referenced targets are dead links
 *   2 — could not parse App.js (script bug — please report)
 *
 * KNOWN CAVEATS
 *   · Only static string targets are checked. Dynamic composition
 *     like ``navigate(`/app/${section}/new`)`` is intentionally
 *     skipped — impossible to statically verify.
 *   · React Router v6 path params are normalised (`:id` matches any
 *     segment). Nested-route base-path is stitched together (an
 *     outer `<Route path="/app">` combined with an inner
 *     `<Route path="dashboard">` counts as `/app/dashboard`).
 *   · Sub-routes registered via other files (rare in this repo) are
 *     NOT auto-discovered; append their patterns to `EXTRA_ROUTES`
 *     below when they land.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const APP_JS = path.join(REPO_ROOT, 'frontend', 'src', 'App.js');
const SRC_DIR = path.join(REPO_ROOT, 'frontend', 'src');

// Sub-routes registered outside App.js. Extend as needed.
const EXTRA_ROUTES = [];

// ─── Read App.js and extract <Route path="…" …> registrations ────────
function extractRegisteredRoutes() {
  if (!fs.existsSync(APP_JS)) {
    console.error(`[check-routes] App.js not found at ${APP_JS}`);
    process.exit(2);
  }
  const src = fs.readFileSync(APP_JS, 'utf8');
  const routes = new Set();
  // <Route path="/foo" …>   OR   <Route path="dashboard" …>
  // The Route may be self-closing or wrap children.
  const routeRe = /<Route\s+[^>]*?\bpath\s*=\s*"([^"]*)"/g;
  // Track the nested base — outer <Route path="/app"> then inner
  // <Route path="dashboard"> should stitch to `/app/dashboard`.
  // We do a shallow depth-1 stitch: any relative (non-leading-`/`)
  // path found is prefixed with `/app` (the only nested tree in this
  // codebase). That covers 100% of App.js today; extend if a second
  // nested tree ever lands.
  let m;
  while ((m = routeRe.exec(src)) !== null) {
    const p = m[1];
    if (!p) continue;
    if (p.startsWith('/')) {
      routes.add(p);
    } else {
      routes.add(`/app/${p}`);
    }
  }
  for (const r of EXTRA_ROUTES) routes.add(r);
  return routes;
}

// ─── Walk src/ and grep for /app/… targets ────────────────────────────
function walkFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walkFiles(abs, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(abs);
  }
  return out;
}

function extractUsages() {
  const files = walkFiles(SRC_DIR);
  const usages = [];
  // to="/app/..."     (double-quoted JSX attr)
  // to='/app/...'     (single-quoted)
  // to={`/app/...`}   (template literal without ${})
  // navigate('/app/...')
  // navigate("/app/...")
  // <Navigate to="/app/..." …>
  const patterns = [
    /\bto\s*=\s*"(\/app\/[^"?]+?)"/g,
    /\bto\s*=\s*'(\/app\/[^'?]+?)'/g,
    /\bto\s*=\s*\{\s*`(\/app\/[^`$?]+?)`\s*\}/g,
    /\bnavigate\s*\(\s*"(\/app\/[^"?]+?)"/g,
    /\bnavigate\s*\(\s*'(\/app\/[^'?]+?)'/g,
    /\bnavigate\s*\(\s*`(\/app\/[^`$?]+?)`/g,
  ];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // Skip App.js itself — its `to=` attrs inside <Navigate to=...>
    // are redirects, not link targets we want to validate.
    if (file === APP_JS) continue;
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        let target = m[1].replace(/\/+$/, '');   // strip trailing slash
        target = target.split('?')[0].split('#')[0];
        // Skip pure `/app` — always registered.
        if (target === '/app') continue;
        // Track line number for the diff.
        const before = src.slice(0, m.index);
        const line = before.split('\n').length;
        usages.push({ file, line, target });
      }
    }
  }
  return usages;
}

// ─── Match a usage target against registered routes ──────────────────
function segmentsMatch(routeSeg, useSeg) {
  return routeSeg.startsWith(':') || routeSeg === useSeg;
}

function targetMatchesRoute(target, route) {
  // Both are absolute paths starting with `/app`.
  const t = target.split('/').filter(Boolean);
  const r = route.split('/').filter(Boolean);
  if (t.length !== r.length) return false;
  for (let i = 0; i < t.length; i++) {
    if (!segmentsMatch(r[i], t[i])) return false;
  }
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────
function main() {
  const registered = extractRegisteredRoutes();
  const usages = extractUsages();
  const dead = [];
  for (const u of usages) {
    let hit = false;
    for (const r of registered) {
      if (targetMatchesRoute(u.target, r)) { hit = true; break; }
    }
    if (!hit) dead.push(u);
  }
  console.log(`[check-routes] scanned ${usages.length} static /app/* navigation targets in frontend/src/`);
  console.log(`[check-routes] found ${registered.size} <Route> registrations in App.js`);
  if (dead.length === 0) {
    console.log('[check-routes] OK — every referenced target has a registered route');
    process.exit(0);
  }
  console.error(`[check-routes] FAIL — ${dead.length} dead link(s):`);
  for (const d of dead) {
    const rel = path.relative(REPO_ROOT, d.file);
    console.error(`  · ${rel}:${d.line}  →  ${d.target}`);
  }
  console.error('');
  console.error('Fix by either:');
  console.error('  a) Correcting the target string in the calling file, OR');
  console.error('  b) Registering the missing route in frontend/src/App.js');
  console.error('');
  console.error('Registered routes (for reference):');
  for (const r of Array.from(registered).sort()) console.error(`  ${r}`);
  process.exit(1);
}

if (require.main === module) main();
