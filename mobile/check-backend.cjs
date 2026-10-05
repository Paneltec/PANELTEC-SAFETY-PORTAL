// Runs before native EAS builds; no dependency installation required.
function validateBackend(value) {
  if (!value || value !== value.trim()) throw new Error('Set EXPO_PUBLIC_BACKEND_URL in the selected EAS environment.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Backend address must be a valid HTTPS origin.'); }
  if (url.protocol !== 'https:') throw new Error('Native builds require an HTTPS backend.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use only the HTTPS origin, without credentials, /api, /m, query or fragment.');
  }
  if (value.endsWith('/')) throw new Error('Remove the trailing slash from the backend origin.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '[::1]' || /^127\./.test(host) ||
      host.endsWith('.invalid') || host === 'example.com' || host.endsWith('.example.com') ||
      host === 'example.org' || host.endsWith('.example.org') ||
      host === 'whs-compliance.preview.emergentagent.com') {
    throw new Error('Use the agreed reachable hosting domain, not a local, example or legacy address.');
  }
  return url.origin;
}

if (require.main === module) {
  try {
    const readiness = process.env.EAS_BUILD_PROFILE === 'iphone-readiness' &&
      process.env.EXPO_PUBLIC_IPHONE_READINESS === 'true';
    if (!readiness) validateBackend(process.env.EXPO_PUBLIC_BACKEND_URL);
    else console.log('iPhone installation test only: live app routes are disabled.');
    console.log('Mobile backend configuration validated. Network reachability still requires testing.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { validateBackend };
