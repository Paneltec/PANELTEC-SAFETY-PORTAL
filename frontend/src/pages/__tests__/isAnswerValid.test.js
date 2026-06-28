// Unit tests for the Forms.jsx `isAnswerValid` helper introduced in Phase 3.7.
// Covers every supported field type with at least one valid and one invalid
// shape. Run with `CI=true yarn test --watchAll=false src/pages/__tests__/isAnswerValid.test.js`.
import { isAnswerValid } from '../../lib/isAnswerValid';

const f = (type, overrides = {}) => ({ id: 'fx', label: 'L', type, required: true, ...overrides });

describe('isAnswerValid', () => {
  test('worker_picker — object with id passes, empty/string fails', () => {
    expect(isAnswerValid(f('worker_picker'), { id: 'w1', name: 'A' })).toBe(true);
    expect(isAnswerValid(f('worker_picker'), null)).toBe(false);
    expect(isAnswerValid(f('worker_picker'), 'A')).toBe(false);
    expect(isAnswerValid(f('worker_picker'), { name: 'A' })).toBe(false);
  });

  test('customer_picker + job_picker — same shape rules', () => {
    expect(isAnswerValid(f('customer_picker'), { id: 'c1' })).toBe(true);
    expect(isAnswerValid(f('job_picker'), { id: 'j1' })).toBe(true);
    expect(isAnswerValid(f('customer_picker'), null)).toBe(false);
    expect(isAnswerValid(f('job_picker'), undefined)).toBe(false);
  });

  test('site_picker — accepts id OR freeform GPS, rejects empty', () => {
    expect(isAnswerValid(f('site_picker'), { id: 's1' })).toBe(true);
    expect(isAnswerValid(f('site_picker'), { freeform: true, lat: -41.4, lng: 147.1 })).toBe(true);
    expect(isAnswerValid(f('site_picker'), { freeform: true })).toBe(false);
    expect(isAnswerValid(f('site_picker'), null)).toBe(false);
  });

  test('asset_scan / vehicle_navixy — accept asset_id or id', () => {
    expect(isAnswerValid(f('asset_scan'), { asset_id: 'a1' })).toBe(true);
    expect(isAnswerValid(f('vehicle_navixy'), { id: 'v1' })).toBe(true);
    expect(isAnswerValid(f('asset_scan'), {})).toBe(false);
  });

  test('date / datetime — non-empty strings only', () => {
    expect(isAnswerValid(f('date'), '2026-06-28')).toBe(true);
    expect(isAnswerValid(f('date'), '')).toBe(false);
    expect(isAnswerValid(f('date'), '   ')).toBe(false);
    expect(isAnswerValid(f('datetime'), '2026-06-28T10:00')).toBe(true);
  });

  test('gps — needs lat AND lng', () => {
    expect(isAnswerValid(f('gps'), { lat: -41.4, lng: 147.1 })).toBe(true);
    expect(isAnswerValid(f('gps'), { lat: -41.4 })).toBe(false);
    expect(isAnswerValid(f('gps'), null)).toBe(false);
  });

  test('signature — accepts dataUrl string or {dataUrl} object', () => {
    expect(isAnswerValid(f('signature'), 'data:image/png;base64,xxxx')).toBe(true);
    expect(isAnswerValid(f('signature'), { dataUrl: 'data:image/png;base64,zzz' })).toBe(true);
    expect(isAnswerValid(f('signature'), 'not-a-data-url')).toBe(false);
    expect(isAnswerValid(f('signature'), null)).toBe(false);
  });

  test('photo — needs non-empty photoFiles array (third arg)', () => {
    expect(isAnswerValid(f('photo'), null, [new Blob()])).toBe(true);
    expect(isAnswerValid(f('photo'), null, [])).toBe(false);
    expect(isAnswerValid(f('photo'), null, undefined)).toBe(false);
  });

  test('radio / select — non-empty trimmed string', () => {
    expect(isAnswerValid(f('radio'), 'Yes')).toBe(true);
    expect(isAnswerValid(f('select'), 'Sunny')).toBe(true);
    expect(isAnswerValid(f('radio'), '')).toBe(false);
    expect(isAnswerValid(f('select'), '   ')).toBe(false);
    expect(isAnswerValid(f('radio'), null)).toBe(false);
  });

  test('number — accepts 0 and parseable strings, rejects empty/NaN', () => {
    expect(isAnswerValid(f('number'), 0)).toBe(true);
    expect(isAnswerValid(f('number'), '5')).toBe(true);
    expect(isAnswerValid(f('number'), '')).toBe(false);
    expect(isAnswerValid(f('number'), 'abc')).toBe(false);
    expect(isAnswerValid(f('number'), null)).toBe(false);
  });

  test('text / textarea — non-empty trimmed', () => {
    expect(isAnswerValid(f('text'), 'hello')).toBe(true);
    expect(isAnswerValid(f('textarea'), 'multi\nline')).toBe(true);
    expect(isAnswerValid(f('text'), '   ')).toBe(false);
    expect(isAnswerValid(f('text'), '')).toBe(false);
    expect(isAnswerValid(f('text'), null)).toBe(false);
  });
});
