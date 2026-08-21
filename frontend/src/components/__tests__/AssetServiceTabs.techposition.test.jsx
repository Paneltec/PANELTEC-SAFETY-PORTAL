// v58.12.8 (shipped v58.12.10) — Technician-position hybrid picker.
//
// jsdom coverage for the three UX branches specified in the ship brief:
//   1. Auto-fill on Simpro tech pick → chip renders with the tech's position.
//   2. Pencil (Edit3) → select mode; distinct sorted list; no blank row.
//   3. Off-roster free-text branch (v58.11.2) → position select still
//      renders with the same options + "type manually" sentinel;
//      picking the sentinel swaps to a text input.
//
// The AssetServiceTabs module imports `api` from `../lib/api` which
// creates an axios instance at import time. jest.mock replaces it with
// an in-memory stub so no HTTP is attempted and no live-DB guard fires.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// Mock the api singleton BEFORE the component pulls it in.
jest.mock('../../lib/api', () => {
  const fake = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  return { __esModule: true, default: fake, apiError: (e) => String(e && e.message) };
});
jest.mock('../../lib/useLockBodyScroll', () => ({ __esModule: true, default: () => {} }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// Named export `RecordEditor` isn't exposed, but the module renders it
// through the default export. Reach in via the internal module for a
// tight, deterministic test — same pattern as the v58.12.6 dual-track
// test suite in `AssetServiceTabs.dualtrack.test.jsx`.
import api from '../../lib/api';
import AssetServiceTabs from '../AssetServiceTabs';

// Sample Simpro directory response — 3 workers, 2 distinct positions,
// one blank string that MUST be dropped from the derived list.
const TECHS_FIXTURE = [
  { id: 'w1', name: 'Alice Jones',   simpro_employee_id: '101', active: true, position: 'Plumber' },
  { id: 'w2', name: 'Bob Smith',     simpro_employee_id: '102', active: true, position: 'Site Supervisor' },
  { id: 'w3', name: 'Cara Patel',    simpro_employee_id: '103', active: true, position: 'Plumber' },
  { id: 'w4', name: 'Del Nguyen',    simpro_employee_id: '104', active: true, position: '' },
];

function seedTechsApi() {
  api.get.mockImplementation((path) => {
    if (path === '/workers/directory') {
      return Promise.resolve({ data: TECHS_FIXTURE });
    }
    return Promise.resolve({ data: [] });
  });
}

// AssetServiceTabs's public surface is the default component which
// renders the whole panel. To reach `RecordEditor` directly without
// scrolling through the tabs UI, we render the panel and click "Log
// service" to open the modal. Fixture asset + minimal props below.
const ASSET_FIXTURE = { id: 'asset-1', name: 'TestVac', kind: 'vehicle',
                         org_id: 'org-1', workspace_id: null,
                         hours_meter: 1000, odo_km: 5000 };

async function openLogServiceModal() {
  const utils = render(<AssetServiceTabs asset={ASSET_FIXTURE} onChange={() => {}} />);
  // The panel fetches schedules + records on mount — stub both.
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  // Find the "Log service" adder button.
  const logBtn = await screen.findByTestId('service-add-service-btn');
  await act(async () => { fireEvent.click(logBtn); });
  await screen.findByTestId('record-editor-service');
  return utils;
}

describe('AssetServiceTabs · Technician-position hybrid picker (v58.12.10)', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.put.mockReset();
    seedTechsApi();
  });

  test('picking a Simpro tech auto-fills the position chip', async () => {
    await openLogServiceModal();
    // Wait for the technician directory fetch to settle.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/workers/directory', expect.anything()));
    // Select Alice Jones (Plumber) from the technician picker.
    const techSelect = await screen.findByTestId('rec-tech-select');
    await act(async () => { fireEvent.change(techSelect, { target: { value: 'w1' } }); });
    // Chip appears with the auto-filled position.
    const chip = await screen.findByTestId('technician-position-chip');
    expect(chip.textContent).toBe('Plumber');
  });

  test('pencil opens the position select with sorted distinct options and no blank row', async () => {
    await openLogServiceModal();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/workers/directory', expect.anything()));
    // Pick a tech WITH a position so the chip renders first.
    const techSelect = await screen.findByTestId('rec-tech-select');
    await act(async () => { fireEvent.change(techSelect, { target: { value: 'w2' } }); });
    await screen.findByTestId('technician-position-chip');
    // Click the pencil.
    await act(async () => { fireEvent.click(screen.getByTestId('technician-position-edit')); });
    const posSelect = await screen.findByTestId('technician-position-select');
    // Options: '' (placeholder), 'Plumber', 'Site Supervisor', '__manual__'.
    // No blank string in the middle — the fixture's blank `position: ''`
    // row from Del Nguyen must be dropped via `.filter(Boolean)`.
    const optionValues = Array.from(posSelect.querySelectorAll('option')).map((o) => o.value);
    expect(optionValues).toEqual(['', 'Plumber', 'Site Supervisor', '__manual__']);
    // Sorted alphabetically: Plumber before Site Supervisor.
    const optionLabels = Array.from(posSelect.querySelectorAll('option'))
      .map((o) => o.textContent).filter((t) => t && !t.startsWith('—'));
    expect(optionLabels).toEqual(['Plumber', 'Site Supervisor']);
    // The current value is retained from the chip.
    expect(posSelect.value).toBe('Site Supervisor');
  });

  test('off-roster free-text tech branch still exposes the position select + manual sentinel', async () => {
    await openLogServiceModal();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/workers/directory', expect.anything()));
    // Swap the technician picker to free-text via the "— Type manually —" sentinel.
    const techSelect = await screen.findByTestId('rec-tech-select');
    await act(async () => { fireEvent.change(techSelect, { target: { value: '__manual__' } }); });
    // Free-text input for the technician name now visible.
    expect(await screen.findByTestId('rec-tech')).toBeInTheDocument();
    // Position select still rendered (posMode was 'select' from mount — no chip yet).
    const posSelect = await screen.findByTestId('technician-position-select');
    expect(posSelect).toBeInTheDocument();
    // Picking the "type manually" sentinel on the POSITION select swaps to the free-text input.
    await act(async () => { fireEvent.change(posSelect, { target: { value: '__manual__' } }); });
    expect(await screen.findByTestId('technician-position-freetext')).toBeInTheDocument();
  });
});
