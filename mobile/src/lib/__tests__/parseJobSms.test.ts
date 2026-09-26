/**
 * parseJobSms.test.ts — v58.13.132p1a
 *
 * Jest tests for the mobile SMS parser.
 * Mirrors backend sms_parser.py contract.
 */
import { parseJobSms, isPaneltecJobSms } from '../parseJobSms';

// ── Stephen's exact SMS (with "Hi ... allocated" prefix) ──
const STEPHENS_SMS = `Hi DANIEL BUTLER, you have been allocated to the following job.
Truck: Cappellotto 2 - Volvo - XT48AK
Date: 15-09-26
Site: 78 Corin Street West Launceston
Address: 78 Corin Street West Launceston
Customer: Shaw
Staff on this job: DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN
Notes: Kroll to site to expose main, ring Jason to complete tapping when exposed Tap 50mm connection to Main, all fittings to be supplied, after site visit`;

describe('parseJobSms — Stephen SMS', () => {
  const p = parseJobSms(STEPHENS_SMS);

  it('extracts truck', () => {
    expect(p.truck).toBe('Cappellotto 2 - Volvo - XT48AK');
  });

  it('extracts date as ISO YYYY-MM-DD', () => {
    expect(p.date).toBe('2026-09-15');
  });

  it('extracts site_name', () => {
    expect(p.site_name).toBe('78 Corin Street West Launceston');
  });

  it('extracts address', () => {
    expect(p.address).toBe('78 Corin Street West Launceston');
  });

  it('extracts customer', () => {
    expect(p.customer).toBe('Shaw');
  });

  it('extracts staff as array of 3 names', () => {
    expect(p.staff).toEqual([
      'DANIEL BUTLER',
      'JARROD TARGETT',
      'JASON DONNELLAN',
    ]);
  });

  it('extracts notes with full text', () => {
    expect(p.notes).toContain('Kroll to site to expose main');
    expect(p.notes).toContain('all fittings to be supplied');
    expect(p.notes).toContain('after site visit');
  });

  it('all 7 core fields are present (missing is empty or only has prefix noise in notes)', () => {
    // All labeled fields are extracted — missing should be empty
    expect(p.missing).toEqual([]);
  });

  it('returns exactly 8 keys (7 fields + missing)', () => {
    expect(Object.keys(p).sort()).toEqual([
      'address', 'customer', 'date', 'missing', 'notes', 'site_name', 'staff', 'truck',
    ]);
  });
});

// ── Positional SMS (no labels, no prefix) ──
const POSITIONAL_SMS = `Cappellotto 2 - Volvo - XT48AK
15-09-26
78 Corin Street West Launceston
78 Corin Street West Launceston, TAS 7250
Shaw
DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN
Kroll to site to expose main, ring Jason to complete tapping when exposed
Tap 50mm connection to Main, all fittings to be supplied, after site visit`;

describe('parseJobSms — positional format', () => {
  const p = parseJobSms(POSITIONAL_SMS);

  it('extracts truck (first line)', () => {
    expect(p.truck).toBe('Cappellotto 2 - Volvo - XT48AK');
  });

  it('extracts date', () => {
    expect(p.date).toBe('2026-09-15');
  });

  it('extracts site_name', () => {
    expect(p.site_name).toBe('78 Corin Street West Launceston');
  });

  it('finds address by AU state + postcode heuristic', () => {
    expect(p.address).toBe('78 Corin Street West Launceston, TAS 7250');
  });

  it('extracts customer', () => {
    expect(p.customer).toBe('Shaw');
  });

  it('extracts staff by comma-separated name heuristic', () => {
    expect(p.staff).toEqual(['DANIEL BUTLER', 'JARROD TARGETT', 'JASON DONNELLAN']);
  });

  it('notes contain the job instructions', () => {
    expect(p.notes).toContain('Kroll to site to expose main');
  });

  it('missing is empty', () => {
    expect(p.missing).toEqual([]);
  });
});

// ── Labeled format ──
describe('parseJobSms — labeled format', () => {
  const text = `Truck: Ute 4 - GBH23K
Date: 2026-10-05
Site: Riverside Depot
Address: 12 River Rd, Devonport, TAS 7310
Customer: TasWater
Staff: A. Smith, B. Jones
Notes: bring the trench box`;
  const p = parseJobSms(text);

  it('extracts all labeled fields', () => {
    expect(p.truck).toBe('Ute 4 - GBH23K');
    expect(p.date).toBe('2026-10-05');
    expect(p.site_name).toBe('Riverside Depot');
    expect(p.address).toBe('12 River Rd, Devonport, TAS 7310');
    expect(p.customer).toBe('TasWater');
    expect(p.staff).toEqual(['A. Smith', 'B. Jones']);
    expect(p.notes).toBe('bring the trench box');
  });

  it('missing is empty', () => {
    expect(p.missing).toEqual([]);
  });
});

// ── Date formats ──
describe('parseJobSms — date formats', () => {
  it('DD/MM/YYYY', () => {
    const p = parseJobSms('Truck: T1\n15/09/2026\nSome site');
    expect(p.date).toBe('2026-09-15');
  });

  it('DD.MM.YY', () => {
    const p = parseJobSms('Truck: T1\n15.09.26\nSome site');
    expect(p.date).toBe('2026-09-15');
  });

  it('ISO YYYY-MM-DD', () => {
    const p = parseJobSms('Truck: T1\nDate: 2026-10-01\nSome site');
    expect(p.date).toBe('2026-10-01');
  });
});

// ── Edge cases ──
describe('parseJobSms — edge cases', () => {
  it('returns all nulls on empty input', () => {
    const p = parseJobSms('');
    expect(p.truck).toBeNull();
    expect(p.date).toBeNull();
    expect(p.site_name).toBeNull();
    expect(p.staff).toEqual([]);
    expect(p.missing).toEqual([
      'truck', 'date', 'site_name', 'address', 'customer', 'staff', 'notes',
    ]);
  });

  it('returns all nulls on whitespace', () => {
    const p = parseJobSms('   \n\n  ');
    expect(p.truck).toBeNull();
    expect(p.missing.length).toBe(7);
  });

  it('handles curly quotes', () => {
    const p = parseJobSms('Truck: \u201cBig Rig\u201d\nDate: 15-09-26\nSite: A\nAddress: B\nCustomer: C\nStaff: X, Y\nNotes: done');
    expect(p.truck).toBe('"Big Rig"');
  });

  it('handles Windows line endings', () => {
    const p = parseJobSms('Truck: T1\r\nDate: 15-09-26\r\nSite: S\r\nAddress: A\r\nCustomer: C\r\nStaff: X, Y\r\nNotes: ok');
    expect(p.truck).toBe('T1');
    expect(p.date).toBe('2026-09-15');
  });

  it('missing tracks unfilled fields', () => {
    const p = parseJobSms('Truck: T1');
    expect(p.truck).toBe('T1');
    expect(p.missing).toContain('date');
    expect(p.missing).toContain('site_name');
    expect(p.missing).not.toContain('truck');
  });
});

// ── isPaneltecJobSms ──
describe('isPaneltecJobSms', () => {
  it('detects allocation SMS', () => {
    expect(isPaneltecJobSms('Hi DANIEL, you have been allocated to the following job...')).toBe(true);
  });

  it('detects truck-and-staff SMS', () => {
    expect(isPaneltecJobSms('Truck: Ute\nStaff: Bob')).toBe(true);
  });

  it('detects Cappellotto prefix', () => {
    expect(isPaneltecJobSms('Cappellotto 2 - Volvo - XT48AK\n15-09-26')).toBe(true);
  });

  it('rejects random text', () => {
    expect(isPaneltecJobSms('hello world')).toBe(false);
    expect(isPaneltecJobSms('')).toBe(false);
  });
});
