/**
 * Site Diary list — v58.13.132e
 */
import React from 'react';
import CaptureList from '../../src/components/CaptureList';

export default function SiteDiaryIndex() {
  return (
    <CaptureList
      moduleKey="site-diary"
      newRoute="/site-diary/new"
      detailRoute="/site-diary/[id]"
    />
  );
}
