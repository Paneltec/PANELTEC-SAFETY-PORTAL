/**
 * CategoryIcon — SVG icon renderer for form categories.
 * v58.13.132p2f — replaces PNG assets with crisp vector icons.
 */
import React from 'react';
import Svg, { Path, Circle, Rect, G } from 'react-native-svg';

interface Props {
  category: string;
  size?: number;
  color?: string;
}

/**
 * Renders a distinct SVG icon for each form category.
 * All icons designed on a 24×24 viewBox for consistency.
 */
export function CategoryIcon({ category, size = 24, color = '#334155' }: Props) {
  const icon = ICONS[category] || ICONS.general;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {icon(color)}
    </Svg>
  );
}

const ICONS: Record<string, (c: string) => React.ReactNode> = {
  general: (c) => (
    <G>
      <Path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 2v6h6" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9 13h6M9 17h4" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
    </G>
  ),

  swms: (c) => (
    <G>
      <Path d="M12 3L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-4z" stroke={c} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M9 12l2 2 4-4" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </G>
  ),

  pre_start: (c) => (
    <G>
      <Rect x="5" y="2" width="14" height="20" rx="2" stroke={c} strokeWidth={1.8} />
      <Path d="M9 2V0M15 2V0" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M9 10l2 2 4-4" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9 16h6" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
    </G>
  ),

  inspection: (c) => (
    <G>
      <Circle cx="11" cy="11" r="7" stroke={c} strokeWidth={1.8} />
      <Path d="M16.5 16.5L21 21" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Path d="M8 11h6M11 8v6" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
    </G>
  ),

  hazard: (c) => (
    <G>
      <Path d="M12 2C9.5 5 7 8.5 7 12a5 5 0 0010 0c0-3.5-2.5-7-5-10z" stroke={c} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M10 14c0 1.1.9 2 2 2s2-.9 2-2" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
    </G>
  ),

  near_miss: (c) => (
    <G>
      <Circle cx="12" cy="12" r="9" stroke={c} strokeWidth={1.8} />
      <Path d="M12 8v4" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Circle cx="12" cy="16" r="1" fill={c} />
    </G>
  ),

  incident: (c) => (
    <G>
      <Path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={c} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M12 9v4" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Circle cx="12" cy="17" r="1" fill={c} />
    </G>
  ),

  risk_assessment: (c) => (
    <G>
      <Rect x="3" y="14" width="4" height="7" rx="1" stroke={c} strokeWidth={1.8} />
      <Rect x="10" y="9" width="4" height="12" rx="1" stroke={c} strokeWidth={1.8} />
      <Rect x="17" y="3" width="4" height="18" rx="1" stroke={c} strokeWidth={1.8} />
    </G>
  ),

  ssra: (c) => (
    <G>
      <Path d="M12 3L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-4z" stroke={c} strokeWidth={1.8} strokeLinejoin="round" />
      <Rect x="8" y="10" width="8" height="6" rx="1" stroke={c} strokeWidth={1.5} />
      <Path d="M10 10V8a2 2 0 014 0v2" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
    </G>
  ),

  site_diary: (c) => (
    <G>
      <Path d="M4 4h16v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" stroke={c} strokeWidth={1.8} />
      <Path d="M4 4a2 2 0 012-2h12a2 2 0 012 2" stroke={c} strokeWidth={1.8} />
      <Path d="M8 10h8M8 14h5" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M4 4h16" stroke={c} strokeWidth={1.8} />
    </G>
  ),

  toolbox: (c) => (
    <G>
      <Path d="M17 21v-2a4 4 0 00-4-4H5" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx="9" cy="7" r="4" stroke={c} strokeWidth={1.8} />
      <Path d="M23 21v-2a4 4 0 00-3-3.87" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M16 3.13a4 4 0 010 7.75" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
    </G>
  ),

  admin: (c) => (
    <G>
      <Rect x="5" y="11" width="14" height="10" rx="2" stroke={c} strokeWidth={1.8} />
      <Path d="M8 11V7a4 4 0 018 0v4" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx="12" cy="16" r="1.5" fill={c} />
    </G>
  ),

  plant_pre_start: (c) => (
    <G>
      <Rect x="5" y="2" width="14" height="20" rx="2" stroke={c} strokeWidth={1.8} />
      <Path d="M9 10l2 2 4-4" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9 16h6" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
    </G>
  ),
};
