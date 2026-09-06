/**
 * Theme index — re-exports all design tokens.
 */
export { Colors } from './colors';
export { Typography } from './typography';
export { Spacing } from './spacing';

/**
 * Shorthand accessor for quick inline usage.
 * Usage: token('orange'), token('base') for spacing, etc.
 */
import { Colors } from './colors';
import { Spacing } from './spacing';
import { Typography } from './typography';

type TokenKey = keyof typeof Colors | keyof typeof Spacing;

export function token(key: TokenKey): string | number {
  if (key in Colors) return (Colors as any)[key];
  if (key in Spacing) return (Spacing as any)[key];
  return '';
}
