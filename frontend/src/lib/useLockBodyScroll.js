// v160.3.7h — Tiny hook: while a modal / drawer / overlay is mounted, lock
// scrolling on <body> so wheel/touch events don't leak through to the page
// underneath. Guarantees the v7g scroll-bleed bug can never recur — every
// new overlay we ship just imports this one line.
//
// Usage:
//   import useLockBodyScroll from '../lib/useLockBodyScroll';
//   function MyModal() {
//     useLockBodyScroll();   // locks on mount, restores on unmount
//     return <div>…</div>;
//   }
//
// The hook restores whatever value body.style.overflow had before the
// overlay mounted (usually ''), so nesting overlays is safe: the deeper
// one keeps 'hidden' active, and when it unmounts control returns to
// the outer overlay's value rather than clobbering back to ''.
import { useEffect } from 'react';

export default function useLockBodyScroll(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}
