import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import api, { apiError } from '../lib/api';
import { getUser } from '../lib/auth';
import { Colors } from '../lib/colors';

const WRITE_ROLES = new Set(['admin', 'hseq_lead']);

const PANELS = [
  { key: 'tasks', name: 'Tasks', icon: 'checkbox' as const, bg: '#fbf3df', ink: '#8c6a1a' },
  { key: 'notes', name: 'Notes', icon: 'document-text' as const, bg: '#e6eff9', ink: '#1e4a8c' },
  { key: 'folders', name: 'Folders', icon: 'folder' as const, bg: '#ece6f4', ink: '#4f3a8c' },
  { key: 'members', name: 'Members', icon: 'people' as const, bg: '#fbeadf', ink: '#a8480f' },
];

function fmtDate(s: string | null | undefined) { return s ? s.slice(0, 10) : ''; }
function isOverdue(due: string, status: string) {
  if (!due || status === 'done' || status === 'cancelled') return false;
  return due < new Date().toISOString().slice(0, 10);
}
function initials(name: string) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

/* ─── Tasks Panel ─── */
function TasksPanel({ supplierId, canEdit }: { supplierId: string; canEdit: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get(`/suppliers/${supplierId}/tasks`); setItems(data || []); }
    catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [supplierId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((t) => t.status === filter);
  }, [items, filter]);

  const toggleDone = async (t: any) => {
    const next = t.status === 'done' ? 'open' : 'done';
    try { await api.patch(`/suppliers/tasks/${t.id}`, { status: next }); await load(); }
    catch (e) { Alert.alert('Error', apiError(e)); }
  };

  const saveTask = async (form: any) => {
    try {
      if (editing === 'new') {
        await api.post(`/suppliers/${supplierId}/tasks`, form);
        Alert.alert('Success', 'Task added');
      } else {
        await api.patch(`/suppliers/tasks/${editing.id}`, form);
        Alert.alert('Success', 'Task updated');
      }
      setEditing(null); await load();
    } catch (e) { Alert.alert('Error', apiError(e)); }
  };

  const removeTask = (t: any) => {
    Alert.alert('Delete task', `Delete "${t.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/suppliers/tasks/${t.id}`); await load(); }
        catch (e) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  const FILTERS = ['all', 'open', 'in_progress', 'done'];

  return (
    <View testID="tasks-panel">
      <View style={ds.panelToolbar}>
        {canEdit && (
          <TouchableOpacity testID="task-add" style={[ds.panelAddBtn, { backgroundColor: '#8c6a1a' }]} onPress={() => setEditing('new')}>
            <Ionicons name="add" size={12} color="#fff" />
            <Text style={ds.panelAddText}>Add task</Text>
          </TouchableOpacity>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginLeft: 'auto' }}>
          {FILTERS.map((f) => (
            <TouchableOpacity key={f} testID={`task-filter-${f}`} style={[ds.filterChip, filter === f && { backgroundColor: '#fbf3df' }]}
              onPress={() => setFilter(f)}>
              <Text style={[ds.filterText, filter === f && { color: '#8c6a1a', fontWeight: '700' }]}>{f.replace('_', ' ')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {editing === 'new' && <TaskForm onSave={saveTask} onCancel={() => setEditing(null)} />}

      {loading ? <ActivityIndicator style={{ marginTop: 20 }} color="#8c6a1a" /> :
       filtered.length === 0 ? (
        <View style={ds.emptyPanel}><Text style={ds.emptyPanelText}>No tasks{filter !== 'all' ? ' in this status' : ''}.</Text></View>
      ) : filtered.map((t) => (
        editing && editing.id === t.id ? (
          <TaskForm key={t.id} initial={t} onSave={saveTask} onCancel={() => setEditing(null)} />
        ) : (
          <View key={t.id} testID={`task-row-${t.id}`} style={ds.itemCard}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <TouchableOpacity testID={`task-toggle-${t.id}`} disabled={!canEdit}
                onPress={() => toggleDone(t)}
                style={[ds.checkbox, t.status === 'done' && { backgroundColor: '#10B981', borderColor: '#10B981' }]}>
                {t.status === 'done' && <Ionicons name="checkmark" size={11} color="#fff" />}
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={[ds.itemTitle, t.status === 'done' && { textDecorationLine: 'line-through', color: Colors.textTertiary }]}>{t.title}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <PriorityBadge value={t.priority} />
                  {t.due_date ? (
                    <Text style={[ds.dueDateText, isOverdue(t.due_date, t.status) && { color: '#7a1f33', fontWeight: '700' }]}>
                      {fmtDate(t.due_date)}{isOverdue(t.due_date, t.status) ? ' · overdue' : ''}
                    </Text>
                  ) : null}
                  <Text style={ds.statusLabel}>{t.status.replace('_', ' ')}</Text>
                </View>
                {t.description ? <Text style={ds.descText}>{t.description}</Text> : null}
              </View>
              {canEdit && (
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  <TouchableOpacity testID={`task-edit-${t.id}`} onPress={() => setEditing(t)} style={ds.iconBtn}>
                    <Ionicons name="pencil" size={12} color={Colors.textTertiary} />
                  </TouchableOpacity>
                  <TouchableOpacity testID={`task-delete-${t.id}`} onPress={() => removeTask(t)} style={ds.iconBtn}>
                    <Ionicons name="trash" size={12} color={Colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )
      ))}
    </View>
  );
}

function PriorityBadge({ value }: { value: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    low: { bg: '#F1F5F9', text: '#475569' },
    med: { bg: '#fbf3df', text: '#8c6a1a' },
    high: { bg: '#fbeadf', text: '#a8480f' },
  };
  const c = map[value] || map.med;
  return <View style={[ds.priorityBadge, { backgroundColor: c.bg }]}><Text style={[ds.priorityText, { color: c.text }]}>{value}</Text></View>;
}

function TaskForm({ initial, onSave, onCancel }: any) {
  const [f, setF] = useState({
    title: initial?.title || '', description: initial?.description || '',
    due_date: initial?.due_date || '', priority: initial?.priority || 'med',
    status: initial?.status || 'open',
  });
  const [saving, setSaving] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const submit = async () => {
    if (!f.title.trim()) return;
    setSaving(true);
    try { await onSave({ ...f, due_date: f.due_date || null }); }
    finally { setSaving(false); }
  };

  return (
    <View testID="task-form" style={[ds.formBox, { borderColor: '#e6d99c', backgroundColor: '#fbf3df40' }]}>
      <TextInput testID="task-title" style={ds.formInput} placeholder="Task title" value={f.title}
        onChangeText={(v) => setF({ ...f, title: v })} placeholderTextColor={Colors.textTertiary} />
      <TextInput testID="task-description" style={[ds.formInput, { minHeight: 50 }]} multiline placeholder="Description (optional)"
        value={f.description} onChangeText={(v) => setF({ ...f, description: v })} placeholderTextColor={Colors.textTertiary} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity testID="task-priority" style={ds.pickerBtn} onPress={() => setPrioOpen(true)}>
          <Text style={ds.pickerBtnText}>{f.priority}</Text>
          <Ionicons name="chevron-down" size={12} color={Colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity testID="task-status" style={ds.pickerBtn} onPress={() => setStatusOpen(true)}>
          <Text style={ds.pickerBtnText}>{f.status.replace('_', ' ')}</Text>
          <Ionicons name="chevron-down" size={12} color={Colors.textTertiary} />
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
        <TouchableOpacity style={ds.formCancel} onPress={onCancel}><Text style={ds.formCancelText}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity testID="task-save" style={[ds.formSave, { backgroundColor: '#8c6a1a' }]} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={ds.formSaveText}>Save</Text>}
        </TouchableOpacity>
      </View>
      <PickerModal visible={prioOpen} title="Priority" options={['low', 'med', 'high']}
        selected={f.priority} onSelect={(v) => { setF({ ...f, priority: v }); setPrioOpen(false); }} onClose={() => setPrioOpen(false)} />
      <PickerModal visible={statusOpen} title="Status" options={['open', 'in_progress', 'done', 'cancelled']}
        selected={f.status} onSelect={(v) => { setF({ ...f, status: v }); setStatusOpen(false); }} onClose={() => setStatusOpen(false)} />
    </View>
  );
}

/* ─── Notes Panel ─── */
function NotesPanel({ supplierId, canEdit }: { supplierId: string; canEdit: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get(`/suppliers/${supplierId}/notes`); setItems(data || []); }
    catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [supplierId]);

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try { await api.post(`/suppliers/${supplierId}/notes`, { body_md: draft.trim() }); setDraft(''); await load(); }
    catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setSaving(false); }
  };

  const saveEdit = async (id: string) => {
    try { await api.patch(`/suppliers/notes/${id}`, { body_md: editValue.trim() }); setEditingId(null); await load(); }
    catch (e) { Alert.alert('Error', apiError(e)); }
  };

  const remove = (n: any) => {
    Alert.alert('Delete note', 'Delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/suppliers/notes/${n.id}`); await load(); }
        catch (e) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  return (
    <View testID="notes-panel">
      {canEdit && (
        <View style={[ds.formBox, { borderColor: '#b9d2ec', backgroundColor: '#e6eff940' }]}>
          <TextInput testID="note-draft" style={[ds.formInput, { minHeight: 60 }]} multiline
            placeholder="Write a note..." placeholderTextColor={Colors.textTertiary}
            value={draft} onChangeText={setDraft} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 }}>
            <TouchableOpacity testID="note-add" style={[ds.formSave, { backgroundColor: '#1e4a8c' }]}
              onPress={add} disabled={saving || !draft.trim()}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : (
                <><Ionicons name="add" size={11} color="#fff" /><Text style={ds.formSaveText}>Add note</Text></>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
      {loading ? <ActivityIndicator style={{ marginTop: 20 }} color="#1e4a8c" /> :
       items.length === 0 ? (
        <View style={ds.emptyPanel}><Text style={ds.emptyPanelText}>No notes yet.</Text></View>
      ) : items.map((n) => (
        <View key={n.id} testID={`note-row-${n.id}`} style={ds.itemCard}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={ds.noteAvatar}><Text style={ds.noteAvatarText}>{initials(n.created_by_name)}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={ds.noteMeta}><Text style={{ fontWeight: '600', color: Colors.text }}>{n.created_by_name || 'Unknown'}</Text> · {fmtDate(n.created_at)}</Text>
              {editingId === n.id ? (
                <View style={{ marginTop: 4 }}>
                  <TextInput style={[ds.formInput, { minHeight: 50 }]} multiline value={editValue} onChangeText={setEditValue} />
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                    <TouchableOpacity style={ds.formCancel} onPress={() => setEditingId(null)}><Text style={ds.formCancelText}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity style={[ds.formSave, { backgroundColor: '#1e4a8c' }]} onPress={() => saveEdit(n.id)}><Text style={ds.formSaveText}>Save</Text></TouchableOpacity>
                  </View>
                </View>
              ) : (
                <Text style={ds.noteBody}>{n.body_md}</Text>
              )}
            </View>
            {canEdit && editingId !== n.id && (
              <View style={{ flexDirection: 'row', gap: 2 }}>
                <TouchableOpacity testID={`note-edit-${n.id}`} style={ds.iconBtn}
                  onPress={() => { setEditingId(n.id); setEditValue(n.body_md); }}>
                  <Ionicons name="pencil" size={12} color={Colors.textTertiary} />
                </TouchableOpacity>
                <TouchableOpacity testID={`note-delete-${n.id}`} style={ds.iconBtn} onPress={() => remove(n)}>
                  <Ionicons name="trash" size={12} color={Colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ─── Members Panel ─── */
function MembersPanel({ supplierId, canEdit }: { supplierId: string; canEdit: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get(`/suppliers/${supplierId}/members`); setItems(data || []); }
    catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [supplierId]);

  const save = async (form: any) => {
    try {
      if (editing === 'new') { await api.post(`/suppliers/${supplierId}/members`, form); }
      else { await api.patch(`/suppliers/members/${editing.id}`, form); }
      setEditing(null); await load();
    } catch (e) { Alert.alert('Error', apiError(e)); }
  };

  const remove = (m: any) => {
    Alert.alert('Remove member', `Remove "${m.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await api.delete(`/suppliers/members/${m.id}`); await load(); }
        catch (e) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  return (
    <View testID="members-panel">
      {canEdit && editing !== 'new' && (
        <TouchableOpacity testID="member-add" style={[ds.panelAddBtn, { backgroundColor: '#a8480f' }]} onPress={() => setEditing('new')}>
          <Ionicons name="add" size={12} color="#fff" /><Text style={ds.panelAddText}>Add member</Text>
        </TouchableOpacity>
      )}
      {editing === 'new' && <MemberForm onSave={save} onCancel={() => setEditing(null)} />}
      {loading ? <ActivityIndicator style={{ marginTop: 20 }} color="#a8480f" /> :
       items.length === 0 ? (
        <View style={ds.emptyPanel}><Text style={ds.emptyPanelText}>No members linked.</Text></View>
      ) : items.map((m) => (
        editing && editing.id === m.id ? (
          <MemberForm key={m.id} initial={m} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <View key={m.id} testID={`member-row-${m.id}`} style={ds.itemCard}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={ds.memberAvatar}><Text style={ds.memberAvatarText}>{initials(m.name)}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={ds.itemTitle}>{m.name}</Text>
                  {m.is_primary_contact && (
                    <View style={ds.primaryBadge}><Text style={ds.primaryBadgeText}>Primary</Text></View>
                  )}
                </View>
                {m.role ? <Text style={ds.memberRole}>{m.role}</Text> : null}
                {m.email ? <Text style={ds.memberContact}>{m.email}</Text> : null}
                {m.phone ? <Text style={ds.memberContact}>{m.phone}</Text> : null}
              </View>
              {canEdit && (
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  <TouchableOpacity testID={`member-edit-${m.id}`} style={ds.iconBtn} onPress={() => setEditing(m)}>
                    <Ionicons name="pencil" size={12} color={Colors.textTertiary} />
                  </TouchableOpacity>
                  <TouchableOpacity testID={`member-delete-${m.id}`} style={ds.iconBtn} onPress={() => remove(m)}>
                    <Ionicons name="trash" size={12} color={Colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )
      ))}
    </View>
  );
}

function MemberForm({ initial, onSave, onCancel }: any) {
  const [f, setF] = useState({
    name: initial?.name || '', role: initial?.role || '',
    email: initial?.email || '', phone: initial?.phone || '',
    is_primary_contact: !!initial?.is_primary_contact,
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!f.name.trim()) return;
    setSaving(true);
    try { await onSave(f); } finally { setSaving(false); }
  };

  return (
    <View testID="member-form" style={[ds.formBox, { borderColor: '#e9c0a5', backgroundColor: '#fbeadf40' }]}>
      <TextInput testID="member-name" style={ds.formInput} placeholder="Full name" value={f.name}
        onChangeText={(v) => setF({ ...f, name: v })} placeholderTextColor={Colors.textTertiary} />
      <TextInput testID="member-role" style={ds.formInput} placeholder="Role / title (optional)" value={f.role}
        onChangeText={(v) => setF({ ...f, role: v })} placeholderTextColor={Colors.textTertiary} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput testID="member-email" style={[ds.formInput, { flex: 1 }]} placeholder="email@example.com"
          value={f.email} onChangeText={(v) => setF({ ...f, email: v })} keyboardType="email-address"
          autoCapitalize="none" placeholderTextColor={Colors.textTertiary} />
        <TextInput testID="member-phone" style={[ds.formInput, { flex: 1 }]} placeholder="Phone"
          value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad"
          placeholderTextColor={Colors.textTertiary} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <Switch testID="member-primary" value={f.is_primary_contact}
          onValueChange={(v) => setF({ ...f, is_primary_contact: v })}
          trackColor={{ true: '#10B981', false: '#CBD5E1' }} />
        <Text style={{ fontSize: 12, color: Colors.text }}>Primary contact</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
        <TouchableOpacity style={ds.formCancel} onPress={onCancel}><Text style={ds.formCancelText}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity testID="member-save" style={[ds.formSave, { backgroundColor: '#a8480f' }]} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={ds.formSaveText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Folders Panel ─── */
function FoldersPanel({ supplierId, canEdit }: { supplierId: string; canEdit: boolean }) {
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [openFolder, setOpenFolder] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get(`/suppliers/${supplierId}/folders`); setFolders(data || []); }
    catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [supplierId]);

  const createFolder = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await api.post(`/suppliers/${supplierId}/folders`, { name: name.trim() }); setName(''); setCreating(false); await load(); }
    catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setSaving(false); }
  };

  if (openFolder) {
    return <FolderFiles folder={openFolder} canEdit={canEdit} onBack={() => { setOpenFolder(null); load(); }} />;
  }

  return (
    <View testID="folders-panel">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Text style={{ fontSize: 12, color: Colors.textTertiary }}>{folders.length} folder{folders.length === 1 ? '' : 's'}</Text>
        {canEdit && !creating && (
          <TouchableOpacity testID="folder-add" style={[ds.panelAddBtn, { backgroundColor: '#4f3a8c' }]} onPress={() => setCreating(true)}>
            <Ionicons name="add" size={12} color="#fff" /><Text style={ds.panelAddText}>New folder</Text>
          </TouchableOpacity>
        )}
      </View>
      {creating && (
        <View style={[ds.formBox, { borderColor: '#e2dcef', backgroundColor: '#ece6f440', flexDirection: 'row', gap: 8 }]}>
          <TextInput testID="folder-create-input" style={[ds.formInput, { flex: 1 }]} placeholder="Folder name"
            value={name} onChangeText={setName} autoFocus placeholderTextColor={Colors.textTertiary} />
          <TouchableOpacity testID="folder-create-save" style={[ds.formSave, { backgroundColor: '#4f3a8c' }]} onPress={createFolder} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={ds.formSaveText}>Create</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={ds.formCancel} onPress={() => { setCreating(false); setName(''); }}>
            <Text style={ds.formCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
      {loading ? <ActivityIndicator style={{ marginTop: 20 }} color="#4f3a8c" /> :
       folders.length === 0 ? (
        <View style={ds.emptyPanel}><Text style={ds.emptyPanelText}>No folders linked to this supplier yet.</Text></View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {folders.map((f) => (
            <TouchableOpacity key={f.id} testID={`supplier-folder-${f.id}`}
              style={ds.folderTile} onPress={() => setOpenFolder(f)}>
              <Ionicons name="folder-open" size={20} color="#4f3a8c" />
              <Text style={ds.folderTileName} numberOfLines={2}>{f.name}</Text>
              <Text style={ds.folderTileCount}>{f.file_count} file{f.file_count === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function FolderFiles({ folder, canEdit, onBack }: any) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get(`/document-library/folders/${folder.id}/files`); setFiles(data || []); }
    catch (e) { Alert.alert('Error', apiError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [folder.id]);

  const pickAndUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      setUploading(true);
      const formData = new FormData();
      for (const asset of result.assets) {
        formData.append('files', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' } as any);
      }
      const { data } = await api.post(`/document-library/folders/${folder.id}/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const ok = (data.saved || []).length;
      if (ok) Alert.alert('Uploaded', `${ok} file${ok === 1 ? '' : 's'} uploaded`);
      (data.rejected || []).forEach((r: any) => Alert.alert('Rejected', `${r.filename}: ${r.reason}`));
      await load();
    } catch (e: any) { Alert.alert('Error', apiError(e)); }
    finally { setUploading(false); }
  };

  const remove = (f: any) => {
    Alert.alert('Delete file', `Delete "${f.filename}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/document-library/files/${f.id}`); await load(); }
        catch (e) { Alert.alert('Error', apiError(e)); }
      }},
    ]);
  };

  return (
    <View testID="folder-files-view">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <TouchableOpacity testID="folder-back" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} onPress={onBack}>
          <Ionicons name="arrow-back" size={14} color={Colors.blue} />
          <Text style={{ fontSize: 12, color: Colors.blue, fontWeight: '600' }}>Back to folders</Text>
        </TouchableOpacity>
        {canEdit && (
          <TouchableOpacity testID="folder-upload" style={[ds.panelAddBtn, { backgroundColor: '#4f3a8c' }]} onPress={pickAndUpload} disabled={uploading}>
            {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="add" size={11} color="#fff" />}
            <Text style={ds.panelAddText}>Upload</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.ink, marginBottom: 10 }}>{folder.name}</Text>
      {loading ? <ActivityIndicator style={{ marginTop: 20 }} color="#4f3a8c" /> :
       files.length === 0 ? (
        <View style={ds.emptyPanel}><Text style={ds.emptyPanelText}>No files yet.</Text></View>
      ) : files.map((f) => (
        <View key={f.id} testID={`file-row-${f.id}`} style={ds.fileRow}>
          <Ionicons name="document" size={14} color={Colors.textTertiary} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: Colors.ink }} numberOfLines={1}>{f.filename}</Text>
            <Text style={{ fontSize: 10, color: Colors.textTertiary }}>{Math.round((f.size || 0) / 1024)} KB</Text>
          </View>
          {canEdit && (
            <TouchableOpacity testID={`file-delete-${f.id}`} style={ds.iconBtn} onPress={() => remove(f)}>
              <Ionicons name="trash" size={12} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

/* ─── Picker Modal Helper ─── */
function PickerModal({ visible, title, options, selected, onSelect, onClose }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={ds.pickerOverlay} activeOpacity={1} onPress={onClose}>
        <View style={ds.pickerBox}>
          <Text style={ds.pickerTitle}>{title}</Text>
          {options.map((o: string) => (
            <TouchableOpacity key={o} style={ds.pickerItem} onPress={() => onSelect(o)}>
              <Text style={[ds.pickerItemText, selected === o && { color: Colors.blue, fontWeight: '700' }]}>{o.replace('_', ' ')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Main Drawer ─── */
export default function SupplierDrawer({ supplier, initialPanel, onClose, onChanged }: {
  supplier: any; initialPanel: string; onClose: () => void; onChanged?: () => void;
}) {
  const [panel, setPanel] = useState(initialPanel || 'tasks');
  const [user, setUser] = useState<any>(null);
  useEffect(() => { getUser().then(setUser); }, []);
  useEffect(() => { setPanel(initialPanel || 'tasks'); }, [initialPanel]);

  const canEdit = WRITE_ROLES.has(user?.role);
  if (!supplier) return null;

  const activeTheme = PANELS.find((p) => p.key === panel) || PANELS[0];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        <View testID="supplier-drawer" style={{ flex: 1 }}>
          {/* Header */}
          <View style={[ds.drawerHeader, { backgroundColor: activeTheme.bg }]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name={activeTheme.icon} size={12} color={activeTheme.ink} />
                <Text style={[ds.drawerOverline, { color: activeTheme.ink }]}>{activeTheme.name.toUpperCase()}</Text>
              </View>
              <Text style={ds.drawerTitle} numberOfLines={1}>{supplier.name}</Text>
            </View>
            <TouchableOpacity testID="drawer-close" onPress={onClose} style={{ padding: 6 }}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {/* Panel tabs */}
          <View style={ds.tabBar}>
            {PANELS.map((p) => {
              const active = panel === p.key;
              return (
                <TouchableOpacity key={p.key} testID={`tab-${p.key}`}
                  style={[ds.tab, active && { backgroundColor: p.bg }]} onPress={() => setPanel(p.key)}>
                  <Ionicons name={p.icon} size={12} color={active ? p.ink : Colors.textTertiary} />
                  <Text style={[ds.tabText, active && { color: p.ink, fontWeight: '600' }]}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Panel content */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled">
            {panel === 'tasks' && <TasksPanel supplierId={supplier.simpro_supplier_id} canEdit={canEdit} />}
            {panel === 'notes' && <NotesPanel supplierId={supplier.simpro_supplier_id} canEdit={canEdit} />}
            {panel === 'folders' && <FoldersPanel supplierId={supplier.simpro_supplier_id} canEdit={canEdit} />}
            {panel === 'members' && <MembersPanel supplierId={supplier.simpro_supplier_id} canEdit={canEdit} />}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const ds = StyleSheet.create({
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  drawerOverline: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  drawerTitle: { fontSize: 18, fontWeight: '700', color: Colors.ink, marginTop: 2 },
  tabBar: { flexDirection: 'row', backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10 },
  tabText: { fontSize: 11, fontWeight: '500', color: Colors.textTertiary },
  panelToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  panelAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  panelAddText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  emptyPanel: { alignItems: 'center', paddingVertical: 32, backgroundColor: '#F8FAFC', borderRadius: 10 },
  emptyPanelText: { fontSize: 12, color: Colors.textTertiary },
  itemCard: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 10, marginBottom: 6 },
  itemTitle: { fontSize: 13, fontWeight: '600', color: Colors.ink },
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  dueDateText: { fontSize: 10, color: Colors.textTertiary },
  statusLabel: { fontSize: 10, color: Colors.textTertiary },
  descText: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  iconBtn: { padding: 6 },
  priorityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  priorityText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  // Notes
  noteAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  noteAvatarText: { fontSize: 9, fontWeight: '700', color: Colors.textSecondary },
  noteMeta: { fontSize: 11, color: Colors.textTertiary },
  noteBody: { fontSize: 13, color: Colors.text, marginTop: 2, lineHeight: 18 },
  // Members
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fbeadf', alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 11, fontWeight: '700', color: '#a8480f' },
  memberRole: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  memberContact: { fontSize: 11, color: Colors.textTertiary },
  primaryBadge: { backgroundColor: '#d8ecdd', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  primaryBadgeText: { fontSize: 9, fontWeight: '700', color: '#1f7a3f', textTransform: 'uppercase', letterSpacing: 0.5 },
  // Folders
  folderTile: { width: '30%', borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#ece6f440', padding: 10 },
  folderTileName: { fontSize: 11, fontWeight: '600', color: Colors.ink, marginTop: 4, lineHeight: 15, minHeight: 30 },
  folderTileCount: { fontSize: 9, color: Colors.textTertiary, marginTop: 4 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 8, marginBottom: 4 },
  // Forms
  formBox: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10 },
  formInput: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: Colors.text, marginBottom: 6 },
  formCancel: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  formCancelText: { fontSize: 11, color: Colors.textSecondary },
  formSave: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  formSaveText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.white },
  pickerBtnText: { fontSize: 11, color: Colors.text, textTransform: 'capitalize' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerBox: { backgroundColor: Colors.white, borderRadius: 16, padding: 16, width: '100%', maxWidth: 280 },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: Colors.ink, marginBottom: 12 },
  pickerItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  pickerItemText: { fontSize: 14, color: Colors.text },
});
