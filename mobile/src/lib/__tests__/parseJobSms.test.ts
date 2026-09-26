/**
 * parseJobSms.test.ts — v58.13.132p1
 * Mirrors backend test_v58_13_132p0_daily_jobs_schema.py::test_parser_extracts_exact_sms_shape
 */
import { parseJobSms, isPaneltecJobSms } from '../parseJobSms';

// Exact SMS from Stephen (the Paneltec sample)
const EXAMPLE_SMS = `Cappellotto 2 - Volvo - XT48AK
15-09-26
78 Corin Street West Launceston
78 Corin Street West Launceston, TAS 7250
Shaw
Staff: DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN
Kroll to site to expose main, ring Jason to complete tapping when exposed
Tap 50mm connection to Main, all fittings to be supplied, after site visit`;

describe('parseJobSms', () => {
  it('extracts the exact Stephen SMS shape', () => {
    const p = parseJobSms(EXAMPLE_SMS);
    expect(p.truck).toBe('Cappellotto 2 - Volvo - XT48AK');
    expect(p.date).toBe('2026-09-15');
    expect(p.site_name).toBe('78 Corin Street West Launceston');
    expect(p.address).toBe('78 Corin Street West Launceston, TAS 7250');
    expect(p.customer).toBe('Shaw');
    expect(p.staff).toEqual(['DANIEL BUTLER', 'JARROD TARGETT', 'JASON DONNELLAN']);
    expect(p.notes).toContain('Kroll to site to expose main');
    expect(p.notes).toContain('all fittings to be supplied');
  });

  it('handles labeled format (Truck: …, Date: …)', () => {
    const text = `Truck: Ute 4 - GBH23K
Date: 2026-10-05
Site: Riverside Depot
Address: 12 River Rd, Devonport, TAS 7310
Customer: TasWater
Staff: A. Smith, B. Jones
Notes: bring the trench box`;
    const p = parseJobSms(text);
    expect(p.truck).toBe('Ute 4 - GBH23K');
    expect(p.date).toBe('2026-10-05');
    expect(p.site_name).toBe('Riverside Depot');
    expect(p.address).toBe('12 River Rd, Devonport, TAS 7310');
    expect(p.customer).toBe('TasWater');
    expect(p.staff).toEqual(['A. Smith', 'B. Jones']);
    expect(p.notes).toBe('bring the trench box');
  });

  it('returns empty on junk input', () => {
    for (const text of ['', '   ', 'not really a job', '\n\n\n']) {
      const p = parseJobSms(text);
      expect(p.truck).toBeNull();
      expect(p.date).toBeNull();
      expect(p.staff).toEqual([]);
    }
  });

  it('handles DD/MM/YYYY date format', () => {
    const text = `Truck: T1
15/09/2026
Some site
Some address, NSW 2000
CustX
Staff: A, B
Notes: go`;
    const p = parseJobSms(text);
    expect(p.date).toBe('2026-09-15');
  });

  it('all seven fields are present', () => {
    const p = parseJobSms(EXAMPLE_SMS);
    expect(Object.keys(p).sort()).toEqual(
      ['address', 'customer', 'date', 'notes', 'site_name', 'staff', 'truck'].sort()
    );
  });
});

describe('isPaneltecJobSms', () => {
  it('detects allocation SMS', () => {
    expect(isPaneltecJobSms('Hi DANIEL, you have been allocated to the following job...')).toBe(true);
  });

  it('detects truck-and-staff SMS', () => {
    expect(isPaneltecJobSms('Truck: Ute\nStaff: Bob')).toBe(true);
  });

  it('rejects random text', () => {
    expect(isPaneltecJobSms('hello world')).toBe(false);
    expect(isPaneltecJobSms('')).toBe(false);
  });
});
