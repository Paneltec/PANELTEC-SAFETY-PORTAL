/**
 * Inspections list — v58.13.132e
 */
import React from 'react';
import CaptureList from '../../src/components/CaptureList';

export default function InspectionsIndex() {
  return (
    <CaptureList
      moduleKey="inspections"
      newRoute="/inspections/new"
      detailRoute="/inspections/[id]"
    />
  );
}
