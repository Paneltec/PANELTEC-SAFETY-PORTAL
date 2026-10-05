const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateBackend } = require('./check-backend.cjs');
test('accepts HTTPS origins, including explicit ports', () => {
  assert.equal(validateBackend('https://safety.paneltec.com.au'), 'https://safety.paneltec.com.au');
  assert.equal(validateBackend('https://safety.paneltec.com.au:8443'), 'https://safety.paneltec.com.au:8443');
});
test('rejects missing, legacy, local, insecure and malformed endpoints', () => {
  for (const value of [undefined, '', 'garbage', 'http://umbrel.local:3952',
    'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://umbrel.local',
    'https://example.com', 'https://app.example.com', 'https://paneltec-public-url.invalid',
    'https://whs-compliance.preview.emergentagent.com', ' https://safety.paneltec.com.au',
    'https://safety.paneltec.com.au/', 'https://safety.paneltec.com.au/api',
    'https://safety.paneltec.com.au/m/', 'https://safety.paneltec.com.au?key=test',
    'https://safety.paneltec.com.au#fragment', 'https://user:pass@safety.paneltec.com.au']) {
    assert.throws(() => validateBackend(value));
  }
});
test('all EAS profiles use configured environments rather than an old URL', () => {
  const eas = require('./eas.json');
  for (const [name, profile] of Object.entries(eas.build)) {
    assert.equal(profile.environment, ['production', 'testflight'].includes(name) ? 'production' : 'preview');
    assert.equal(profile.env?.EXPO_PUBLIC_BACKEND_URL, name === 'iphone-readiness' ? '' : undefined);
  }
  assert.equal(require('./package.json').scripts['eas-build-pre-install'], 'node check-backend.cjs');
});
