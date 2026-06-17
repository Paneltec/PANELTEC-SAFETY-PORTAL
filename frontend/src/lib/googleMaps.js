import { useEffect, useState } from 'react';
import api from './api';

// Module-level cache so we don't refetch on every mount.
let _cachedKey = undefined; // undefined=unknown, null=missing, string=value
let _inflight = null;

export function useGoogleMapsKey() {
  const [key, setKey] = useState(_cachedKey);
  useEffect(() => {
    if (_cachedKey !== undefined) { setKey(_cachedKey); return; }
    if (!_inflight) {
      _inflight = api.get('/integrations/google-maps/public-key')
        .then((r) => { _cachedKey = r.data.api_key || null; })
        .catch(() => { _cachedKey = null; });
    }
    _inflight.then(() => setKey(_cachedKey));
  }, []);
  return key; // undefined = loading, null = not configured, string = ready
}
