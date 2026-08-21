// v58.12.6 — jsdom tests for the dual-track schedule editor (D-2).
// Covers the 3-test contract in the ship spec:
//   1. "Also track by" toggle collapsed by default; expanded shows only
//      the OTHER two kinds (primary's kind excluded from the dropdown).
//   2. A kind whose reading is null on the asset renders `disabled` on
//      the <option>, and the option carries the explanatory tooltip.
//   3. Save with the secondary block toggled ON includes `secondary_interval`
//      in the POST payload; toggling OFF sends `secondary_interval: null`.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('../../lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({ data: { schedules: [] } })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
  },
  apiError: (e) => String(e),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../lib/useLockBodyScroll', () => ({ __esModule: true, default: () => {} }));

import api from '../../lib/api';
import { ServiceSchedulesTab } from '../AssetServiceTabs';

const navixyAsset = {
  id: 'asset-navixy-1',
  name: 'TestVac',
  hours_meter: 8310.5,
  odo_km: 126447.0,
  workspace_id: 'ws-1',
};

const hoursOnlyAsset = {
  id: 'asset-hours-only',
  name: 'Compressor',
  hours_meter: 500.0,
  odo_km: null,           // no odometer
  workspace_id: 'ws-1',
};

beforeEach(() => {
  api.get.mockClear();
  api.post.mockClear();
  api.put.mockClear();
});

// Helper — open the New Schedule editor by clicking the "Add schedule" btn.
async function openEditor(asset = navixyAsset) {
  render(<ServiceSchedulesTab asset={asset} canEdit={true} />);
  // Wait for the schedules load to resolve
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  // Click the "Add schedule" button
  const addBtn = await screen.findByTestId('schedule-add');
  await act(async () => { fireEvent.click(addBtn); });
  await waitFor(() => expect(screen.getByTestId('schedule-editor')).toBeInTheDocument());
}

// ────────── Test 1 — toggle collapsed by default, expanded excludes primary ──────────

describe('ScheduleEditor — dual-track toggle (v58.12.6)', () => {
  test('toggle collapsed by default; expanded shows the OTHER two kinds only', async () => {
    await openEditor();
    // Section always rendered; toggle checkbox unchecked; panel absent.
    expect(screen.getByTestId('sch-secondary-section')).toBeInTheDocument();
    expect(screen.getByTestId('sch-secondary-toggle')).not.toBeChecked();
    expect(screen.queryByTestId('sch-secondary-panel')).toBeNull();
    // Expand the panel
    await act(async () => {
      fireEvent.click(screen.getByTestId('sch-secondary-toggle'));
    });
    expect(screen.getByTestId('sch-secondary-panel')).toBeInTheDocument();
    // Kind select renders exactly the two OTHER kinds (primary='hours',
    // so the select must contain km + calendar and NOT hours).
    const select = screen.getByTestId('sch-secondary-kind');
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toEqual(['km', 'calendar']);
    expect(values).not.toContain('hours');
  });

  // ────────── Test 2 — reading-null option renders disabled + tooltip ──────

  test('kind whose reading is null on the asset renders disabled with tooltip', async () => {
    await openEditor(hoursOnlyAsset);
    // Expand secondary
    await act(async () => {
      fireEvent.click(screen.getByTestId('sch-secondary-toggle'));
    });
    const select = screen.getByTestId('sch-secondary-kind');
    // Primary=hours, so the options are km + calendar. km should be
    // disabled because hoursOnlyAsset.odo_km is null. Calendar stays enabled.
    const km = select.querySelector('option[value="km"]');
    const cal = select.querySelector('option[value="calendar"]');
    expect(km).toBeDisabled();
    expect(km.getAttribute('title')).toMatch(/odometer/i);
    expect(km.textContent).toMatch(/unavailable/);
    expect(cal).not.toBeDisabled();
  });

  // ────────── Test 3 — save with / without secondary block ────────────────

  test('save with secondary ON includes secondary_interval in POST; OFF sends null', async () => {
    // ── OFF path first — no toggle click ──
    await openEditor(navixyAsset);
    await act(async () => {
      fireEvent.change(screen.getByTestId('sch-name'), { target: { value: 'primary only' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('sch-save'));
    });
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [urlOff, payloadOff] = api.post.mock.calls[0];
    expect(urlOff).toBe(`/assets/${navixyAsset.id}/schedules`);
    expect(payloadOff).toHaveProperty('secondary_interval', null);

    // ── ON path — toggle expand, fill secondary fields, submit ──
    // Re-mount fresh so state doesn't bleed between subtests.
    api.post.mockClear();
    // Close any lingering modal.
    document.body.innerHTML = '';
    await openEditor(navixyAsset);
    await act(async () => {
      fireEvent.change(screen.getByTestId('sch-name'), { target: { value: 'dual' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('sch-secondary-toggle'));
    });
    await act(async () => {
      // primary is hours (default) → default secondary is km.
      fireEvent.change(screen.getByTestId('sch-secondary-value'), { target: { value: '15000' } });
      fireEvent.change(screen.getByTestId('sch-secondary-last-done'), { target: { value: '120000' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('sch-save'));
    });
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [urlOn, payloadOn] = api.post.mock.calls[0];
    expect(urlOn).toBe(`/assets/${navixyAsset.id}/schedules`);
    expect(payloadOn.secondary_interval).not.toBeNull();
    expect(payloadOn.secondary_interval).toMatchObject({
      kind: 'km',
      value: 15000,
      last_done_value: 120000,
    });
    // UI-only fields must NOT leak into the payload.
    expect(payloadOn).not.toHaveProperty('secondary_enabled');
    expect(payloadOn).not.toHaveProperty('secondary_kind');
    expect(payloadOn).not.toHaveProperty('secondary_value');
    expect(payloadOn).not.toHaveProperty('secondary_baseline_today');
  });
});
