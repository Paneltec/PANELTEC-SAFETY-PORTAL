// Paneltec Civil · v155c — AdvancedAccordion.
// Wraps 7 existing Backup admin cards (Schedule, Retention, Snapshot
// History, Destinations, Agents, Discovery, Restore). Collapsed by
// default. Reset per visit — no localStorage. Named anchors so the
// hero's "Show snapshot history" button can open + scroll to a
// specific section.
import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Settings } from 'lucide-react';

export function AdvancedAccordion({ sections }) {
  // openIds is a Set of section ids currently expanded.
  const [openIds, setOpenIds] = useState(() => new Set());

  const toggle = useCallback((id) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Listen for a global "open section" event fired by the hero's
  // "Show snapshot history" button — that button dispatches
  // `paneltec:openAccordionSection` with the target section id.
  useEffect(() => {
    const onOpen = (e) => {
      const id = e?.detail?.id;
      if (!id) return;
      setOpenIds(prev => new Set([...prev, id]));
      // Give React a tick to render, then scroll.
      setTimeout(() => {
        const el = document.querySelector(`[data-testid="accordion-section-${id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    };
    window.addEventListener('paneltec:openAccordionSection', onOpen);
    return () => window.removeEventListener('paneltec:openAccordionSection', onOpen);
  }, []);

  return (
    <div data-testid="advanced-accordion"
      style={{
        background: '#fff', border: '1px solid #e5e7eb',
        borderRadius: 10, overflow: 'hidden', marginBottom: 16,
      }}>
      <div style={{
        padding: '10px 16px', background: '#0f172a', color: '#f8fafc',
        fontFamily: 'Archivo, sans-serif',
        fontSize: 11, fontWeight: 900, letterSpacing: '0.20em',
        textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Settings className="w-3.5 h-3.5"/> Advanced
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 600,
          letterSpacing: '0.06em', textTransform: 'none',
          color: '#94a3b8',
        }}>
          {openIds.size > 0 && `${openIds.size} open`}
        </span>
      </div>
      {sections.map((s) => {
        const open = openIds.has(s.id);
        return (
          <div key={s.id}
            data-testid={`accordion-section-${s.id}`}
            data-open={open}
            style={{ borderTop: '1px solid #e5e7eb' }}>
            <button type="button"
              data-testid={`accordion-toggle-${s.id}`}
              onClick={() => toggle(s.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 16px', background: open ? '#f8fafc' : '#fff',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                fontFamily: 'Archivo, sans-serif',
              }}>
              {s.icon}
              <span style={{
                fontWeight: 700, fontSize: 12, color: '#0f172a',
                letterSpacing: '0.14em', textTransform: 'uppercase', flex: 1,
              }}>
                {s.title}
              </span>
              {open
                ? <ChevronDown className="w-4 h-4" style={{ color: '#64748b' }}/>
                : <ChevronRight className="w-4 h-4" style={{ color: '#64748b' }}/>}
            </button>
            {open && (
              <div data-testid={`accordion-body-${s.id}`}
                style={{ padding: '4px 16px 18px', borderTop: '1px solid #f1f5f9' }}>
                {s.children}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Helper the hero's "Show snapshot history" button uses to open + scroll
// to a specific section. Fires a window event that AdvancedAccordion
// picks up. Keeps BackupTab.jsx from having to hoist accordion state.
export function openAccordionSection(id) {
  window.dispatchEvent(new CustomEvent('paneltec:openAccordionSection', {
    detail: { id },
  }));
}

export default AdvancedAccordion;
