import { Platform } from 'react-native';

/**
 * Preview mode — web-only.
 * Reads preview_token and preview_role from URL query params.
 * Native builds always return null/false.
 */

let _previewToken: string | null = null;
let _previewRole: string | null = null;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    const params = new URLSearchParams(window.location.search);
    _previewToken = params.get('preview_token') || null;
    _previewRole = params.get('preview_role') || null;
  } catch {
    // SSR or non-browser env — ignore
  }
}

export const previewToken: string | null = _previewToken;
export const previewRole: string | null = _previewRole;
export const isPreviewMode: boolean = !!_previewToken;
