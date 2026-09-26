// v58.13.132n4b — Dropbox Share modal.
//
// `.132n4c` polish — signature-green tinting:
//   · Header band: subtle mint (`bg-brand-green-mint/40`) with an
//     emerald bottom border for a warm success-tone feel.
//   · Primary CTAs (Send invite, Create link, Copy) all switch
//     from Dropbox-blue to `emerald-600 → 700` — matches the same
//     signature green used in Dashboard attention-score card,
//     EmailSendModal m365 status, Inspections pass badge, and
//     PublicRenewal completion state.
//   · Destructive controls (Revoke link, Remove member) stay
//     rose — semantic reservations respected.
//   · Team-only visibility pill stays Dropbox-blue on purpose
//     (the pill communicates "Dropbox team scope", not "success").
//
// Full sharing UX built on the new /api/dropbox/browse/share/*
// endpoints. Mirrors Dropbox's own web-app share dialog:
//
//   · Top: "Invite people" — email + role dropdown (viewer/editor)
//     + optional message + "Send" button. Multiple emails at once
//     via commas.
//   · Middle: "People with access" — list of accepted members and
//     pending invitees. Direct members get a "Remove" button;
//     inherited members show a small "Inherited from parent" tag
//     and can't be removed at this scope.
//   · Bottom: "Shared link" — shows the current link (or a Create
//     button). Visibility toggle (Team only / Anyone with link).
//     Copy + Revoke buttons.
//
// State is refreshed after every mutation (create link / revoke /
// invite / remove) so the UI never drifts from the server truth.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import {
  Dismiss20Regular, Copy16Regular, Delete16Regular, Link20Regular,
  People20Regular, PersonAdd20Regular, LockClosed16Regular,
  Globe16Regular, CheckmarkCircle16Filled, Info16Regular,
} from '@fluentui/react-icons';

const DBX_BLUE = '#0061FF';

const ACCESS_LABELS = {
  viewer:   'Can view',
  editor:   'Can edit',
  owner:    'Owner',
};

const VIS_LABELS = {
  team_only: 'Team only',
  public:    'Anyone with the link',
  password:  'Password protected',
  no_one:    'Not shared',
};

const VIS_ICONS = {
  team_only: LockClosed16Regular,
  public:    Globe16Regular,
  password:  LockClosed16Regular,
};

function parseEmails(raw) {
  return (raw || '')
    .split(/[,\s;]+/)
    .map((e) => e.trim())
    .filter((e) => e && /@/.test(e));
}

export default function ShareModal({ entry, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteMessage, setInviteMessage] = useState('');
  const [showMessage, setShowMessage] = useState(false);
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [pendingLink, setPendingLink] = useState(false);
  const [removingEmail, setRemovingEmail] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/dropbox/browse/share', {
        params: { path: entry.path },
      });
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState({ loading: false, error: apiError(err), data: null });
    }
  }, [entry.path]);

  useEffect(() => {
    setState({ loading: true, error: null, data: null });
    refresh();
  }, [refresh]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const data = state.data;
  const currentLink = data?.links?.[0] || null;
  const linkVisibility = currentLink?.visibility || 'team_only';

  const acceptedMembers = data?.members || [];
  const pendingInvitees = data?.invitees || [];

  // Split members into direct + inherited so the FE can render
  // them under separate headings.
  const { directMembers, inheritedMembers } = useMemo(() => {
    const direct = [];
    const inherited = [];
    for (const m of acceptedMembers) {
      if (m.is_inherited) inherited.push(m);
      else direct.push(m);
    }
    return { directMembers: direct, inheritedMembers: inherited };
  }, [acceptedMembers]);

  // ── Actions ────────────────────────────────────────────────
  const doCreateLink = async (visibility) => {
    if (pendingLink) return;
    setPendingLink(true);
    try {
      await api.post('/dropbox/browse/share/link', {
        path: entry.path,
        visibility,
      });
      toast.success(`Link ${visibility === 'public' ? 'made public' : 'created'}.`);
      await refresh();
    } catch (err) {
      toast.error(`Link failed: ${apiError(err)}`);
    } finally {
      setPendingLink(false);
    }
  };

  const doRevokeLink = async () => {
    if (!currentLink || pendingLink) return;
    setPendingLink(true);
    try {
      await api.post('/dropbox/browse/share/link/revoke', { url: currentLink.url });
      toast.success('Link revoked.');
      await refresh();
    } catch (err) {
      toast.error(`Revoke failed: ${apiError(err)}`);
    } finally {
      setPendingLink(false);
    }
  };

  const doChangeVisibility = async (nextVis) => {
    if (nextVis === linkVisibility) return;
    if (pendingLink) return;
    // Revoke first, then create fresh with the new visibility —
    // Dropbox doesn't have an "update visibility in place" endpoint
    // for links created via create_shared_link_with_settings.
    setPendingLink(true);
    try {
      if (currentLink) {
        await api.post('/dropbox/browse/share/link/revoke', { url: currentLink.url });
      }
      await api.post('/dropbox/browse/share/link', {
        path: entry.path,
        visibility: nextVis,
      });
      toast.success(`Visibility: ${VIS_LABELS[nextVis] || nextVis}`);
      await refresh();
    } catch (err) {
      toast.error(`Visibility change failed: ${apiError(err)}`);
    } finally {
      setPendingLink(false);
    }
  };

  const doCopy = async () => {
    if (!currentLink) return;
    try {
      await navigator.clipboard.writeText(currentLink.url);
      toast.success('Link copied.');
    } catch (err) {
      toast.error(`Copy failed: ${apiError(err)}`);
    }
  };

  const doInvite = async () => {
    if (submittingInvite) return;
    const emails = parseEmails(inviteEmails);
    if (emails.length === 0) {
      toast.error('Enter at least one email address.');
      return;
    }
    setSubmittingInvite(true);
    let ok = 0;
    let failed = [];
    for (const em of emails) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.post('/dropbox/browse/share/invite', {
          path: entry.path,
          email: em,
          access_level: inviteRole,
          message: inviteMessage || null,
        });
        ok += 1;
      } catch (err) {
        failed.push(`${em}: ${apiError(err)}`);
      }
    }
    if (ok > 0) toast.success(`Invited ${ok} ${ok === 1 ? 'person' : 'people'}.`);
    if (failed.length > 0) toast.error(failed.join('\n'));
    setInviteEmails('');
    setInviteMessage('');
    setShowMessage(false);
    setSubmittingInvite(false);
    await refresh();
  };

  const doRemove = async (email) => {
    if (removingEmail) return;
    setRemovingEmail(email);
    try {
      await api.post('/dropbox/browse/share/remove-member', {
        path: entry.path, email,
      });
      toast.success(`Removed ${email}.`);
      await refresh();
    } catch (err) {
      toast.error(`Remove failed: ${apiError(err)}`);
    } finally {
      setRemovingEmail(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="dropbox-share-modal"
    >
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
           style={{ maxHeight: '86vh' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-emerald-200 bg-brand-green-mint/40">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold">
              Share
            </div>
            <div className="text-sm font-semibold text-slate-900 truncate" title={entry.name}>
              {entry.name}
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-white/60 shrink-0"
            data-testid="dropbox-share-close" aria-label="Close">
            <Dismiss20Regular style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {state.loading && (
          <div className="p-8 text-sm text-slate-500 text-center">Loading share state…</div>
        )}
        {state.error && (
          <div className="p-6 text-sm text-rose-700 bg-rose-50 border-b border-rose-100">
            <div className="font-semibold">Failed to load share state</div>
            <div className="text-xs mt-1">{state.error}</div>
          </div>
        )}

        {!state.loading && !state.error && data && (
          <div className="overflow-y-auto flex-1 min-h-0">
            {/* ── Invite section ───────────────────────────── */}
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
                <PersonAdd20Regular style={{ width: 14, height: 14 }} className="text-slate-400" />
                Invite people
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-stretch gap-2">
                  <input
                    type="text"
                    value={inviteEmails}
                    onChange={(ev) => setInviteEmails(ev.target.value)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) doInvite(); }}
                    placeholder="name@example.com, another@example.com"
                    className="flex-1 rounded-lg border border-slate-300 focus:border-slate-500 focus:outline-none px-3 py-2 text-sm"
                    data-testid="dropbox-share-invite-emails"
                  />
                  <select
                    value={inviteRole}
                    onChange={(ev) => setInviteRole(ev.target.value)}
                    className="rounded-lg border border-slate-300 focus:border-slate-500 focus:outline-none px-2 py-2 text-sm text-slate-700 bg-white"
                    data-testid="dropbox-share-invite-role"
                  >
                    <option value="viewer">Can view</option>
                    <option value="editor">Can edit</option>
                  </select>
                  <button
                    type="button"
                    onClick={doInvite}
                    disabled={submittingInvite || parseEmails(inviteEmails).length === 0}
                    className="rounded-lg text-white text-xs font-semibold px-4 py-2 disabled:opacity-40 bg-emerald-600 hover:bg-emerald-700"
                    data-testid="dropbox-share-invite-send"
                  >
                    {submittingInvite ? 'Sending…' : 'Send'}
                  </button>
                </div>
                {!showMessage && (
                  <button
                    type="button"
                    onClick={() => setShowMessage(true)}
                    className="self-start text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
                    data-testid="dropbox-share-invite-add-message"
                  >
                    Add a message (optional)
                  </button>
                )}
                {showMessage && (
                  <textarea
                    value={inviteMessage}
                    onChange={(ev) => setInviteMessage(ev.target.value)}
                    placeholder="Message (shown in the Dropbox email invite)"
                    rows={2}
                    className="rounded-lg border border-slate-300 focus:border-slate-500 focus:outline-none px-3 py-2 text-sm"
                    data-testid="dropbox-share-invite-message"
                  />
                )}
              </div>
            </div>

            {/* ── Members section ─────────────────────────── */}
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
                <People20Regular style={{ width: 14, height: 14 }} className="text-slate-400" />
                People with access
              </div>
              {directMembers.length === 0 && pendingInvitees.length === 0 && inheritedMembers.length === 0 && (
                <div className="text-xs text-slate-500 italic">No direct members. Invite someone above.</div>
              )}
              {/* Direct members */}
              {directMembers.map((m) => (
                <MemberRow
                  key={`d-${m.email}`}
                  member={m}
                  onRemove={() => doRemove(m.email)}
                  removing={removingEmail === m.email}
                />
              ))}
              {/* Pending invitees */}
              {pendingInvitees.map((m) => (
                <MemberRow
                  key={`i-${m.email}`}
                  member={m}
                  onRemove={() => doRemove(m.email)}
                  removing={removingEmail === m.email}
                  isInvitee
                />
              ))}
              {/* Inherited — collapsible */}
              {inheritedMembers.length > 0 && (
                <InheritedBlock members={inheritedMembers} />
              )}
            </div>

            {/* ── Shared link section ─────────────────────── */}
            <div className="px-5 py-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
                <Link20Regular style={{ width: 14, height: 14 }} className="text-slate-400" />
                Shared link
              </div>

              {!currentLink && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-xs text-slate-500 italic">
                    No link yet. Create one to share {entry.type === 'folder' ? 'this folder' : 'this file'} with a URL.
                  </div>
                  <button
                    type="button"
                    onClick={() => doCreateLink('team_only')}
                    disabled={pendingLink}
                    className="rounded-lg text-white text-xs font-semibold px-3 py-2 disabled:opacity-40 bg-emerald-600 hover:bg-emerald-700"
                    data-testid="dropbox-share-create-link"
                  >
                    {pendingLink ? 'Creating…' : 'Create link'}
                  </button>
                </div>
              )}

              {currentLink && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-stretch gap-2">
                    <input
                      type="text"
                      readOnly
                      value={currentLink.url}
                      onClick={(ev) => ev.target.select()}
                      className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700"
                      data-testid="dropbox-share-link-url"
                    />
                    <button
                      type="button"
                      onClick={doCopy}
                      className="rounded-lg text-white text-xs font-semibold px-3 py-2 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      data-testid="dropbox-share-link-copy"
                    >
                      <Copy16Regular style={{ width: 12, height: 12 }} />
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={doRevokeLink}
                      disabled={pendingLink || !currentLink.can_revoke}
                      className="rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-semibold px-3 py-2 inline-flex items-center gap-1.5 disabled:opacity-40"
                      data-testid="dropbox-share-link-revoke"
                    >
                      <Delete16Regular style={{ width: 12, height: 12 }} />
                      Revoke
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">Visibility:</span>
                    <VisibilityPill
                      active={linkVisibility === 'team_only'}
                      onClick={() => doChangeVisibility('team_only')}
                      disabled={pendingLink}
                      icon={LockClosed16Regular}
                      testid="dropbox-share-vis-team"
                    >Team only</VisibilityPill>
                    <VisibilityPill
                      active={linkVisibility === 'public'}
                      onClick={() => doChangeVisibility('public')}
                      disabled={pendingLink}
                      icon={Globe16Regular}
                      testid="dropbox-share-vis-public"
                    >Anyone with link</VisibilityPill>
                    <span className="ml-auto text-slate-500 text-[11px] flex items-center gap-1">
                      <CheckmarkCircle16Filled style={{ width: 11, height: 11, color: '#10b981' }} />
                      {VIS_LABELS[linkVisibility] || linkVisibility}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-4 py-2"
            data-testid="dropbox-share-done">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberRow({ member, onRemove, removing, isInvitee }) {
  const label = ACCESS_LABELS[member.access_level] || member.access_level || 'Access';
  return (
    <div
      className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0"
      data-testid={`dropbox-share-member-${member.email}`}
    >
      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-semibold text-slate-600 shrink-0 uppercase">
        {(member.display_name || member.email || '?').slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-800 font-medium truncate">
          {member.display_name || member.email}
          {isInvitee && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 font-semibold">
              Pending
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 truncate">{member.email}</div>
      </div>
      <div className="text-xs text-slate-600 font-medium shrink-0">{label}</div>
      {!member.is_owner && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          className="text-[11px] text-rose-600 hover:text-rose-800 hover:underline disabled:opacity-40 shrink-0"
          data-testid={`dropbox-share-remove-${member.email}`}
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      )}
    </div>
  );
}

function InheritedBlock({ members }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3 border-t border-dashed border-slate-200 pt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold hover:text-slate-800"
        data-testid="dropbox-share-inherited-toggle"
      >
        <Info16Regular style={{ width: 12, height: 12 }} />
        Inherited from parent · {members.length}
        <span className="ml-auto text-slate-400">{expanded ? 'Hide' : 'Show'}</span>
      </button>
      {expanded && (
        <div className="mt-2 max-h-56 overflow-y-auto">
          {members.map((m) => (
            <div key={`i-${m.email}`} className="flex items-center gap-3 py-1.5 opacity-70">
              <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-semibold text-slate-500 shrink-0 uppercase">
                {(m.display_name || m.email || '?').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-700 truncate">{m.display_name || m.email}</div>
                <div className="text-[10px] text-slate-500 truncate">{m.email}</div>
              </div>
              <div className="text-[11px] text-slate-500 shrink-0">{ACCESS_LABELS[m.access_level] || m.access_level}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VisibilityPill({ active, onClick, disabled, icon: Icon, testid, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={[
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors disabled:opacity-40',
        active
          ? 'text-white border-transparent'
          : 'text-slate-600 border-slate-300 hover:bg-slate-100',
      ].join(' ')}
      style={active ? { backgroundColor: DBX_BLUE } : undefined}
    >
      <Icon style={{ width: 11, height: 11 }} />
      {children}
    </button>
  );
}
