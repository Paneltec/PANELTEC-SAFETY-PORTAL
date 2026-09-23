// v58.13.132mf — Display-only filename cleaner.
//
// Strips the 12- or 13-hex-char + dash prefix that legacy imports
// stamped onto stored filenames (e.g. `6373ef3a0ba47-` or
// `66d54481a3402-`). The stored `filename` value in Mongo is left
// alone — this helper is display-only, applied at render time by
// components that surface a filename to the user.
//
// Examples:
//   "6373ef3a0ba47-Bostik_PVC_Pipe_Cement.pdf"
//     → "Bostik_PVC_Pipe_Cement.pdf"
//   "66d54481a3402-BruteForce.pdf"
//     → "BruteForce.pdf"
//   "Report_v2.pdf"
//     → "Report_v2.pdf"               (unchanged — no prefix)
//   ""  / null / undefined
//     → the input, unchanged          (defensive; callers may pass
//                                       an empty string during
//                                       loading states)
//
// The regex intentionally requires the dash so a real filename that
// starts with a hex-looking word (e.g. `abcdef.pdf`) is not
// mistakenly stripped.
const HEX_PREFIX_RE = /^[0-9a-f]{12,13}-/i;

export function displayFilename(name) {
  if (typeof name !== 'string' || !name) return name;
  return name.replace(HEX_PREFIX_RE, '');
}

export default displayFilename;
