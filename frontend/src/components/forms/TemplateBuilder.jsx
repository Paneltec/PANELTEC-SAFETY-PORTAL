// TemplateBuilder — full-screen modal for creating and editing form templates.
// Three entry points:
//   1) Toolbar "+ New Template" → opens empty template
//   2) Per-card pencil → opens populated with existing template
//   3) Build with AI → after generation → opens with AI draft loaded
//
// Left column: drag-reorderable field list with type / required / placeholder /
// options editors. Right column: live preview pane reusing the FieldRunner in
// readOnly mode so admins see what workers will see.
import React, { useEffect, useMemo, useState } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle, GripVertical, Loader2, Plus, Trash2, X, Save, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { apiError } from '../../lib/api';
import { CATEGORIES, CAT_PILL, categoryLabel, FieldRunner } from '../../pages/Forms';

const FIELD_TYPES = [
  { key: 'text',      label: 'Short text' },
  { key: 'textarea',  label: 'Long text' },
  { key: 'date',      label: 'Date' },
  { key: 'number',    label: 'Number' },
  { key: 'select',    label: 'Dropdown (select)' },
  { key: 'radio',     label: 'Choice buttons (radio)' },
  { key: 'photo',     label: 'Photo capture' },
  { key: 'signature', label: 'Signature pad' },
  { key: 'gps',       label: 'GPS location' },
  { key: 'vehicle_navixy', label: 'Vehicle (Navixy)' },
];

const newFieldId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const emptyField = () => ({
  id: newFieldId(), label: '', type: 'text', required: false, options: [], placeholder: '',
});

function FieldEditor({ field, index, onChange, onRemove, error }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const needsOptions = field.type === 'select' || field.type === 'radio';
  const needsPlaceholder = ['text', 'textarea', 'number'].includes(field.type);
  const update = (k, v) => onChange({ ...field, [k]: v });
  const optionsText = (field.options || []).join('\n');

  return (
    <div ref={setNodeRef} style={style}
      className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"
      data-testid={`builder-field-${field.id}`}>
      <div className="flex items-start gap-2">
        <button type="button" {...attributes} {...listeners}
          className="mt-2 p-1.5 text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder" data-testid={`drag-${field.id}`}>
          <GripVertical size={16} />
        </button>
        <div className="flex-1 min-w-0 space-y-2">
          <input type="text" value={field.label}
            onChange={(e) => update('label', e.target.value)}
            placeholder={`Field ${index + 1} label`}
            data-testid={`builder-label-${field.id}`}
            className={`w-full px-3 py-2 text-sm font-semibold border rounded-lg ${error?.label ? 'border-rose-500 bg-rose-50' : 'border-slate-300 bg-white'}`} />
          <div className="grid grid-cols-2 gap-2">
            <select value={field.type} onChange={(e) => update('type', e.target.value)}
              data-testid={`builder-type-${field.id}`}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              {FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <label className="inline-flex items-center justify-between px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white cursor-pointer">
              <span className="text-slate-700">Required</span>
              <input type="checkbox" checked={!!field.required}
                onChange={(e) => update('required', e.target.checked)}
                data-testid={`builder-required-${field.id}`}
                className="w-4 h-4 text-blue-600" />
            </label>
          </div>
          {needsPlaceholder && (
            <input type="text" value={field.placeholder || ''}
              onChange={(e) => update('placeholder', e.target.value)}
              placeholder="Placeholder (optional)"
              data-testid={`builder-placeholder-${field.id}`}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700" />
          )}
          {needsOptions && (
            <div>
              <textarea value={optionsText} rows={3}
                onChange={(e) => update('options', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                placeholder={'One option per line\nYes\nNo\nN/A'}
                data-testid={`builder-options-${field.id}`}
                className={`w-full px-3 py-2 text-sm border rounded-lg bg-white font-mono ${error?.options ? 'border-rose-500 bg-rose-50' : 'border-slate-200'}`} />
              {error?.options && <p className="text-xs text-rose-600 mt-1 inline-flex items-center gap-1"><AlertCircle size={11} /> {error.options}</p>}
            </div>
          )}
          {error?.label && <p className="text-xs text-rose-600 mt-1 inline-flex items-center gap-1"><AlertCircle size={11} /> {error.label}</p>}
        </div>
        <button type="button" onClick={onRemove}
          data-testid={`builder-remove-${field.id}`}
          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg" aria-label="Remove field">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function TemplateBuilder({ template, onClose, onSaved }) {
  const isEdit = !!template?.id;
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState(template?.category || 'general');
  const [description, setDescription] = useState(template?.description || '');
  const [fields, setFields] = useState(() =>
    (template?.fields && template.fields.length)
      ? template.fields.map((f) => ({ ...f, id: f.id || newFieldId(), options: f.options || [] }))
      : [{ ...emptyField(), label: '' }],
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({ name: null, fields: {} });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setFields((prev) => {
      const oldIndex = prev.findIndex((f) => f.id === active.id);
      const newIndex = prev.findIndex((f) => f.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const addField = () => setFields((p) => [...p, emptyField()]);
  const updateField = (i, next) => setFields((p) => p.map((f, idx) => (idx === i ? next : f)));
  const removeField = (i) => setFields((p) => p.filter((_, idx) => idx !== i));

  const validate = () => {
    const next = { name: null, fields: {} };
    if (!name.trim()) next.name = 'Name is required';
    if (fields.length === 0) next.fields._global = 'Add at least one field';
    fields.forEach((f) => {
      const fe = {};
      if (!f.label || !f.label.trim()) fe.label = 'Label required';
      if ((f.type === 'select' || f.type === 'radio') && (!f.options || f.options.length < 2)) {
        fe.options = 'At least 2 options';
      }
      if (Object.keys(fe).length) next.fields[f.id] = fe;
    });
    setErrors(next);
    return !next.name && Object.keys(next.fields).length === 0;
  };

  const save = async () => {
    if (!validate()) {
      toast.error('Fix the highlighted fields before saving');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        description: description.trim(),
        fields: fields.map((f) => ({
          id: f.id, label: f.label.trim(), type: f.type,
          required: !!f.required,
          options: (f.type === 'select' || f.type === 'radio') ? f.options : [],
          placeholder: f.placeholder || '',
        })),
      };
      if (isEdit) {
        const { data } = await api.patch(`/forms/templates/${template.id}`, payload);
        toast.success(`Saved "${data.name}"`);
        onSaved?.(data);
      } else {
        const { data } = await api.post('/forms/templates', payload);
        toast.success(`Created "${data.name}"`);
        onSaved?.(data);
      }
      onClose();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  // Preview template — strip blank fields so the preview doesn't show empty labels.
  const previewTemplate = useMemo(() => ({
    name: name || (isEdit ? template.name : 'Untitled form'),
    category, description,
    fields: fields.filter((f) => (f.label || '').trim()).map((f) => ({ ...f, options: f.options || [] })),
  }), [name, category, description, fields, isEdit, template]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-stretch justify-center"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
      data-testid="template-builder">
      <div className="w-full h-full sm:h-[95vh] sm:my-4 sm:max-w-7xl bg-white sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-white flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">
                {isEdit ? 'Edit template' : 'New template'}
              </span>
              {template?.source === 'ai' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
                  <Sparkles size={9} /> AI draft
                </span>
              )}
              <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2.5 py-0.5 rounded-full ${CAT_PILL[category] || CAT_PILL.general}`}>
                {categoryLabel(category)}
              </span>
            </div>
            <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Form name"
                data-testid="builder-name"
                className={`flex-1 px-3 py-2 text-xl font-bold border rounded-xl ${errors.name ? 'border-rose-500 bg-rose-50' : 'border-slate-300 bg-white'}`} />
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                data-testid="builder-category"
                className="px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white font-medium">
                {CATEGORIES.filter((c) => c.key !== 'all').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description (shown on the card)"
              data-testid="builder-description"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white text-slate-700" />
            {errors.name && <p className="text-xs text-rose-600 inline-flex items-center gap-1"><AlertCircle size={11} /> {errors.name}</p>}
          </div>
          <button onClick={onClose} disabled={saving} data-testid="builder-close"
            className="p-2 rounded-xl hover:bg-slate-100 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-5 overflow-hidden">
          {/* Field list */}
          <div className="md:col-span-3 overflow-y-auto px-4 sm:px-6 py-4 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs uppercase tracking-[0.16em] font-semibold text-slate-500">Fields ({fields.length})</h3>
              <button onClick={addField} data-testid="builder-add-field"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
                <Plus size={12} /> Add Field
              </button>
            </div>
            {errors.fields?._global && (
              <p className="text-xs text-rose-600 inline-flex items-center gap-1"><AlertCircle size={11} /> {errors.fields._global}</p>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {fields.map((f, i) => (
                    <FieldEditor key={f.id} field={f} index={i}
                      onChange={(next) => updateField(i, next)}
                      onRemove={() => removeField(i)}
                      error={errors.fields[f.id]} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div className="pt-2">
              <button onClick={addField}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-600 hover:bg-white hover:border-slate-400">
                <Plus size={14} /> Add another field
              </button>
            </div>
          </div>

          {/* Live preview */}
          <div className="hidden md:block md:col-span-2 border-l border-slate-200 overflow-y-auto px-5 py-4 bg-white" data-testid="builder-preview">
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Live preview</div>
              <p className="text-xs text-slate-400 mt-0.5">How workers will see this form.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="space-y-1.5 mb-4">
                <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2.5 py-0.5 rounded-full ${CAT_PILL[category] || CAT_PILL.general}`}>
                  {categoryLabel(category)}
                </span>
                <h4 className="font-display text-lg font-bold text-slate-900 leading-tight">{previewTemplate.name}</h4>
                {previewTemplate.description && <p className="text-xs text-slate-500">{previewTemplate.description}</p>}
              </div>
              {previewTemplate.fields.length === 0 ? (
                <div className="text-xs text-slate-400 italic">Add fields to see the preview.</div>
              ) : (
                <div className="space-y-4">
                  {previewTemplate.fields.map((f) => (
                    <div key={f.id}>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {f.label}
                        {f.required && <span className="text-rose-600 ml-1">*</span>}
                      </label>
                      <FieldRunner field={f} value={null} onChange={() => {}} readOnly />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-white flex items-center gap-2">
          <span className="text-xs text-slate-500 hidden sm:inline">{isEdit ? 'Editing existing template' : 'Creating new template'}</span>
          <div className="flex-1" />
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2.5 min-h-[44px] rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={save} disabled={saving} data-testid="builder-save"
            className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-sm font-bold uppercase tracking-wide shadow-md hover:shadow-lg disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Template
          </button>
        </div>
      </div>
    </div>
  );
}
