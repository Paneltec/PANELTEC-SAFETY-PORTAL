// Office programs admin — keep the list of outside programs (Simpro,
// Xero, ...) and tick who sees each one on their Office Dashboard.
// Access is per person, or a whole Simpro company at once
// (2 = Paneltec Civil, 3 = Viatec Traffic). Requires users.edit.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '../lib/api';
import { PageHeader, PrimaryButton, GhostButton, Field, inputClass, EmptyState } from '../components/capture/Ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { useCan } from '../lib/permissions';

const BLANK = { label: '', category: '', url: '', description: '' };

function ProgramDialog({ open, program, categories, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(program
      ? { label: program.label, category: program.category, url: program.url, description: program.description }
      : BLANK);
    setConfirmDelete(false);
  }, [open, program]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.label.trim()) { toast.error('Give the program a label.'); return; }
    setBusy(true);
    try {
      const r = program
        ? await api.patch(`/office-apps/${program.id}`, form)
        : await api.post('/office-apps', form);
      onSaved(r.data);
    } catch (err) { toast.error(apiError(err)); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    try {
      await api.delete(`/office-apps/${program.id}`);
      onDeleted(program.id);
    } catch (err) { toast.error(apiError(err)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="office-program-dialog">
        <DialogHeader>
          <DialogTitle>{program ? 'Edit program' : 'Add a program'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Field label="Label" required>
            <input className={inputClass} value={form.label} onChange={set('label')} maxLength={60}
              placeholder="e.g. Simpro" data-testid="office-program-label" />
          </Field>
          <Field label="Category">
            <input className={inputClass} value={form.category} onChange={set('category')} maxLength={40}
              placeholder="e.g. Quoting" list="office-program-categories" data-testid="office-program-category" />
            <datalist id="office-program-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Web address (URL)" hint="Leave blank until you have it. The tile stays greyed out.">
            <input className={inputClass} value={form.url} onChange={set('url')} maxLength={500}
              placeholder="https://" inputMode="url" data-testid="office-program-url" />
          </Field>
          <Field label="Description">
            <input className={inputClass} value={form.description} onChange={set('description')} maxLength={120}
              placeholder="What it's used for" data-testid="office-program-description" />
          </Field>
          <DialogFooter className="gap-2 sm:justify-between">
            {program ? (
              <button type="button" onClick={remove} disabled={busy} data-testid="office-program-delete"
                className="px-3 py-2.5 rounded-lg text-sm font-medium text-rose-700 hover:bg-rose-50">
                {confirmDelete ? 'Click again to remove' : 'Remove'}
              </button>
            ) : <span />}
            <span className="flex gap-2">
              <GhostButton onClick={onClose}>Cancel</GhostButton>
              <PrimaryButton type="submit" busy={busy} testid="office-program-save">Save</PrimaryButton>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function OfficeProgramsAdmin() {
  const can = useCan();
  const allowed = can('users', 'edit');
  const [programs, setPrograms] = useState(null);
  const [staff, setStaff] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState({ open: false, program: null });

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api.get('/office-apps'), api.get('/office-apps/staff')]);
      setPrograms(a.data?.items || []);
      setCompanies(a.data?.companies || []);
      setStaff(s.data?.items || []);
      setError('');
    } catch (e) { setError(apiError(e)); setPrograms([]); }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const categories = useMemo(
    () => [...new Set((programs || []).map((p) => p.category).filter(Boolean))].sort(),
    [programs],
  );

  // One group per company, plus people with no company on their record.
  const groups = useMemo(() => {
    const out = companies.map((c) => ({
      ...c, people: staff.filter((s) => s.company_ids.includes(c.id)),
    }));
    const none = staff.filter((s) => !s.company_ids.some((id) => companies.some((c) => c.id === id)));
    if (none.length) out.push({ id: '', name: 'No company on record', people: none });
    return out;
  }, [companies, staff]);

  // Save one program's access lists; put the old value back if it fails.
  const patchAccess = async (program, patch) => {
    setPrograms((ps) => ps.map((p) => (p.id === program.id ? { ...p, ...patch } : p)));
    try {
      const r = await api.patch(`/office-apps/${program.id}`, patch);
      setPrograms((ps) => ps.map((p) => (p.id === program.id ? r.data : p)));
    } catch (e) {
      toast.error(`Couldn't save that change. ${apiError(e)}`);
      setPrograms((ps) => ps.map((p) => (p.id === program.id ? program : p)));
    }
  };

  const toggleUser = (program, userId, on) => {
    const ids = new Set(program.user_ids);
    if (on) ids.add(userId); else ids.delete(userId);
    patchAccess(program, { user_ids: [...ids] });
  };

  const toggleCompany = (program, companyId, on) => {
    const ids = new Set(program.company_ids);
    if (on) ids.add(companyId); else ids.delete(companyId);
    patchAccess(program, { company_ids: [...ids] });
  };

  if (!allowed) {
    return (
      <div className="p-6 lg:p-8" data-testid="office-programs-admin-denied">
        <PageHeader crumb="Office" title="Programs and access" />
        <EmptyState title="This page is for administrators"
          body="Ask your administrator if you need a program added to your dashboard." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8" data-testid="office-programs-admin-page">
      <PageHeader
        crumb="Office"
        title="Programs and access"
        subtitle="Add the programs the office uses, then tick who sees each one on their Office Dashboard."
        action={<PrimaryButton onClick={() => setDialog({ open: true, program: null })} testid="office-program-add">Add a program</PrimaryButton>}
      />
      <p className="mb-4 text-sm">
        <Link to="/app/office" className="text-orange-600 font-semibold hover:underline">Back to the Office Dashboard</Link>
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          Couldn't load programs. {error}
        </div>
      )}
      {programs === null && <div className="text-sm text-slate-500">Loading…</div>}

      {programs !== null && programs.length === 0 && !error && (
        <EmptyState title="No programs added yet" body="Start with the ones everyone uses, such as Simpro and Xero." />
      )}

      {programs !== null && programs.length > 0 && (
        <>
          <section className="mb-8">
            <h2 className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-500 mb-2">Programs</h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {programs.map((p) => (
                <li key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 break-words">{p.label}</div>
                    <div className="text-xs text-slate-500 break-all">
                      {(p.category || 'Other')} · {p.url || 'No web address yet'}
                    </div>
                  </div>
                  <GhostButton onClick={() => setDialog({ open: true, program: p })} testid={`office-program-edit-${p.id}`}>Edit</GhostButton>
                </li>
              ))}
            </ul>
          </section>

          {groups.map((g) => (
            <section key={g.id || 'none'} className="mb-8" data-testid={`office-access-${g.id || 'none'}`}>
              <h2 className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-500 mb-2">
                {g.name}{g.id ? ` · Company ${g.id}` : ''} · {g.people.length} {g.people.length === 1 ? 'person' : 'people'}
              </h2>
              <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-700">
                      <th scope="col" className="text-left font-semibold px-4 py-3 min-w-[200px]">Name</th>
                      {programs.map((p) => (
                        <th key={p.id} scope="col" className="font-semibold px-3 py-3 min-w-[110px] text-center align-bottom">
                          <div>{p.label}</div>
                          {g.id && (
                            <label className="mt-1 inline-flex items-center gap-1.5 text-xs font-normal text-slate-600 cursor-pointer">
                              <input type="checkbox" className="h-4 w-4 accent-emerald-600"
                                checked={p.company_ids.includes(g.id)}
                                onChange={(e) => toggleCompany(p, g.id, e.target.checked)}
                                data-testid={`office-access-company-${g.id}-${p.id}`} />
                              Everyone
                            </label>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.people.length === 0 && (
                      <tr><td className="px-4 py-4 text-slate-500" colSpan={programs.length + 1}>No one in this company yet. People appear here after the Simpro sync.</td></tr>
                    )}
                    {g.people.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0">
                        <th scope="row" className="text-left font-normal px-4 py-2">
                          <div className="font-medium text-slate-900">{s.name}</div>
                          {s.position && <div className="text-xs text-slate-500">{s.position}</div>}
                        </th>
                        {programs.map((p) => {
                          const viaCompany = s.company_ids.some((c) => p.company_ids.includes(c));
                          return (
                            <td key={p.id} className="text-center px-3 py-2">
                              <input type="checkbox" className="h-5 w-5 accent-emerald-600 disabled:opacity-50"
                                aria-label={`${s.name} can see ${p.label}`}
                                title={viaCompany ? 'Included because their whole company has access' : undefined}
                                checked={viaCompany || p.user_ids.includes(s.id)}
                                disabled={viaCompany}
                                onChange={(e) => toggleUser(p, s.id, e.target.checked)}
                                data-testid={`office-access-${s.id}-${p.id}`} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <p className="text-xs text-slate-500 max-w-2xl">
            Ticks decide which programs show on a person's Office Dashboard. Each program still asks for its own
            login, so keep those logins as the real lock. Administrators always see every program.
          </p>
        </>
      )}

      <ProgramDialog
        open={dialog.open}
        program={dialog.program}
        categories={categories}
        onClose={() => setDialog({ open: false, program: null })}
        onSaved={(saved) => {
          setPrograms((ps) => {
            const list = ps || [];
            return list.some((p) => p.id === saved.id)
              ? list.map((p) => (p.id === saved.id ? saved : p))
              : [...list, saved];
          });
          setDialog({ open: false, program: null });
          toast.success('Saved');
        }}
        onDeleted={(id) => {
          setPrograms((ps) => (ps || []).filter((p) => p.id !== id));
          setDialog({ open: false, program: null });
          toast.success('Program removed');
        }}
      />
    </div>
  );
}
