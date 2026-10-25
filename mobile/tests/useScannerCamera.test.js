import { act, renderHook } from '@testing-library/react';
import { Platform } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { useScannerCamera } from '../src/hooks/useScannerCamera';

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }), { virtual: true });
jest.mock('expo-camera', () => ({ useCameraPermissions: jest.fn() }), { virtual: true });
const denied = { granted: false, canAskAgain: true };
let request;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'web';
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: jest.fn() }, configurable: true });
  Object.defineProperty(document, 'permissionsPolicy', { value: undefined, configurable: true });
  request = jest.fn().mockResolvedValue(denied);
  useCameraPermissions.mockReturnValue([null, request]);
});

test('does not ask on mount or re-render, and denial cannot trigger a request loop', async () => {
  const { result, rerender } = renderHook(() => useScannerCamera());
  expect(request).not.toHaveBeenCalled();
  expect(useCameraPermissions).toHaveBeenCalledWith({ get: false });
  await act(async () => { await result.current.enableCamera(); });
  expect(result.current.message).toMatch(/not allowed/);
  for (let i = 0; i < 5; i++) {
    useCameraPermissions.mockReturnValue([{ ...denied }, request]);
    rerender();
  }
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.current.cameraReady).toBe(false);
  await act(async () => { await result.current.enableCamera(); });
  expect(request).toHaveBeenCalledTimes(2);
});

test('HTTP preview never asks for permission and explains manual entry', async () => {
  Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
  const { result } = renderHook(() => useScannerCamera());
  await act(async () => { await result.current.enableCamera(); });
  expect(request).not.toHaveBeenCalled();
  expect(result.current.canRequest).toBe(false);
  expect(result.current.message).toMatch(/HTTPS/);
  expect(result.current.message).toMatch(/manually/);
});

test.each(['unsupported browser', 'iframe policy'])('%s provides a fallback without requesting', async reason => {
  if (reason === 'unsupported browser') Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  else Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: () => false }, configurable: true });
  const { result } = renderHook(() => useScannerCamera());
  await act(async () => { await result.current.enableCamera(); });
  expect(request).not.toHaveBeenCalled();
  expect(result.current.canRequest).toBe(false);
  expect(result.current.message).toMatch(/manually/);
});

test('rapid taps share one pending request; camera starts only after permission', async () => {
  let finish;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useScannerCamera());
  let pending;
  act(() => { pending = result.current.enableCamera(); result.current.enableCamera(); });
  expect(result.current.requesting).toBe(true);
  expect(result.current.cameraReady).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ granted: true, canAskAgain: true }); await pending; });
  expect(result.current.cameraReady).toBe(true);
  act(() => result.current.cameraFailed());
  expect(result.current.cameraReady).toBe(false);
  expect(result.current.message).toMatch(/could not start/);
  expect(request).toHaveBeenCalledTimes(1);
});

test('rejected permission promise is handled and stays stopped', async () => {
  request.mockRejectedValue(new Error('Permission API unavailable'));
  const { result, rerender } = renderHook(() => useScannerCamera());
  await act(async () => { await result.current.enableCamera(); });
  rerender();
  expect(result.current.requesting).toBe(false);
  expect(result.current.cameraReady).toBe(false);
  expect(result.current.message).toMatch(/could not open/);
  expect(request).toHaveBeenCalledTimes(1);
});

test('native permanent denial offers settings without another request', async () => {
  Platform.OS = 'ios';
  request.mockResolvedValue({ granted: false, canAskAgain: false });
  const { result, rerender } = renderHook(() => useScannerCamera());
  await act(async () => { await result.current.enableCamera(); });
  useCameraPermissions.mockReturnValue([{ granted: false, canAskAgain: false }, request]);
  rerender();
  expect(result.current.needsSettings).toBe(true);
  expect(result.current.canRequest).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});

test('leaving while permission is pending does not retry when it resolves', async () => {
  let finish;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result, unmount } = renderHook(() => useScannerCamera());
  let pending;
  act(() => { pending = result.current.enableCamera(); });
  unmount();
  await act(async () => { finish(denied); await pending; });
  expect(request).toHaveBeenCalledTimes(1);
});
