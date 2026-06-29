// Phase 4.7 — shared password helpers used by Onboard / Reset / Change.
//
// Mirrors the backend `validate_password_rule()` in `auth_invite.py` so
// client and server agree on what "good enough" means.

const SPECIAL = /[^A-Za-z0-9]/;

export function passwordRuleError(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 10) return 'Min 10 characters.';
  if (!/[A-Za-z]/.test(pwd)) return 'Add at least one letter.';
  if (!/\d/.test(pwd))       return 'Add at least one digit.';
  if (!SPECIAL.test(pwd))    return 'Add at least one special character.';
  return null;
}

// 0..4 strength score, plus a human label. Deliberately not zxcvbn — the
// dependency footprint isn't worth it for an admin tool. The four-bucket
// signal is enough to push users away from "Password1!".
export function passwordStrength(pwd) {
  if (!pwd) return { score: 0, label: 'Empty' };
  let s = 0;
  if (pwd.length >= 10) s++;
  if (pwd.length >= 14) s++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s++;
  if (/\d/.test(pwd) && SPECIAL.test(pwd)) s++;
  const label = ['Weak', 'Fair', 'Good', 'Strong', 'Strong'][s] || 'Weak';
  return { score: Math.min(s, 4), label };
}
