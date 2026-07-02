// Phase 4.14 (paneltec-v131) — Reusable "How this works" panel.
//
// A slate-outlined card that collapses/expands a full-width schematic
// image sourced from the same `/api/help/schematics/paneltec_{slug}.png`
// endpoint that powers the User Manual. State is persisted per-slug in
// localStorage so once a user closes a diagram it stays closed on their
// browser (survives reloads + navigation).
//
// Usage:
//   <HowThisWorks schematicSlug="swms" />
//   <HowThisWorks schematicSlug="architecture" title="Platform overview" defaultOpen />
//
// The image is `loading="lazy"` so panels that stay collapsed never fire
// the network request — cheap to leave on 7 pages.
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Info20Regular,
  Eye20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  Open20Regular,
} from '@fluentui/react-icons';

const STORAGE_PREFIX = 'howThisWorks:';

function readStored(slug, fallback) {
  try {
    const v = window.localStorage.getItem(STORAGE_PREFIX + slug);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (_) { /* iframe / private mode */ }
  return fallback;
}

function writeStored(slug, open) {
  try { window.localStorage.setItem(STORAGE_PREFIX + slug, open ? '1' : '0'); }
  catch (_) { /* noop */ }
}

const CAPTIONS = {
  architecture:    'Platform architecture — personas, modules, integrations and outputs.',
  swms:            'SWMS lifecycle — Create → AI parse → Review & approve → Issue & track.',
  sites_qr:        'Sites & QR sign-on flow.',
  plant_vehicles:  'Plant & Vehicles telemetry sources.',
  workers_access:  'Worker onboarding & access.',
  audit_exports:   'Audit pack contents & delivery.',
  comms_safe_mode: 'Comms Safe Mode kill switch flow.',
};

export default function HowThisWorks({
  schematicSlug,
  title = 'How this works',
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(() => readStored(schematicSlug, defaultOpen));

  useEffect(() => { writeStored(schematicSlug, open); }, [schematicSlug, open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const caption = CAPTIONS[schematicSlug] || '';
  const imgSrc = `/api/help/schematics/paneltec_${schematicSlug}.png`;
  const testidRoot = `how-this-works-${schematicSlug}`;

  return (
    <section
      data-testid={testidRoot}
      data-open={open ? 'true' : 'false'}
      className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        data-testid={`${testidRoot}-toggle`}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-slate-50">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-orange-50 text-orange-600 shrink-0">
          <Info20Regular />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          {!open && (
            <span className="inline-flex items-center gap-1.5 mt-0.5 text-xs text-slate-500">
              <Eye20Regular className="text-slate-400" /> See visual overview
            </span>
          )}
        </span>
        <span className="text-slate-400">
          {open ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 sm:px-5 py-4 bg-slate-50/40">
          <img
            src={imgSrc}
            alt={caption || title}
            loading="lazy"
            data-testid={`${testidRoot}-image`}
            className="block w-full max-w-full h-auto rounded-xl border border-slate-200 shadow-sm bg-white"
          />
          {caption && (
            <p className="mt-2 text-xs italic text-slate-500" data-testid={`${testidRoot}-caption`}>
              {caption}
            </p>
          )}
          <div className="mt-3">
            <Link
              to="/app/help"
              data-testid={`${testidRoot}-manual-link`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700">
              <Open20Regular /> View full manual
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
