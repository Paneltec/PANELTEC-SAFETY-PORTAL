// Paneltec Civil · v155c — SetupWizard.
// 4-step wizard driven by /api/backup/summary.setup.*
// Auto-collapses to a single-line "Setup complete ✓" chip when
// setup.complete === true (expandable for troubleshooting).
import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Circle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { TOKEN_KEY } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { downloadFile } from '@/lib/download';
import { openAccordionSection } from './AdvancedAccordion';

const SUMMARY_URL = (process.env.REACT_APP_BACKEND_URL || '') + '/api/backup/summary';
const authHdr = () => {
  const t = localStorage.getItem(TOKEN_KEY) || '';
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export default function SetupWizard() {
  const [summary, setSummary] = useState(null);
  const [manuallyOpen, setManuallyOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(SUMMARY_URL, { headers: authHdr(), cache: 'no-store' });
      if (r.ok) setSummary(await r.json());
    } catch (_e) { /* non-fatal */ }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    return () => clearInterval(iv);
  }, [load]);

  if (!summary) return null;

  const s = summary.setup || {};
  const complete = !!s.complete;
  const collapsed = complete && !manuallyOpen;

  if (collapsed) {
    return (
      <button type="button"
        data-testid="setup-wizard-complete-chip"
        onClick={() => setManuallyOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', marginBottom: 16, width: '100%',
          background: '#ecfdf5', border: '1px solid #6ee7b7',
          borderLeft: '4px solid #10b981', borderRadius: 8,
          color: '#065f46', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', textAlign: 'left',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
        <CheckCircle2 className="w-4 h-4"/>
        Setup complete
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#059669',
                       fontWeight: 500 }}>
          click to expand for troubleshooting
        </span>
      </button>
    );
  }

  const steps = [
    { id: 1, title: 'Configure a destination',
      done: !!s.destination_configured,
      body: <Step1Body done={s.destination_configured}/> },
    { id: 2, title: 'Register your agent',
      done: !!s.agent_registered,
      body: <Step2Body done={s.agent_registered}/> },
    { id: 3, title: 'Install the agent on your machine',
      done: !!s.agent_first_seen,
      body: <Step3Body done={s.agent_first_seen}
                        agentRegistered={s.agent_registered}/> },
    { id: 4, title: 'Waiting for first successful delivery',
      done: !!s.first_delivery_ok,
      body: <Step4Body done={s.first_delivery_ok}
                        firstSeen={s.agent_first_seen}/> },
  ];

  return (
    <div data-testid="setup-wizard"
      style={{
        background: '#fff', border: '1px solid #e5e7eb',
        borderLeft: '4px solid #2563eb', borderRadius: 10,
        padding: '18px 20px', marginBottom: 16,
        boxShadow: '0 10px 24px -12px rgba(15,23,42,0.15)',
      }}>
      <div style={{ display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 13,
                      letterSpacing: '0.14em', textTransform: 'uppercase',
                      color: '#0f172a' }}>
          Setup checklist
        </div>
        {complete && (
          <button type="button"
            onClick={() => setManuallyOpen(false)}
            style={{ background: 'transparent', border: 'none',
                     color: '#64748b', fontSize: 11, cursor: 'pointer' }}>
            hide
          </button>
        )}
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((step, i) => (
          <li key={step.id}
            data-testid={`setup-step-${step.id}`}
            data-done={step.done}
            style={{
              padding: '10px 0',
              borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
            <div style={{ flexShrink: 0, marginTop: 2 }}>
              {step.done
                ? <CheckCircle2 className="w-5 h-5" style={{ color: '#10b981' }}/>
                : <Circle className="w-5 h-5" style={{ color: '#cbd5e1' }}/>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: 700, fontSize: 13,
                color: step.done ? '#065f46' : '#0f172a',
                textDecoration: step.done ? 'line-through' : 'none',
              }}>
                Step {step.id} · {step.title}
              </div>
              <div style={{ marginTop: 6 }}>{step.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Step body components ────────────────────────────────────────────

function Step1Body({ done }) {
  if (done) return <Muted>A destination is configured. See Advanced → Destinations to edit.</Muted>;
  return (
    <div style={{ fontSize: 12, color: '#334155' }}>
      Add an SMB target (typically your UGREEN / Synology / QNAP NAS).
      Click to jump to the Destinations panel.
      <div style={{ marginTop: 8 }}>
        <ActionBtn onClick={() => openAccordionSection('destinations')}
          testid="setup-step-1-cta">
          Configure destination →
        </ActionBtn>
      </div>
    </div>
  );
}

function Step2Body({ done }) {
  if (done) return <Muted>An agent is registered. See Advanced → Agents to manage or rotate.</Muted>;
  return (
    <div style={{ fontSize: 12, color: '#334155' }}>
      Register the LAN agent that will poll the Hub and write snapshots
      to your NAS.
      <div style={{ marginTop: 8 }}>
        <ActionBtn onClick={() => openAccordionSection('agents')}
          testid="setup-step-2-cta">
          Register agent →
        </ActionBtn>
      </div>
    </div>
  );
}

function Step3Body({ done, agentRegistered }) {
  const [composeText, setComposeText] = useState('');
  useEffect(() => {
    if (!agentRegistered) return;
    // Fetch the compose YAML for the freshest agent so the operator
    // can copy/download it without navigating away.
    (async () => {
      try {
        const r = await fetch(
          (process.env.REACT_APP_BACKEND_URL || '') + '/api/backup/agent/docker-compose.yml/latest',
          { headers: authHdr() });
        if (r.ok) setComposeText(await r.text());
      } catch (_e) { /* endpoint might not exist yet */ }
    })();
  }, [agentRegistered]);

  if (done) return <Muted>Agent has checked in. Delivery in progress.</Muted>;
  if (!agentRegistered) return <Muted>Complete Step 2 first.</Muted>;
  return (
    <div style={{ fontSize: 12, color: '#334155' }}>
      Copy the docker-compose file below into UGREEN Docker → Project →
      Create → Deploy, or run <code style={{
        background: '#f1f5f9', padding: '1px 5px', borderRadius: 3,
        fontFamily: 'ui-monospace,SFMono-Regular,monospace' }}>docker compose up -d</code>{' '}
      on your office machine.
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <ActionBtn
          onClick={() => copyToClipboard(composeText || '', { successMsg: 'YAML copied' })}
          disabled={!composeText}
          testid="setup-step-3-copy">
          Copy YAML
        </ActionBtn>
        <ActionBtn
          onClick={() => downloadFile(composeText || '', 'paneltec-agent-compose.yml',
                                       { contentType: 'text/yaml' })}
          disabled={!composeText}
          testid="setup-step-3-download">
          Download YAML
        </ActionBtn>
        <ActionBtn onClick={() => openAccordionSection('agents')}
          testid="setup-step-3-agents">
          Show in Agents →
        </ActionBtn>
      </div>
      {composeText && (
        <pre data-testid="setup-step-3-yaml"
          style={{
            marginTop: 10, padding: 12, background: '#0f172a', color: '#e2e8f0',
            borderRadius: 6, fontSize: 11, maxHeight: 220, overflow: 'auto',
            fontFamily: 'ui-monospace,SFMono-Regular,monospace',
          }}>{composeText}</pre>
      )}
    </div>
  );
}

function Step4Body({ done, firstSeen }) {
  if (done) return <Muted>First delivery landed. Setup complete.</Muted>;
  return (
    <div style={{ fontSize: 12, color: '#334155',
                  display: 'flex', alignItems: 'center', gap: 8 }}>
      <Loader2 className="w-4 h-4" style={{
        color: '#2563eb', animation: 'ptSpin 1s linear infinite',
      }}/>
      {firstSeen
        ? 'Agent has checked in. Waiting for the first successful delivery…'
        : 'Waiting for the agent to make its first check-in…'}
      <style>{`@keyframes ptSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ActionBtn({ children, onClick, disabled, testid }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      data-testid={testid}
      style={{
        background: disabled ? '#e2e8f0' : '#0f172a',
        color: disabled ? '#94a3b8' : '#fff',
        border: 'none', borderRadius: 4,
        padding: '6px 12px', fontSize: 11, fontWeight: 800,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}>{children}</button>
  );
}

function Muted({ children }) {
  return <div style={{ fontSize: 12, color: '#64748b' }}>{children}</div>;
}
