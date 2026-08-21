// v58.12.8 (shipped v58.12.10) — Technician-position hybrid picker.
//
// jsdom coverage for the three UX branches specified in the ship brief:
//   1. Auto-fill on Simpro tech pick → chip renders with the tech's position.
//   2. Pencil (Edit3) → select mode; distinct sorted list; no blank row.
//   3. Off-roster free-text tech branch (v58.11.2) → position select still
//      renders with the same options + "type manually" sentinel; picking
//      the sentinel swaps to a text input.
//
// Same mock-then-import pattern as `AssetServiceTabs.dualtrack.test.jsx`
// (v58.12.6): stub the api singleton BEFORE importing the module so no
// HTTP fires and no live-DB guard is at risk. Drive `<ServiceLogTab>`
// directly — it exposes the "Log service" button that opens
// `<RecordEditor>` (the component under test).
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('../../lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
  },
  apiError: (e) => String(e && e.message),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../lib/useLockBodyScroll', () => ({ __esModule: true, default: () => {} }));

import api from '../../lib/api';
import { ServiceLogTab } from '../AssetServiceTabs';

// Sample Simpro directory response — 4 workers, 2 distinct positions, one
// blank string that MUST be dropped from the derived list, and one dupe
// on 'Plumber' that MUST be deduped by the `new Set()` derivation.
const TECHS_FIXTURE = [
  { id: 'w1', name: 'Alice Jones', simpro_employee_id: '101', active: true, position: 'Plumber' },
  { id: 'w2', name: 'Bob Smith',   simpro_employee_id: '102', active: true, position: 'Site Supervisor' },
  { id: 'w3', name: 'Cara Patel',  simpro_employee_id: '103', active: true, position: 'Plumber' },
  { id: 'w4', name: 'Del Nguyen',  simpro_employee_id: '104', active: true, position: '' },
];

const ASSET_FIXTURE = { id: 'asset-1', name: 'TestVac', kind: 'vehicle',
                        org_id: 'org-1', workspace_id: null,
                        hours_meter: 1000, odo_km: 5000 };

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.get.mockImplementation((path) => {
    if (path === `/assets/${ASSET_FIXTURE.id}/records`) {
      return Promise.resolve({ data: { records: [] } });
    }
    if (path === '/workers/directory') {
      return Promise.resolve({ data: TECHS_FIXTURE });
    }
    return Promise.resolve({ data: [] });
  });
});

async function openLogServiceModal() {
  render(<ServiceLogTab asset={ASSET_FIXTURE} canEdit />);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(`/assets/${ASSET_FIXTURE.id}/records`));
  const logBtn = await screen.findByTestId('record-add-service');
  await act(async () => { fireEvent.click(logBtn); });
  await screen.findByTestId('record-editor-service');
  // Wait for the technician-directory fetch triggered by RecordEditor's mount.
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/workers/directory', expect.anything()));
}

describe('AssetServiceTabs · Technician-position hybrid picker (v58.12.10)', () => {
  test('picking a Simpro tech auto-fills the position chip', async () => {
    await openLogServiceModal();
    const techSelect = await screen.findByTestId('rec-tech-select');
    await waitFor(() => expect(techSelect.disabled).toBe(false));
    await act(async () => { fireEvent.change(techSelect, { target: { value: 'w1' } }); });
    const chip = await screen.findByTestId('technician-position-chip');
    expect(chip.textContent).toBe('Plumber');
  });

  test('pencil opens the position select with sorted distinct options and no blank row', async () => {
    await openLogServiceModal();
    const techSelect = await screen.findByTestId('rec-tech-select');
    await waitFor(() => expect(techSelect.disabled).toBe(false));
    await act(async () => { fireEvent.change(techSelect, { target: { value: 'w2' } }); });
    await screen.findByTestId('technician-position-chip');
    await act(async () => { fireEvent.click(screen.getByTestId('technician-position-edit')); });
    const posSelect = await screen.findByTestId('technician-position-select');
    const optionValues = Array.from(posSelect.querySelectorAll('option')).map((o) => o.value);
    // Placeholder '', 2 real distinct positions (blank dropped, dupe deduped), sentinel.
    expect(optionValues).toEqual(['', 'Plumber', 'Site Supervisor', '__manual__']);
    const optionLabels = Array.from(posSelect.querySelectorAll('option'))
      .map((o) => o.textContent).filter((t) => t && !t.startsWith('—'));
    // Alphabetical.
    expect(optionLabels).toEqual(['Plumber', 'Site Supervisor']);
    // Retained value from the pre-pencil chip.
    expect(posSelect.value).toBe('Site Supervisor');
  });

  test('off-roster free-text tech branch still exposes the position select + manual sentinel', async () => {
    await openLogServiceModal();
    const techSelect = await screen.findByTestId('rec-tech-select');
    await waitFor(() => expect(techSelect.disabled).toBe(false));
    // Swap the tech picker to free-text via the "— Type manually —" sentinel.
    await act(async () => { fireEvent.change(techSelect, { target: { value: '__manual__' } }); });
    expect(await screen.findByTestId('rec-tech')).toBeInTheDocument();
    // Position picker still on the page (posMode='select' from mount — no chip yet).
    const posSelect = await screen.findByTestId('technician-position-select');
    expect(posSelect).toBeInTheDocument();
    // Sentinel swaps to a free-text input.
    await act(async () => { fireEvent.change(posSelect, { target: { value: '__manual__' } }); });
    expect(await screen.findByTestId('technician-position-freetext')).toBeInTheDocument();
  });
});
