export type OnboardingQr = { kind: 'account'; token: string } | { kind: 'install' | 'url' | 'device' };

export function classifyOnboardingQr(input: string): OnboardingQr {
  const value = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return { kind: 'device' };
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) {
      const match = /^\/m\/onboard\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
      if (match) return { kind: 'account', token: match[1] };
      if (/^\/m\/install\/?$/.test(url.pathname)) return { kind: 'install' };
    }
    if (url.protocol === 'paneltec:' && url.hostname === 'onboard' && (url.pathname === '' || url.pathname === '/')) {
      const tokens = url.searchParams.getAll('token');
      if (tokens.length === 1 && /^[A-Za-z0-9_-]+$/.test(tokens[0])) return { kind: 'account', token: tokens[0] };
    }
  } catch { /* Invalid URL */ }
  return { kind: 'url' };
}