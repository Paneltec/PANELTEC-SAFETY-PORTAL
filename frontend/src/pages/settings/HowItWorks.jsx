// Paneltec Civil · v155c — HowItWorks collapsible section.
// Plain-English replacement for the pre-v155c ArchitectureBanner.
// No dismiss flag, no localStorage — expand/collapse only.
import React, { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';

export default function HowItWorks() {
  const [open, setOpen] = useState(false);

  return (
    <div data-testid="how-it-works"
      style={{
        background: '#fff', border: '1px solid #e5e7eb',
        borderRadius: 10, marginBottom: 16, overflow: 'hidden',
      }}>
      <button type="button"
        data-testid="how-it-works-toggle"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', background: '#f8fafc', border: 'none',
          borderBottom: open ? '1px solid #e5e7eb' : 'none',
          cursor: 'pointer', textAlign: 'left',
          fontFamily: 'Archivo, sans-serif',
        }}>
        <HelpCircle className="w-4 h-4" style={{ color: '#0f172a' }}/>
        <span style={{
          fontWeight: 800, fontSize: 12, color: '#0f172a',
          letterSpacing: '0.16em', textTransform: 'uppercase',
          flex: 1,
        }}>
          How LAN backups work
        </span>
        {open
          ? <ChevronDown className="w-4 h-4" style={{ color: '#64748b' }}/>
          : <ChevronRight className="w-4 h-4" style={{ color: '#64748b' }}/>}
      </button>
      {open && (
        <div data-testid="how-it-works-body"
          style={{ padding: '16px 18px', fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Every 6 hours (and every close-of-business, mon-fri) the Hub takes a full snapshot of your database.</li>
            <li>Snapshots are stored on the Hub for the retention window (grandfather-father-son by default).</li>
            <li>A small program on your office computer &mdash; the &ldquo;agent&rdquo; &mdash; polls the Hub, downloads each new snapshot, and writes it to your NAS.</li>
            <li>If the Hub is ever wiped, you can restore from your NAS via the Restore panel below.</li>
          </ol>
          <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
            The Hub can&rsquo;t reach a private IP like <code style={{
              background: '#f1f5f9', padding: '1px 5px', borderRadius: 3,
              fontFamily: 'ui-monospace,SFMono-Regular,monospace' }}>192.168.15.165</code>{' '}
            directly &mdash; that&rsquo;s why the agent runs on your side of the firewall
            and calls out to the Hub.
          </div>
        </div>
      )}
    </div>
  );
}
