// v160.3.9.42 — Shared authed-image renderer.
//
// After v40 SEC-004 wired auth onto every `/api/files/*` and
// `/api/workers/*/photo/*` handler, any raw `<img src="/api/...">`
// with a raw enrichment URL 401s (browsers do not send Authorization
// headers on image tags). The token has to be appended as a query
// arg — that's what `filesUrl()` does (see `../lib/downloadUrl.js`).
//
// This component wraps the pattern once so every page that renders
// an auth-protected image stops re-implementing the async-resolve
// dance (and stops accidentally recreating the v41.2 class of bug).
//
// Usage:
//   <AuthedImage rawSrc={x.photo_url} alt="..." className="..." data-testid="..." />
//
// The `rawSrc` may be:
//   • an absolute URL (starts with http/https)                → passed through untouched
//   • an absolute path (starts with /api/files/...)          → `filesUrl()` appends `?token=`
//   • an already-tokened URL                                 → passed through untouched
//   • null / undefined                                       → renders nothing (parent
//                                                              fallback shows)
import React from 'react';
import { filesUrl } from '../lib/downloadUrl';

export default function AuthedImage({
  rawSrc, alt = '', className = '', onLoaded, onErrorHidden = true,
  ...rest
}) {
  const [src, setSrc] = React.useState(null);
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    setBroken(false);
    if (!rawSrc) { setSrc(null); return () => { alive = false; }; }
    filesUrl(rawSrc)
      .then((url) => { if (alive) { setSrc(url); if (onLoaded) onLoaded(url); } })
      .catch(() => { if (alive) { setSrc(null); setBroken(true); } });
    return () => { alive = false; };
  }, [rawSrc, onLoaded]);
  if (!src || broken) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setBroken(true)}
      {...rest}
    />
  );
}
