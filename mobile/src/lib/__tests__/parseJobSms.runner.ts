/**
 * parseJobSms runner — v58.13.132p1
 * Simple Node-compatible test (no jest required).
 * Run: npx tsx src/lib/__tests__/parseJobSms.runner.ts
 */
import { parseJobSms, isPaneltecJobSms } from '../parseJobSms';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ FAIL: ${msg}`); }
}
function eq(a: any, b: any, msg: string) {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as === bs) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ FAIL: ${msg}\n     got:  ${as}\n     want: ${bs}`); }
}

const SMS = `Cappellotto 2 - Volvo - XT48AK
15-09-26
78 Corin Street West Launceston
78 Corin Street West Launceston, TAS 7250
Shaw
Staff: DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN
Kroll to site to expose main, ring Jason to complete tapping when exposed
Tap 50mm connection to Main, all fittings to be supplied, after site visit`;

console.log('\n=== parseJobSms tests ===\n');

console.log('Test 1: Stephen SMS exact shape');
const p = parseJobSms(SMS);
eq(p.truck, 'Cappellotto 2 - Volvo - XT48AK', 'truck');
eq(p.date, '2026-09-15', 'date');
eq(p.site_name, '78 Corin Street West Launceston', 'site_name');
eq(p.address, '78 Corin Street West Launceston, TAS 7250', 'address');
eq(p.customer, 'Shaw', 'customer');
eq(p.staff, ['DANIEL BUTLER', 'JARROD TARGETT', 'JASON DONNELLAN'], 'staff');
assert(p.notes!.includes('Kroll to site to expose main'), 'notes contains expected text');

console.log('\nTest 2: Labeled format');
const p2 = parseJobSms(`Truck: Ute 4 - GBH23K
Date: 2026-10-05
Site: Riverside Depot
Address: 12 River Rd, Devonport, TAS 7310
Customer: TasWater
Staff: A. Smith, B. Jones
Notes: bring the trench box`);
eq(p2.truck, 'Ute 4 - GBH23K', 'labeled truck');
eq(p2.date, '2026-10-05', 'labeled date');
eq(p2.site_name, 'Riverside Depot', 'labeled site_name');
eq(p2.customer, 'TasWater', 'labeled customer');

console.log('\nTest 3: Empty input');
const p3 = parseJobSms('');
eq(p3.truck, null, 'empty truck');
eq(p3.staff, [], 'empty staff');

console.log('\nTest 4: isPaneltecJobSms');
assert(isPaneltecJobSms('Hi DANIEL, you have been allocated to the following job...'), 'allocation SMS detected');
assert(!isPaneltecJobSms('hello world'), 'random text rejected');

console.log('\nTest 5: Seven fields present');
eq(Object.keys(p).sort(), ['address', 'customer', 'date', 'notes', 'site_name', 'staff', 'truck'], '7 fields');

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
