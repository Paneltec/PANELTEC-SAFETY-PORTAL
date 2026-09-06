/**
 * Hazards tab (report.tsx) — v58.13.132e
 */
import React from 'react';
import CaptureList from '../../src/components/CaptureList';

export default function HazardsScreen() {
  return (
    <CaptureList
      moduleKey="hazards"
      newRoute="/hazards/new"
      detailRoute="/hazards/[id]"
    />
  );
}
