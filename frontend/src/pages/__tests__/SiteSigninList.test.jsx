// v58.13.7 — Per-tile View + Delete actions on SiteSigninList.
// Coverage:
//   (a) endpoint URL fires on mount (v58.13.6 baseline preserved)
//   (b) empty state still renders (v58.13.6 baseline preserved)
//   (c) view button testid rendered on each tile after fetch
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('../../lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ data: [] })) },
  apiError: (e) => String(e && e.message),
}));
jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../../components/capture/Ui', () => ({
  __esModule: true,
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
// Stub the heavy child components — we're testing the page wiring,
// not their internals. Each component's own suite covers its behaviour.
jest.mock('../../components/SubmissionViewer', () => ({
  __esModule: true,
  default: ({ record }) => <div data-testid="viewer-open">viewing {record?.id}</div>,
}));
jest.mock('../../components/DeleteRecordButton', () => ({
  __esModule: true,
  default: ({ recordId, resourceKind }) => (
    <button data-testid={`delete-${resourceKind}-${recordId}`}>delete</button>
  ),
}));

import api from '../../lib/api';
import SiteSigninList from '../SiteSigninList';

test('mounts and fires GET /forms/templates/{tid}/submissions', async () => {
  render(<SiteSigninList />);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(
    '/forms/templates/e8873f7e-6fd4-44c9-961a-d68e6ffecd8d/submissions',
  ));
});

test('empty response renders the empty state', async () => {
  api.get.mockResolvedValueOnce({ data: [] });
  render(<SiteSigninList />);
  const empty = await screen.findByTestId('site-signin-empty');
  expect(empty.textContent).toMatch(/No sign-ins recorded yet/);
});

test('after fetch, per-tile View + Delete buttons render with correct testids', async () => {
  api.get.mockResolvedValueOnce({
    data: [{ id: 'sub-abc', submitted_by_name: 'Stephen',
              submitted_at: '2026-08-21T04:21:47Z' }],
  });
  render(<SiteSigninList />);
  // View button testid pattern: site-signin-view-{id}
  expect(await screen.findByTestId('site-signin-view-sub-abc')).toBeInTheDocument();
  // DeleteRecordButton auto-generates its own testid: delete-{resourceKind}-{recordId}
  expect(screen.getByTestId('delete-forms-sub-abc')).toBeInTheDocument();
});
