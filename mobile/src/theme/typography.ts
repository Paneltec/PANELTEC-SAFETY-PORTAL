/**
 * Typography scale — system font (SF Pro / Roboto).
 * No custom font bundling in M1.
 */
import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

export const Typography = {
  family: fontFamily,

  // Size scale
  xs:    11,
  sm:    13,
  base:  15,
  md:    17,
  lg:    20,
  xl:    24,
  xxl:   32,
  hero:  40,

  // Weights
  regular:   '400' as const,
  medium:    '500' as const,
  semibold:  '600' as const,
  bold:      '700' as const,
  extrabold: '800' as const,

  // Line heights
  lineHeightTight: 1.2,
  lineHeightNormal: 1.5,
};
