const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');

const source = fs.readFileSync(require('node:path').join(__dirname, 'src/services/onboardingQr.ts'), 'utf8');
const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS });
const mod = new Module('onboardingQr');
mod._compile(compiled, 'onboardingQr.js');
const { classifyOnboardingQr } = mod.exports;

test('distinguishes account, install, unrelated URLs and device IDs', () => {
  assert.deepEqual(classifyOnboardingQr('https://example.com/m/onboard/abc_DEF-123?preload=civil'), { kind: 'account', token: 'abc_DEF-123' });
  assert.deepEqual(classifyOnboardingQr('paneltec://onboard?token=abc_DEF-123'), { kind: 'account', token: 'abc_DEF-123' });
  assert.equal(classifyOnboardingQr('https://example.com/m/install').kind, 'install');
  assert.equal(classifyOnboardingQr('https://example.com/unrelated').kind, 'url');
  assert.equal(classifyOnboardingQr('https://example.com/m/onboard/').kind, 'url');
  assert.equal(classifyOnboardingQr('paneltec://onboard?token=a&token=b').kind, 'url');
  assert.equal(classifyOnboardingQr('dev_123').kind, 'device');
});