// v160.0.11.1 — Ultra-light in-house toast bus.
// Avoids adding `react-native-toast-message` (~120KB) to the bundle.
// The host component (`ToastHost`) subscribes via `_setToastListener` and
// renders animated toasts. Screens fire `toast.success('…')` from anywhere.

export type ToastVariant = 'success' | 'error' | 'info';
type Listener = (msg: string, variant: ToastVariant) => void;

let listener: Listener | null = null;

export function _setToastListener(fn: Listener | null): void {
  listener = fn;
}

export const toast = {
  success: (m: string) => listener?.(m, 'success'),
  error: (m: string) => listener?.(m, 'error'),
  info: (m: string) => listener?.(m, 'info'),
};
