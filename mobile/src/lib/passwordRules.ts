// Phase 4.7 — password validation helpers (mirrors backend validate_password_rule)
const SPECIAL = /[^A-Za-z0-9]/;

export function passwordRuleError(pwd: string): string | null {
  if (typeof pwd !== 'string' || pwd.length < 10) return 'Min 10 characters.';
  if (!/[A-Za-z]/.test(pwd)) return 'Add at least one letter.';
  if (!/\d/.test(pwd)) return 'Add at least one digit.';
  if (!SPECIAL.test(pwd)) return 'Add at least one special character.';
  return null;
}

export function passwordStrength(pwd: string): { score: number; label: string } {
  if (!pwd) return { score: 0, label: 'Empty' };
  let s = 0;
  if (pwd.length >= 10) s++;
  if (pwd.length >= 14) s++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s++;
  if (/\d/.test(pwd) && SPECIAL.test(pwd)) s++;
  const label = ['Weak', 'Fair', 'Good', 'Strong', 'Strong'][s] || 'Weak';
  return { score: Math.min(s, 4), label };
}

export const STRENGTH_COLORS = ['#F43F5E', '#F97316', '#F59E0B', '#10B981', '#059669'];
