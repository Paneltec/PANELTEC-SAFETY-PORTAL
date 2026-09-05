// v58.13.130a — Quick Log Service technician picker migrated to the
// shared TechnicianPicker (searchable autocomplete + tech-only via
// `/fleet/technicians`). Rewrites the .12.12 test to the new contract:
//   · Fetch is `/fleet/technicians`, response shape `{technicians: […]}`.
//   · Picker is `<input list="…">` + `<datalist>`, NOT `<select>`.
//   · Testid convention: `rec-tech-select` is the input; option-level
//     testids `rec-tech-opt-<id>` live inside the datalist.
//   · Freetext toggle: `rec-tech-freetext-toggle` (Type new) /
//     `rec-tech-back-to-picker` (Pick from list).
//   · Position filter + zero-match hint contract preserved from .12.12.
//   · Free-typed name that doesn't match any row → `technician_id: null`
//     in the submit payload (matches picker's onChange contract).
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

// Fixture: 5 techs, 3 distinct positions. Dedupe/blank cases inherited
// from the .12.12 fixture so filter-collapse assertions still land.
const TECHS_FIXTURE = [
  { id: 'w1', name: 'Alice Jones', simpro_employee_id: '101', position: 'Plumber' },
  { id: 'w2', name: 'Bob Smith',   simpro_employee_id: '102', position: 'Site Supervisor' },
  { id: 'w3', name: 'Cara Patel',  simpro_employee_id: '103', position: 'Plumber' },
  { id: 'w4', name: 'Del Nguyen',  simpro_employee_id: '104', position: '' },
  { id: 'w5', name: 'Eve Zhao',    simpro_employee_id: '105', position: 'Technician' },
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
    if (path === '/fleet/technicians') {
      // .130a — new endpoint + shape.
      return Promise.resolve({ data: { technicians: TECHS_FIXTURE, total: TECHS_FIXTURE.length } });
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
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/fleet/technicians'));
}

// Datalist option-level testids: `rec-tech-opt-<id>` — same convention
// as .12.12; still queryable to prove which rows are visible for the
// currently-picked position.
function techOptionIdsFromDatalist() {
  return Array.from(document.querySelectorAll('option[data-testid^="rec-tech-opt-"]'))
    .map((o) => o.getAttribute('data-testid').replace('rec-tech-opt-', ''));
}

describe('AssetServiceTabs · Quick Log Service TechnicianPicker (v58.13.130a)', () => {
  test('picker renders as an autocomplete input with option testids in the datalist', async () => {
    await openLogServiceModal();
    // Picker is an <input>, not a <select>.
    const techInput = await screen.findByTestId('rec-tech-select');
    expect(techInput.tagName).toBe('INPUT');
    // All 5 techs surface as option testids (no position filter yet).
    expect(techOptionIdsFromDatalist().sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
  });

  test('picking a position filters technician list to matching workers only', async () => {
    await openLogServiceModal();
    const posSelect = await screen.findByTestId('technician-position-select');
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Plumber' } }); });
    // Two matches: Alice (w1) + Cara (w3). Bob (Site Sup), Eve (Tech), Del (blank) filtered out.
    expect(techOptionIdsFromDatalist().sort()).toEqual(['w1', 'w3']);
    expect(screen.queryByTestId('technician-position-hint-no-match')).toBeNull();
  });

  test('position with zero-match workers renders hint and falls back to full list', async () => {
    await openLogServiceModal();
    const posSelect = await screen.findByTestId('technician-position-select');
    await act(async () => { fireEvent.change(posSelect, { target: { value: '__manual__' } }); });
    const posInput = await screen.findByTestId('technician-position-freetext');
    await act(async () => { fireEvent.change(posInput, { target: { value: 'Nonexistent Role' } }); });
    // Tech list reverts to the full 5-worker fixture.
    expect(techOptionIdsFromDatalist().sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    const hint = await screen.findByTestId('technician-position-hint-no-match');
    expect(hint.textContent).toMatch(
      /No workers listed with this position — showing all workers/,
    );
  });

  test('picking a technician does not overwrite the previously-selected position', async () => {
    await openLogServiceModal();
    const posSelect = await screen.findByTestId('technician-position-select');
    // Site Supervisor picked first.
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Site Supervisor' } }); });
    // Clear position so Alice is visible, then type her name.
    await act(async () => { fireEvent.change(posSelect, { target: { value: '' } }); });
    const techInput = await screen.findByTestId('rec-tech-select');
    await act(async () => { fireEvent.change(techInput, { target: { value: 'Alice Jones' } }); });
    // Re-select Site Supervisor. Alice's position should NOT have leaked.
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Site Supervisor' } }); });
    expect(posSelect.value).toBe('Site Supervisor');
  });

  test('position + off-roster technician both persist to the submit payload', async () => {
    await openLogServiceModal();
    const posSelect = await screen.findByTestId('technician-position-select');
    await act(async () => { fireEvent.change(posSelect, { target: { value: 'Site Supervisor' } }); });
    // Switch tech picker to free-text and type a contractor name.
    const freetextToggle = await screen.findByTestId('rec-tech-freetext-toggle');
    await act(async () => { fireEvent.click(freetextToggle); });
    const techInput = await screen.findByTestId('rec-tech-freetext');
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

  test('typing an exact matching name into the picker resolves technician_id on save', async () => {
    // .130a — new contract: the datalist input resolves to `t.id`
    // when the typed string matches a row's name (case-insensitive).
    await openLogServiceModal();
    const techInput = await screen.findByTestId('rec-tech-select');
    await act(async () => { fireEvent.change(techInput, { target: { value: 'Alice Jones' } }); });
    const titleInput = screen.getByTestId('rec-title');
    await act(async () => { fireEvent.change(titleInput, { target: { value: 'Bi-annual service' } }); });
    await act(async () => { fireEvent.click(screen.getByTestId('rec-save')); });
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.technician_name).toBe('Alice Jones');
    expect(body.technician_id).toBe('w1');
  });
});
