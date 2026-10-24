import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFuelRows } from './fuelReportTotals.js';
const expect = value => ({
  toBe: expected => assert.equal(value, expected),
  toBeNull: () => assert.equal(value, null),
  toBeCloseTo: (expected, digits) => assert.ok(Math.abs(value - expected) < 10 ** -digits),
});

test('totals add the shown litres and costs and combine fill counts', () => {
  const total = summarizeFuelRows([
    { litres: 632.27, total_price: 1770.37, fills: 6 },
    { litres: 431.22, total_price: 1207.41, fills: 6 },
    { litres: 0.105, total_price: 0.29, fills: 1 },
  ]);
  expect(total.rowCount).toBe(3);
  expect(total.litres).toBe(1063.59);
  expect(total.totalPrice).toBe(2978.07);
  expect(total.fills).toBe(13);
  expect(total.avgFill).toBeCloseTo(1063.59 / 13, 8);
});

test('average fill and dollar per litre use combined quantities, not a mean of row averages', () => {
  const total = summarizeFuelRows([
    { litres: 100, total_price: 200, fills: 1, avg_fill_l: 100, dpl: 2 },
    { litres: 900, total_price: 2700, fills: 9, avg_fill_l: 100, dpl: 3 },
  ]);
  expect(total.avgFill).toBe(100);
  expect(total.pricePerLitre).toBe(2.9);
});

test('consumption uses qualifying sample counts and price change uses litres with known deltas', () => {
  const total = summarizeFuelRows([
    { litres: 100, avg_lp100: 10, lp100_sample: 1, delta_dpl: 0.1 },
    { litres: 300, avg_lp100: 30, lp100_sample: 3, delta_dpl: -0.1 },
    { litres: 600, avg_lp100: null, lp100_sample: 0, delta_dpl: null },
  ]);
  expect(total.avgLp100).toBe(25);
  expect(total.consumptionSamples).toBe(4);
  expect(total.deltaDpl).toBeCloseTo(-0.05, 8);
});

test('missing and zero-volume metrics remain unavailable instead of becoming zero averages', () => {
  const total = summarizeFuelRows([{ litres: 0, total_price: 0, fills: 0 }]);
  expect(total.avgFill).toBeNull();
  expect(total.pricePerLitre).toBeNull();
  expect(total.avgLp100).toBeNull();
  expect(total.deltaDpl).toBeNull();
  expect(summarizeFuelRows([]).litres).toBe(0);
});

test('a real zero change or consumption stays valid', () => {
  const total = summarizeFuelRows([{ litres: 40, total_price: 112, fills: 2, avg_lp100: 0, lp100_sample: 1, delta_dpl: 0 }]);
  expect(total.avgLp100).toBe(0);
  expect(total.deltaDpl).toBe(0);
});
