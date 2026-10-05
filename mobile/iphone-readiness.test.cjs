const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('only the explicit installation-test profile can build without a server', () => {
  for (const [profile, flag, expected] of [
    ['iphone-readiness', 'true', 0], ['production', 'true', 1],
    ['testflight', 'true', 1], ['iphone-readiness', '', 1],
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'check-backend.cjs')], {
      env: { ...process.env, EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_IPHONE_READINESS: flag,
        EXPO_PUBLIC_BACKEND_URL: '' }, encoding: 'utf8',
    });
    assert.equal(result.status, expected, result.stderr);
  }
});

test('readiness builds cannot receive production updates or claim website links', () => {
  const script = `const configure=require('./app.config');
    const config=require('./app.json').expo;
    const result=configure({config});
    if(result.updates.enabled!==false || result.ios.associatedDomains.length ||
       result.runtimeVersion!=='iphone-readiness-1') process.exit(1);`;
  const env = { ...process.env, EXPO_PUBLIC_IPHONE_READINESS: 'true', EAS_BUILD_PROFILE: 'iphone-readiness' };
  assert.equal(spawnSync(process.execPath, ['-e', script], { cwd: __dirname, env }).status, 0);
  env.EAS_BUILD_PROFILE = 'production';
  assert.notEqual(spawnSync(process.execPath, ['-e', script], { cwd: __dirname, env }).status, 0);
});
