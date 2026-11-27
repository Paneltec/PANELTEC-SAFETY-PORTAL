const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');

const values = new Map();
const storage = {
  getItem: async key => values.get(key) || null,
  setItem: async (key, value) => { values.set(key, value); },
  removeItem: async key => { values.delete(key); },
};
const mod = new Module('auth');
mod.require = name => name === 'react-native' ? { Platform: { OS: 'web' } } : storage;
mod._compile(ts.transpile(fs.readFileSync(path.join(__dirname, 'src/services/auth.ts'), 'utf8'), { module: ts.ModuleKind.CommonJS, esModuleInterop: true }), 'auth.js');
const auth = mod.exports;

test('redeem, set PIN and verify use the account API contract', async () => {
  values.clear();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => calls.length === 1 ? { temp_session: 'temporary' } : { token: 'jwt', user: { id: 'user' } } };
  };
  const session = await auth.redeemAccount('secret', 'device');
  assert.equal(session, 'temporary');
  assert.deepEqual(JSON.parse(calls[0].options.body), { token: 'secret', device_id: 'device' });
  assert.equal(await auth.hasValidSession(), false);
  await auth.setAccountPin('1234', 'device', session);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer temporary');
  assert.deepEqual(JSON.parse(calls[1].options.body), { pin_hash: '1234', device_id: 'device' });
  assert.equal(await auth.isAccountDevice(), true);
  assert.equal(await auth.getStoredJwt(), 'jwt');
  await auth.clearSession();
  assert.equal(await auth.accountPinLogin('1234', 'device'), 'ok');
  assert.match(calls[2].url, /\/api\/mobile\/auth\/pin-verify$/);
  assert.equal(await auth.getStoredJwt(), 'jwt');
});

test('failed redemption and verification do not create a session', async () => {
  values.clear();
  global.fetch = async () => ({ ok: false, status: 400 });
  await assert.rejects(auth.redeemAccount('bad', 'device'), /invalid, expired or already used/);
  assert.equal(await auth.hasValidSession(), false);
  global.fetch = async () => ({ ok: false, status: 429 });
  assert.equal(await auth.accountPinLogin('1234', 'device'), 'locked');
  assert.equal(await auth.hasValidSession(), false);
});

test('unpaired devices receive account-QR recovery guidance from both PIN flows', async () => {
  values.clear();
  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ detail: { error: 'device_not_paired' } }),
  });

  assert.equal(await auth.accountPinLogin('1234', 'legacy-device'), 'unpaired');
  assert.deepEqual(await auth.pinLogin('1234', 'legacy-device'), {
    ok: false,
    error: 'device_not_paired',
  });
  assert.equal(await auth.hasValidSession(), false);
});