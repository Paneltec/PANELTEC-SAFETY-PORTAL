const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('welcome screen connects the camera to device provisioning', () => {
  const source = readFileSync(join(__dirname, 'app', '(auth)', 'welcome.tsx'), 'utf8');
  assert.match(source, /<CameraView/);
  assert.match(source, /onBarcodeScanned=/);
  assert.match(source, /camera\.enableCamera/);
  assert.match(source, /camera\.cameraFailed/);
  assert.match(source, /handleProvision\(data\)/);
});