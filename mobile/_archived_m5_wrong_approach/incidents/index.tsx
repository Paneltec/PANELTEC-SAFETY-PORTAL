/**
 * Incidents list — v58.13.132e
 */
import React from 'react';
import CaptureList from '../../src/components/CaptureList';

export default function IncidentsIndex() {
  return (
    <CaptureList
      moduleKey="incidents"
      newRoute="/incidents/new"
      detailRoute="/incidents/[id]"
    />
  );
}
