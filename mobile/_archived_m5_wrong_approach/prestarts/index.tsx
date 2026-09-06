/**
 * Pre-Starts list — v58.13.132e
 */
import React from 'react';
import CaptureList from '../../src/components/CaptureList';

export default function PreStartsIndex() {
  return (
    <CaptureList
      moduleKey="pre-starts"
      newRoute="/prestarts/new"
      detailRoute="/prestarts/[id]"
    />
  );
}
