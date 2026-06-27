import React, { useEffect, useState } from 'react';
import { Check, FileSearch, Loader2, Pencil, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { useWorkspace, wsParams } from '../lib/workspace';
import { PageHeader } from '../components/capture/Ui';
import { getUser } from '../lib/auth';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

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

// Inline form rendered as a chip for both create + edit modes.
function SuggestionForm({ initial, busy, onSave, onCancel }) {
  const [question, setQuestion] = useState(initial?.question || '');
  const [category, setCategory] = useState(initial?.category || '');
  const canSave = question.trim().length >= 3 && !busy;

  const submit = (e) => {
    e?.preventDefault();
    if (!canSave) return;
    onSave({ question: question.trim(), category: category.trim() || null });
  };

  return (
    <form onSubmit={submit}
      className="inline-flex items-center gap-1.5 rounded-full border border-brand-violet bg-white px-2 py-1 shadow-sm"
      data-testid="suggestion-form">
      <input
        autoFocus
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Suggested question…"
        data-testid="suggestion-question-input"
        className="text-xs px-2 py-1 outline-none w-64 sm:w-80 placeholder:text-slate-400"
        maxLength={240}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        data-testid="suggestion-category-select"
        className="text-xs px-1 py-1 outline-none text-slate-600 bg-transparent"
      >
        <option value="">No category</option>
        <option value="contractors">contractors</option>
        <option value="incidents">incidents</option>
        <option value="hazards">hazards</option>
        <option value="inspections">inspections</option>
        <option value="swms">swms</option>
        <option value="risk">risk</option>
        <option value="other">other</option>
      </select>
      <button type="submit" disabled={!canSave} data-testid="suggestion-save"
        className="p-1 rounded-full text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      </button>
      <button type="button" onClick={onCancel} data-testid="suggestion-cancel"
        className="p-1 rounded-full text-slate-500 hover:bg-slate-100">
        <X size={14} />
      </button>
    </form>
  );
}

// Read-only chip — clicking the chip body submits the question. Admins see
// edit/delete affordances on hover (or always-visible on touch).
function SuggestionChip({ s, canEdit, onAsk, onEdit, onDelete, confirmingDelete }) {
  return (
    <span className="group inline-flex items-center rounded-full border border-violet-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => onAsk(s.question)}
        data-testid={`suggested-${s.id}`}
        className="text-xs px-3 py-1.5 text-brand-violet hover:bg-brand-violet-soft truncate max-w-[420px]"
        title={s.question}
      >
        {s.question}
      </button>
      {canEdit && !confirmingDelete && (
        <span className="hidden group-hover:inline-flex focus-within:inline-flex items-center border-l border-violet-100">
          <button type="button" onClick={() => onEdit(s)} data-testid={`suggestion-edit-${s.id}`}
            className="p-1.5 text-slate-500 hover:bg-violet-50 hover:text-brand-violet" title="Edit">
            <Pencil size={12} />
          </button>
          <button type="button" onClick={() => onDelete(s)} data-testid={`suggestion-delete-${s.id}`}
            className="p-1.5 text-slate-500 hover:bg-red-50 hover:text-brand-red" title="Delete">
            <X size={12} />
          </button>
        </span>
      )}
      {canEdit && confirmingDelete && (
        <span className="inline-flex items-center gap-1 border-l border-red-200 bg-red-50 px-1.5 py-1">
          <span className="text-[10px] text-red-700 font-medium">Delete?</span>
          <button type="button" onClick={() => onDelete(s, true)} data-testid={`suggestion-delete-confirm-${s.id}`}
            className="p-0.5 rounded-full text-red-700 hover:bg-red-100"><Check size={12} /></button>
          <button type="button" onClick={() => onDelete(s, false, true)} data-testid={`suggestion-delete-cancel-${s.id}`}
            className="p-0.5 rounded-full text-slate-500 hover:bg-slate-100"><X size={12} /></button>
        </span>
      )}
    </span>
  );
}

export default function Ask() {
  const { workspaceId } = useWorkspace();
  const user = getUser();
  const canEdit = WRITE_ROLES.has(user?.role);

  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [history, setHistory] = useState([]);

  // Suggestions state
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | suggestion object
  const [savingForm, setSavingForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const loadHistory = () => api.get('/ask/history', { params: { limit: 10 } }).then((r) => setHistory(r.data)).catch(() => {});
  const loadSuggestions = () => api.get('/ask/suggestions').then((r) => setSuggestions(r.data || [])).catch(() => setSuggestions([])).finally(() => setSuggestionsLoading(false));

  useEffect(() => { loadHistory(); loadSuggestions(); }, []);

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

  const askFromChip = (question) => { setQ(question); submit(question); };

  const saveSuggestion = async (payload) => {
    setSavingForm(true);
    try {
      if (editing === 'new') {
        await api.post('/ask/suggestions', payload);
        toast.success('Suggestion added');
      } else if (editing && editing.id) {
        await api.patch(`/ask/suggestions/${editing.id}`, payload);
        toast.success('Suggestion updated');
      }
      setEditing(null);
      await loadSuggestions();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingForm(false);
    }
  };

  const handleDelete = async (s, confirm = false, cancel = false) => {
    if (cancel) { setConfirmDeleteId(null); return; }
    if (!confirm) { setConfirmDeleteId(s.id); return; }
    try {
      await api.delete(`/ask/suggestions/${s.id}`);
      toast.success('Suggestion deleted');
      setConfirmDeleteId(null);
      await loadSuggestions();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <div className="max-w-4xl mx-auto" data-testid="ask-page">
      <PageHeader crumb="Overview / Ask Intelligence" title="Ask Intelligence"
        subtitle="Natural-language Q&A grounded in your own records. Every answer cites evidence." />

      <div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-card">
        <textarea data-testid="ask-input" rows={3} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Ask anything about your safety records — e.g. 'Which contractors have docs expiring this month?'"
          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-violet/30 focus:border-brand-violet" />

        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div className="flex flex-wrap gap-1.5 items-center min-h-[32px]" data-testid="suggestions-row">
            {suggestionsLoading && (
              <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading suggestions…</span>
            )}
            {!suggestionsLoading && suggestions.length === 0 && editing !== 'new' && (
              <div className="text-xs text-slate-500 inline-flex items-center gap-2" data-testid="suggestions-empty">
                <span>No suggested questions yet{canEdit ? '' : ' — admins can add some'}.</span>
                {canEdit && (
                  <button type="button" onClick={() => setEditing('new')} data-testid="suggestion-empty-add"
                    className="inline-flex items-center gap-1 text-brand-violet hover:underline font-medium">
                    <Plus size={12} /> Add the first one
                  </button>
                )}
              </div>
            )}
            {!suggestionsLoading && suggestions.map((s) => (
              editing && editing.id === s.id ? (
                <SuggestionForm key={s.id} initial={s} busy={savingForm}
                  onSave={saveSuggestion} onCancel={() => setEditing(null)} />
              ) : (
                <SuggestionChip
                  key={s.id} s={s} canEdit={canEdit}
                  confirmingDelete={confirmDeleteId === s.id}
                  onAsk={askFromChip}
                  onEdit={(sug) => { setConfirmDeleteId(null); setEditing(sug); }}
                  onDelete={handleDelete}
                />
              )
            ))}
            {editing === 'new' && (
              <SuggestionForm initial={null} busy={savingForm}
                onSave={saveSuggestion} onCancel={() => setEditing(null)} />
            )}
            {canEdit && !suggestionsLoading && editing !== 'new' && suggestions.length > 0 && (
              <button type="button" onClick={() => { setConfirmDeleteId(null); setEditing('new'); }}
                data-testid="suggestion-add-btn"
                className="text-xs px-3 py-1.5 rounded-full border border-dashed border-brand-violet text-brand-violet hover:bg-brand-violet-soft inline-flex items-center gap-1">
                <Plus size={12} /> Add question
              </button>
            )}
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
