import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PhonePreviewPage from './PhonePreviewPage';

let mockAllowed = true;
jest.mock('@/lib/permissions', () => ({ useCan: () => () => mockAllowed }));
jest.mock('react-router-dom', () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }), { virtual: true });

beforeEach(() => { mockAllowed = true; });

test('a fresh preview keeps the phone URL stable until explicitly refreshed', () => {
  const { rerender } = render(<PhonePreviewPage />);
  const firstFrame = screen.getByTitle('Live Phone App');
  const firstUrl = new URL(firstFrame.src);
  expect(firstUrl.pathname).toBe('/m/');
  expect(firstUrl.searchParams.get('_preview')).toBeTruthy();
  rerender(<PhonePreviewPage />);
  expect(screen.getByTitle('Live Phone App')).toBe(firstFrame);
  expect(screen.getByTitle('Live Phone App').src).toBe(firstUrl.toString());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh phone app' }));
  expect(screen.getByTitle('Live Phone App')).not.toBe(firstFrame);
  expect(screen.getByTitle('Live Phone App').src).not.toBe(firstUrl.toString());
  expect(screen.getByRole('link', { name: 'Open full page' }).href).toBe(screen.getByTitle('Live Phone App').src);
});

test('preserves the configured mobile host, path, parameters and fragment', () => {
  process.env.REACT_APP_EXPO_URL = 'https://phone.example/m/?company=existing#forms';
  render(<PhonePreviewPage />);
  const url = new URL(screen.getByTitle('Live Phone App').src);
  expect(url.origin).toBe('https://phone.example');
  expect(url.pathname).toBe('/m/');
  expect(url.searchParams.get('company')).toBe('existing');
  expect(url.hash).toBe('#forms');
  delete process.env.REACT_APP_EXPO_URL;
});

test('does not mount the phone app without preview access', () => {
  mockAllowed = false;
  render(<PhonePreviewPage />);
  expect(screen.queryByTitle('Live Phone App')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh phone app' })).toBeNull();
});
