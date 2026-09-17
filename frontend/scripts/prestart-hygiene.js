#!/usr/bin/env node
/**
 * v58.13.132hma — Belt-and-braces webpack-cache hygiene.
 *
 * Runs before `craco start` on every supervisor frontend boot.
 * Purges `node_modules/.cache` if it exists, so a stale cache
 * from a prior process can't drag a brand-new dev-server startup
 * into 100% disk. Complementary to the cron in
 * /etc/cron.d/paneltec-disk-hygiene which handles run-time drift.
 *
 * Silent no-op if the cache dir doesn't exist. Never throws — a
 * broken hygiene step should not block the frontend from booting.
 */
const fs = require('fs');
const path = require('path');

const targets = [
  path.resolve(__dirname, '..', 'node_modules', '.cache'),
];

for (const t of targets) {
  try {
    if (fs.existsSync(t)) {
      // Node 14+ supports fs.rmSync recursive.
      fs.rmSync(t, { recursive: true, force: true });
      // eslint-disable-next-line no-console
      console.log(`[prestart-hygiene] purged ${t}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[prestart-hygiene] non-fatal error on ${t}:`, err && err.message);
  }
}
