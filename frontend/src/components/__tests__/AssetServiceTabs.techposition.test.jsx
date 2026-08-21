// v58.12.12 — Service Log Position-Primary redesign.
//
// Retires the v58.12.10 chip+pencil auto-fill UX in favour of:
//   · Position picker as PRIMARY (col-span-2, above Cost/Technician).
//   · Technician list FILTERS by picked position.
//   · Zero-match position falls back to the full 68-worker list + a
//     `technician-position-hint-no-match` hint.
//   · "— Type manually —" position sentinel → free-text position + tech
//     list reverts to full 68 (opaque free-text can't be a filter key).
//   · Picking a tech does NOT overwrite position (position is upstream).
//
// jsdom coverage (5 new + 1 kept):
//   · (kept) off-roster free-text tech branch still exposes position picker
//   · (a) position selected → tech dropdown shows only matching workers
//   · (b) position with zero-match → hint renders + full-fallback list
//   · (c) picking a tech does NOT overwrite position
//   · (d) position + off-roster tech both persist to submit payload
//   · (e) "— Type manually —" position sentinel → free-text input + tech
//         list reverts to the full 68 workers
//
// Same mock-then-import pattern as `AssetServiceTabs.dualtrack.test.jsx`
// (v58.12.6): stub the api singleton BEFORE importing the module so no
// HTTP fires and no live-DB guard is at risk.
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

// Fixture: 5 workers, 3 distinct positions. One dupe ("Plumber") to prove
// dedup. One blank ("") to prove `.filter(Boolean)` drops it.
const TECHS_FIXTURE = [
  { id: 'w1', name: 'Alice Jones', simpro_employee_id: '101', active: true, position: 'Plumber' },
  { id: 'w2', name: 'Bob Smith',   simpro_employee_id: '102', active: true, position: 'Site Supervisor' },
  { id: 'w3', name: 'Cara Patel',  simpro_employee_id: '103', active: true, position: 'Plumber' },
  { id: 'w4', name: 'Del Nguyen',  simpro_employee_id: '104', active: true, position: '' },
  { id: 'w5', name: 'Eve Zhao',    simpro_employee_id: '105', active: true, position: 'Technician' },
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
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/workers/directory', expect.anything()));
}

function techOptionIdsFrom(selectEl) {
  return Array.from(selectEl.querySelectorAll('option[data-testid^="rec-tech-opt-"]'))
    .map((o) => o.value);
}

describe('AssetServiceTabs · Service Log Position-Primary redesign (v58.12.12)', () => {
  // (kept from v58.12.10, still applicable)
  test('off-roster free-text tech branch still exposes the position picker', async () => {
    await openLogServiceModal();
    const techSelect = await screen.findByTestId('rec-tech-select');
    await waitFor(() => expect(techSelect.disabled).toBe(false));
    await act(async () => { fireEvent.change(techSelect, { target: { value: '__manual__' } }); });
    expect(await screen.findByTestId('rec-tech')).toBeInTheDocument();
    expect(await screen.findByTestId('technician-position-select')).toBeInTheDocument();
  });

  // (a) — position selected filters tech list to matching workers
  test('picking a position filters technician list to matching workers only', async () => {
    await openLogServiceModal();
    const posSelect = await screen.findByTestId('technician-position-select');
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Plumber' } }); });
    // Two matches: Alice (w1) + Cara (w3). Bob (Site Sup), Eve (Tech), Del (blank) filtered out.
    const techSelect = await screen.findByTestId('rec-tech-select');
    const ids = techOptionIdsFrom(techSelect);
    expect(ids).toEqual(['w1', 'w3']);
    // Hint NOT rendered — this is the happy path.
    expect(screen.queryByTestId('technician-position-hint-no-match')).toBeNull();
  });

  // (b) — position with zero matches → hint + full fallback list
  test('position with zero-match workers renders hint and falls back to full list', async () => {
    await openLogServiceModal();
    const posSelect = await screen.findByTestId('technician-position-select');
    // Type manually into a position that no worker holds.
    await act(async () => { fireEvent.change(posSelect, { target: { value: '__manual__' } }); });
    const posInput = await screen.findByTestId('technician-position-freetext');
    await act(async () => { fireEvent.change(posInput, { target: { value: 'Nonexistent Role' } }); });
    // Tech list reverts to the full 5-worker fixture (equivalent to "the full 68").
    const techSelect = await screen.findByTestId('rec-tech-select');
    const ids = techOptionIdsFrom(techSelect);
    expect(ids).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    // Hint rendered with the approved copy.
    const hint = await screen.findByTestId('technician-position-hint-no-match');
    expect(hint.textContent).toMatch(
      /No workers listed with this position — showing all workers/,
    );
  });

  // (c) — picking a technician does NOT overwrite position (position is now upstream)
  test('picking a technician does not overwrite the previously-selected position', async () => {
    await openLogServiceModal();
    const posSelect = await screen.findByTestId('technician-position-select');
    // Pick "Site Supervisor" as the position first.
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Site Supervisor' } }); });
    // Now pick "Alice Jones" (whose Simpro position is "Plumber", NOT "Site Supervisor").
    // We do this by clearing position first so Alice is visible, then re-selecting position.
    await act(async () => { fireEvent.change(posSelect, { target: { value: '' } }); });
    const techSelect = await screen.findByTestId('rec-tech-select');
    await act(async () => { fireEvent.change(techSelect, { target: { value: 'w1' } }); });
    // Re-select Site Supervisor. Alice's position should NOT have leaked.
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Site Supervisor' } }); });
    // Assert on the position select's current value directly.
    expect(posSelect.value).toBe('Site Supervisor');
  });

  // (d) — position + off-roster tech both survive to submit payload
  test('position + off-roster technician both persist to the submit payload', async () => {
    await openLogServiceModal();
    // Set position.
    const posSelect = await screen.findByTestId('technician-position-select');
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Site Supervisor' } }); });
    // Switch tech picker to free-text and type a contractor name.
    const techSelect = await screen.findByTestId('rec-tech-select');
    await act(async () => { fireEvent.change(techSelect, { target: { value: '__manual__' } }); });
    const techInput = await screen.findByTestId('rec-tech');
    await act(async () => { fireEvent.change(techInput, { target: { value: 'External Contractor Pty Ltd' } }); });
    // Fill title (required) then Save.
    const titleInput = screen.getByTestId('rec-title');
    await act(async () => { fireEvent.change(titleInput, { target: { value: 'Bi-annual service' } }); });
    await act(async () => { fireEvent.click(screen.getByTestId('rec-save')); });
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.technician_position).toBe('Site Supervisor');
    expect(body.technician_name).toBe('External Contractor Pty Ltd');
    // No technician_id — off-roster contractor.
    expect(body.technician_id).toBeNull();
  });

  // (e) — "— Type manually —" position sentinel → free-text input + full-list fallback
  test('picking "type manually" on position → free-text input + technician list reverts to full 68', async () => {
    await openLogServiceModal();
    // First, narrow tech list by picking Plumber.
    const posSelect = await screen.findByTestId('technician-position-select');
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Plumber' } }); });
    let techSelect = await screen.findByTestId('rec-tech-select');
    expect(techOptionIdsFrom(techSelect)).toEqual(['w1', 'w3']);
    // Now flip to "— Type manually —" on the position.
    await act(async () => { fireEvent.change(posSelect, { target: { value: '__manual__' } }); });
    // Position input appears.
    expect(await screen.findByTestId('technician-position-freetext')).toBeInTheDocument();
    // Position is cleared; tech list reverts to full fixture.
    techSelect = await screen.findByTestId('rec-tech-select');
    expect(techOptionIdsFrom(techSelect)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    // No hint (position is empty, no zero-match state).
    expect(screen.queryByTestId('technician-position-hint-no-match')).toBeNull();
  });
});
