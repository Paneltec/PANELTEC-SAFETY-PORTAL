import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import EmailButton from '../components/EmailButton';
import PdfActions from '../components/PdfActions';
import DeleteRecordButton from '../components/DeleteRecordButton';
import { getUser } from '../lib/auth';
import { PageHeader, NewButton, BackButton, PrimaryButton, GhostButton, Field, inputClass, EmptyState } from '../components/capture/Ui';
// Phase 4.17 v134.1 — Dashboard tab.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import ModuleDashboard from '../components/dashboards/ModuleDashboard';

const TEMPLATES = {
  'Site walk': [
    'Emergency egress routes clear', 'First aid kit stocked and accessible',
    'Fire extinguishers in date', 'Edge protection in place',
    'Housekeeping in laydown areas', 'Hi-vis worn by all on site',
    'SWMS available at work face', 'Toolbox talk record complete',
  ],
  'Plant inspection': [
    'Operator licence sighted', 'Pre-start log completed', 'Hydraulic leaks — none',
    'Mirrors and cameras clean', 'Reversing alarm operational',
    'Fire extinguisher on board', 'Tyres / tracks in good condition', 'Service log up to date',
  ],
  'Working at height': [
    'EWP pre-start completed', 'Anchor points certified', 'Harnesses inspected and in date',
    'Rescue plan documented', 'Exclusion zone established', 'Tools tethered',
    'Weather conditions acceptable', 'Permit issued',
  ],
};

export default function InspectionsList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/inspections').then((r) => setItems(r.data)).finally(() => setLoading(false)); }, []);

  return (
    <div className="max-w-6xl mx-auto" data-testid="inspections-list">
      <PageHeader crumb="Capture / Inspection Reports" title="Inspection Reports"
        subtitle="Scheduled inspections — site walk, plant, working at height."
        action={<NewButton to="/app/inspections/new" label="New inspection" testid="inspection-create-btn" />} />
      <Tabs defaultValue="dashboard" className="mt-2" data-testid="inspections-tabs">
        <TabsList className="bg-slate-100 border border-slate-200">
          <TabsTrigger value="dashboard" data-testid="inspections-tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="list" data-testid="inspections-tab-list">
            List <span className="ml-1.5 text-[10px] text-slate-500 tabular-nums">{items.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4">
          <ModuleDashboard
            module="inspections" title="Inspections"
            tagline="Site walk, plant, working at height — pass rate trended and every fail surfaced."
            moduleColour="emerald"
            quickActions={[{ label: 'New inspection', route: '/app/inspections/new' }]}
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4">
      {loading ? <div className="text-sm text-slate-500">Loading…</div>
       : items.length === 0 ? <EmptyState title="No inspections yet" body="Run your first inspection." action={<NewButton to="/app/inspections/new" label="New inspection" testid="inspection-empty-create" />} />
       : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-4 py-3">Template</th><th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Results</th></tr></thead>
            <tbody>
              {items.map((it) => {
                const total = it.checklist_items?.length || 0;
                const passed = it.checklist_items?.filter((c) => c.response === 'pass').length || 0;
                const failed = it.checklist_items?.filter((c) => c.response === 'fail').length || 0;
                return (
                  <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`inspection-row-${it.id}`}>
                    <td className="px-4 py-3 font-medium">{it.template_name}</td>
                    <td className="px-4 py-3 text-slate-500">{it.date}</td>
                    <td className="px-4 py-3 text-slate-500"><span className="text-emerald-700 font-medium">{passed}</span> pass · <span className={failed > 0 ? 'text-red-700 font-medium' : ''}>{failed}</span> fail · {total - passed - failed} N/A</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1 items-center">
                        <PdfActions resourceKind="inspections" recordId={it.id} title={it.template_name || it.template || 'Inspection'} size="sm" />
                        <EmailButton resourceKind="inspections" recordId={it.id}
                          subject={`Inspection Report: ${it.template_name} — ${it.date}`}
                          body={`Inspection report.\n\nTemplate: ${it.template_name}\nDate: ${it.date}\nResults: ${passed} pass · ${failed} fail`}
                          variant="row" size="sm" label="Email" />
                        <DeleteRecordButton resourceKind="inspections" apiPath="inspections" recordId={it.id} label="Inspection" recordTitle={`${it.template_name} · ${it.date}`} onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
       )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function InspectionNew() {
  const navigate = useNavigate();
  const user = getUser();
  const wsId = user?.workspace_ids?.[0];
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState('');
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), checklist_items: [], notes: '' });

  const pickTpl = (name) => {
    setTpl(name);
    setForm((f) => ({ ...f, checklist_items: TEMPLATES[name].map((label) => ({ label, response: 'pass', notes: '' })) }));
  };

  const updItem = (i, patch) => setForm((f) => ({ ...f, checklist_items: f.checklist_items.map((c, j) => j === i ? { ...c, ...patch } : c) }));

  const save = async () => {
    if (!tpl) { toast.error('Pick a template first'); return; }
    setBusy(true);
    try {
      await api.post('/inspections', { ...form, workspace_id: wsId, template_name: tpl });
      toast.success('Inspection saved');
      navigate('/app/inspections');
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const summary = useMemo(() => {
    const c = form.checklist_items;
    return { pass: c.filter((x) => x.response === 'pass').length, fail: c.filter((x) => x.response === 'fail').length, na: c.filter((x) => x.response === 'na').length };
  }, [form.checklist_items]);

  return (
    <div className="max-w-3xl mx-auto" data-testid="inspection-new">
      <BackButton to="/app/inspections" />
      <PageHeader crumb="Capture / Inspection Reports / New" title="New inspection" />
      {!tpl ? (
        <div className="grid sm:grid-cols-3 gap-3" data-testid="template-picker">
          {Object.keys(TEMPLATES).map((name) => (
            <button key={name} onClick={() => pickTpl(name)} data-testid={`tpl-${name.replace(/\s/g, '-').toLowerCase()}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-brand-blue hover:shadow-card transition-all">
              <h3 className="font-display text-lg font-semibold">{name}</h3>
              <p className="text-xs text-slate-500 mt-1">{TEMPLATES[name].length} checklist items</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Template</div>
              <div className="font-display font-semibold">{tpl}</div>
            </div>
            <button onClick={() => { setTpl(''); setForm((f) => ({ ...f, checklist_items: [] })); }} className="text-sm text-slate-500 hover:underline">Change</button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <Field label="Date" required><input data-testid="insp-date" type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {form.checklist_items.map((item, i) => (
              <div key={i} className="p-4" data-testid={`insp-item-${i}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium text-sm flex-1">{item.label}</div>
                  <div className="flex gap-1 shrink-0">
                    {['pass', 'fail', 'na'].map((r) => (
                      <button key={r} type="button" onClick={() => updItem(i, { response: r })}
                        data-testid={`insp-${i}-${r}`}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
                          item.response === r
                            ? r === 'pass' ? 'bg-brand-green-mint text-emerald-700 border border-emerald-300'
                              : r === 'fail' ? 'bg-red-50 text-red-700 border border-red-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-300'
                            : 'bg-white text-slate-400 border border-slate-200 hover:text-slate-700'}`}>
                        {r === 'na' ? 'N/A' : r}
                      </button>
                    ))}
                  </div>
                </div>
                {item.response !== 'pass' && (
                  <input className={`${inputClass} mt-2 text-sm`} placeholder="Notes (required for fail)" value={item.notes || ''} onChange={(e) => updItem(i, { notes: e.target.value })} data-testid={`insp-${i}-notes`} />
                )}
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <Field label="Inspector notes"><textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>

          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4">
            <div className="text-sm text-slate-600"><span className="text-emerald-700 font-medium">{summary.pass}</span> pass · <span className={summary.fail > 0 ? 'text-red-700 font-medium' : ''}>{summary.fail}</span> fail · {summary.na} N/A</div>
            <div className="flex gap-2">
              <GhostButton onClick={() => navigate('/app/inspections')} testid="insp-cancel">Cancel</GhostButton>
              <PrimaryButton onClick={save} busy={busy} testid="insp-submit">Save inspection</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
