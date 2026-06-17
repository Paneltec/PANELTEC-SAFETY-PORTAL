import React, { useEffect, useState } from 'react';
import { ArrowRight, FileSearch, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { useWorkspace, wsParams } from '../lib/workspace';
import { PageHeader } from '../components/capture/Ui';

const SUGGESTED = [
  "Which contractors have docs expiring this month?",
  "What are the recurring incident categories last quarter?",
  "Show me open hazards by severity.",
  "Which inspections are overdue?",
];

function ProofChip({ c }) {
  return (
    <div className="rounded-lg border border-violet-200 bg-white p-2.5 text-xs flex gap-2 items-start">
      <span className="px-1.5 py-0.5 rounded bg-brand-violet-soft text-brand-violet text-[10px] font-semibold uppercase tracking-wider shrink-0">{c.record_type}</span>
      <div>
        <div className="text-slate-700 leading-snug">{c.label}</div>
        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{c.record_id?.slice(0, 8)}…</div>
      </div>
    </div>
  );
}

function Answer({ a }) {
  const conf = a.confidence === 'high' ? 'emerald' : a.confidence === 'medium' ? 'amber' : 'slate';
  return (
    <div className="rounded-2xl border-2 border-violet-200 bg-brand-violet-soft/60 p-5" data-testid="ask-answer">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-brand-violet">Intelligence briefing</div>
        <span className={`text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-${conf}-100 text-${conf}-700 font-semibold uppercase tracking-wider`}>{a.confidence} confidence</span>
      </div>
      <h3 className="font-display text-lg font-semibold text-slate-900">{a.title}</h3>
      <p className="mt-2 text-sm text-slate-700 leading-relaxed">{a.body}</p>
      {a.cited_evidence?.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500 mb-1.5 flex items-center gap-1"><FileSearch size={11} /> Cited evidence</div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {a.cited_evidence.map((c, i) => <ProofChip key={i} c={c} />)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Ask() {
  const { workspaceId } = useWorkspace();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [history, setHistory] = useState([]);

  const loadHistory = () => api.get('/ask/history', { params: { limit: 10 } }).then((r) => setHistory(r.data)).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  const submit = async (question) => {
    const ask = question || q;
    if (!ask.trim()) return;
    setBusy(true); setAnswer(null);
    try {
      const { data } = await api.post('/ask', { question: ask, ...wsParams(workspaceId) });
      setAnswer(data);
      loadHistory();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-4xl mx-auto" data-testid="ask-page">
      <PageHeader crumb="Overview / Ask Intelligence" title="Ask Intelligence"
        subtitle="Natural-language Q&A grounded in your own records. Every answer cites evidence." />

      <div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-card">
        <textarea data-testid="ask-input" rows={3} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Ask anything about your safety records — e.g. 'Which contractors have docs expiring this month?'"
          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-violet/30 focus:border-brand-violet" />
        <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED.map((s, i) => (
              <button key={i} onClick={() => { setQ(s); submit(s); }} data-testid={`suggested-${i}`}
                className="text-xs px-3 py-1.5 rounded-full border border-violet-200 text-brand-violet hover:bg-brand-violet-soft">{s}</button>
            ))}
          </div>
          <button onClick={() => submit()} disabled={busy} data-testid="ask-submit"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-violet text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-60">
            {busy ? <><Loader2 size={14} className="animate-spin" /> Thinking…</> : <><Sparkles size={14} /> Ask</>}
          </button>
        </div>
      </div>

      {answer && <div className="mt-6"><Answer a={answer} /></div>}

      {history.length > 0 && (
        <div className="mt-10">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase mb-3">Recent questions</div>
          <div className="space-y-3">
            {history.map((h) => (
              <div key={h.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`history-${h.id}`}>
                <div className="text-xs text-slate-500">{(h.created_at || '').slice(0, 16).replace('T', ' ')}</div>
                <div className="text-sm font-medium mt-0.5">{h.question}</div>
                {h.answer?.body && <div className="text-xs text-slate-600 mt-1 line-clamp-2">{h.answer.body}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
