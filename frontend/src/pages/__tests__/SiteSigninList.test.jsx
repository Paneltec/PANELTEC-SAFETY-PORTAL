// v58.13.6 — Site Sign-In / Visitor Register page.
// Coverage: (1) fires the correct GET /forms/templates/{tid}/submissions
// endpoint on mount; (2) empty response renders the empty-state message.
// The group-render + tile-render paths are already covered by
// GroupedTilesView's own 6 v58.12.9 tests — this suite intentionally
// stays scoped to the page-level wiring.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('../../lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ data: [] })) },
  apiError: (e) => String(e && e.message),
}));
jest.mock('sonner', () => ({ toast: { info: jest.fn() } }));
jest.mock('../../components/capture/Ui', () => ({
  __esModule: true,
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));

import api from '../../lib/api';
import SiteSigninList from '../SiteSigninList';

test('mounts and fires GET /forms/templates/{tid}/submissions with the fixed template id', async () => {
  render(<SiteSigninList />);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(
    '/forms/templates/e8873f7e-6fd4-44c9-961a-d68e6ffecd8d/submissions',
  ));
});

test('empty response renders the empty state with the ship-approved copy', async () => {
  api.get.mockResolvedValueOnce({ data: [] });
  render(<SiteSigninList />);
  const empty = await screen.findByTestId('site-signin-empty');
  expect(empty.textContent).toMatch(/No sign-ins recorded yet/);
});
