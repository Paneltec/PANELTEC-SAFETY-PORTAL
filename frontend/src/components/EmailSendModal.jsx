import React, { useEffect, useState } from 'react';
import { Mail, X as XIcon, Loader2, Send, Paperclip, ChevronDown, ChevronRight, AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import api, { apiError } from '../lib/api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PillInput({ values, onChange, placeholder, testid }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
    const valid = parts.filter((e) => EMAIL_RE.test(e));
    const invalid = parts.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length) toast.error(`Invalid email: ${invalid.join(', ')}`);
    if (valid.length) onChange([...values, ...valid.filter((v) => !values.includes(v))]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap gap-1.5 px-2 py-1.5 border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-brand-blue/30">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 bg-brand-blue-soft text-brand-blue text-xs px-2 py-0.5 rounded-full" data-testid={`${testid}-pill-${v}`}>
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="hover:text-blue-700" aria-label="remove">
            <XIcon size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={() => draft && commit()}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[180px] text-sm border-0 outline-none bg-transparent px-1 py-0.5"
        data-testid={testid}
      />
    </div>
  );
}

export default function EmailSendModal({
  isOpen, onClose,
  resourceKind, recordId,
  defaultSubject = '', defaultBody = '', defaultRecipients = [],
  attachments = [],
  convenienceEndpoint = null,
  onSent,
}) {
  const [to, setTo] = useState(defaultRecipients);
  const [cc, setCc] = useState([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultBody.replace(/<[^>]+>/g, '').trim());
  const [m365Connected, setM365Connected] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTo(defaultRecipients);
    setCc([]);
    setSubject(defaultSubject);
    setMessage(defaultBody.replace(/<[^>]+>/g, '').trim());
    api.get('/integrations').then(({ data }) => {
      const m = (data || []).find((x) => x.kind === 'microsoft365');
      setM365Connected(m?.status === 'connected');
    }).catch(() => setM365Connected(false));
  }, [isOpen, defaultSubject, defaultBody, defaultRecipients.join(',')]); // eslint-disable-line

  if (!isOpen) return null;

  const body_html = message.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');

  const send = async () => {
    if (to.length === 0) { toast.error('Add at least one recipient'); return; }
    if (!subject.trim()) { toast.error('Subject required'); return; }
    setBusy(true);
    try {
      let resp;
      if (convenienceEndpoint) {
        const url = convenienceEndpoint.replace('{id}', recordId);
        resp = (await api.post(url, { to, cc, message })).data;
      } else {
        resp = (await api.post('/email/send', {
          to, cc, subject, body_html,
          related_record_type: resourceKind, related_record_id: recordId,
          resource_kind: resourceKind,
          attachments: attachments.map((a) => ({ file_url: a.file_url, filename: a.label || a.filename })),
        })).data;
      }
      const sentNow = resp.status === 'sent';
      toast.success(sentNow ? 'Email sent via Microsoft 365' : 'Email queued in outbox', {
        description: sentNow ? null : 'M365 not connected — message stored',
        action: { label: 'View outbox', onClick: () => { window.location.href = '/app/outbox'; } },
      });
      onSent?.(resp);
      onClose();
    } catch (e) {
      const msg = apiError(e);
      if (e?.response?.status === 403) toast.error("You don't have permission to email this record.");
      else toast.error(msg || 'Failed to send');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[92vh] overflow-auto shadow-card-lg" onClick={(e) => e.stopPropagation()} data-testid="email-send-modal">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand-blue-soft flex items-center justify-center"><Mail size={14} className="text-brand-blue" /></div>
            <div>
              <h2 className="font-display text-lg leading-tight">Send via email</h2>
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">{resourceKind}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500 mb-1.5">To</div>
            <PillInput values={to} onChange={setTo} placeholder="recipient@example.com" testid="email-to-input" />
          </div>

          <button type="button" onClick={() => setShowCc((s) => !s)} className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1" data-testid="toggle-cc">
            {showCc ? <ChevronDown size={12} /> : <ChevronRight size={12} />} CC {cc.length > 0 && `(${cc.length})`}
          </button>
          {showCc && (
            <div>
              <PillInput values={cc} onChange={setCc} placeholder="cc@example.com" testid="email-cc-input" />
            </div>
          )}

          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500 mb-1.5">Subject</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
              data-testid="email-subject-input" />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500 mb-1.5">Message</div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue resize-y"
              placeholder="Add a personal note. The record details are appended automatically."
              data-testid="email-message-input" />
            <p className="mt-1 text-[11px] text-slate-400">Record summary + a deep-link are added automatically by the server.</p>
          </div>

          {attachments.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500 mb-1.5">Attachments</div>
              <ul className="space-y-1" data-testid="email-attachments">
                {attachments.map((a, i) => (
                  <li key={i} className="text-xs flex items-center gap-2 bg-slate-50 border border-slate-200 px-2 py-1.5 rounded">
                    <Paperclip size={11} className="text-slate-400 shrink-0" />
                    <span className="truncate">{a.label || a.filename}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {m365Connected ? (
            <div className="text-xs flex items-start gap-2 text-emerald-800 bg-brand-green-mint/50 border border-emerald-200 rounded-lg p-2.5" data-testid="m365-status">
              <Check size={13} className="mt-0.5 shrink-0" />
              <span>Will send immediately via Microsoft 365.</span>
            </div>
          ) : (
            <div className="text-xs flex items-start gap-2 text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5" data-testid="m365-status">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>Will queue — Microsoft 365 not connected. <Link to="/app/settings/integrations" className="underline">Configure M365</Link> to deliver queued messages.</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg" data-testid="email-cancel">Cancel</button>
          <button onClick={send} disabled={busy || to.length === 0 || !subject.trim()}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-brand-blue text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50"
            data-testid="email-send-submit">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
          </button>
        </div>
      </div>
    </div>
  );
}
