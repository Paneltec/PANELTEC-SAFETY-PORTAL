/* v58.13.130a — Shared Technician Picker.
 *
 * Extracted from ServiceCheckSheetModal (.123a) so the Quick Log
 * Service popup (RecordEditor in AssetServiceTabs) uses the same
 * searchable-autocomplete behaviour instead of a plain <select>.
 *
 * Behaviour:
 *   · `mode = 'picker'`   — <input list="…"> + <datalist> autocomplete.
 *                            User types to filter; picking an option
 *                            resolves `name` back to the matching
 *                            `technician.id`. Free-typed strings that
 *                            don't match keep `id = ''`.
 *   · `mode = 'freetext'` — plain <input> for contractors / one-offs
 *                            (or when the technicians list is empty).
 *   · Toggle between the two via the "Type new" / "Pick from list"
 *     inline button.
 *   · Auto-starts in `freetext` when `technicians.length === 0`.
 *
 * Testid convention: caller supplies `testidPrefix` and this component
 * emits `<prefix>-select` (the autocomplete input),
 * `<prefix>-freetext` (the freetext input),
 * `<prefix>-freetext-toggle` (Type new), `<prefix>-back-to-picker`
 * (Pick from list). Kept compatible with the .123a ServiceCheckSheet
 * testids (`sheet-technician-select` / `sheet-technician-freetext` /
 * `sheet-technician-freetext-toggle`) so the .123a Playwright checks
 * keep passing when ServiceCheckSheetModal switches to this component.
 */
import React, { useEffect, useRef, useState } from 'react';

export function TechnicianPicker({
  technicians,
  value,
  onChange,
  disabled = false,
  testidPrefix,
  placeholder = 'Search technicians (name)',
  freetextPlaceholder = 'Contractor or unlisted technician',
}) {
  const list = Array.isArray(technicians) ? technicians : [];
  const [mode, setMode] = useState('picker');
  const datalistId = useRef(`tech-datalist-${Math.random().toString(36).slice(2, 8)}`).current;

  // Enter freetext automatically when the list is empty. Do it in an
  // effect so a late-arriving list can flip back to `picker`, and so
  // an explicit user toggle isn't overridden by a re-render.
  const [userForced, setUserForced] = useState(false);
  useEffect(() => {
    if (userForced) return;
    if (list.length === 0 && mode !== 'freetext') setMode('freetext');
    if (list.length > 0 && mode === 'freetext' && !value?.id && !value?.name) {
      setMode('picker');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  // v58.13.130a — Legacy-value fallback. Non-empty name that doesn't
  // match any row should render in freetext so the string isn't lost
  // when the user opens the editor for an existing record.
  useEffect(() => {
    if (userForced) return;
    if (
      list.length > 0
      && value?.name
      && !value?.id
      && !list.some((t) => (t.name || '').toLowerCase() === (value.name || '').toLowerCase())
    ) {
      setMode('freetext');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  const setPickerMode = () => { setUserForced(true); setMode('picker'); };
  const setFreetextMode = () => { setUserForced(true); setMode('freetext'); };

  const onPickerChange = (e) => {
    const v = e.target.value;
    const hit = list.find(
      (t) => (t.name || '').toLowerCase() === v.toLowerCase(),
    );
    onChange({ id: hit?.id || '', name: v });
  };
  const onFreetextChange = (e) => {
    onChange({ id: '', name: e.target.value });
  };

  if (mode === 'picker' && list.length > 0) {
    return (
      <div className="flex items-center gap-2" data-testid={`${testidPrefix}-picker-wrap`}>
        <input
          list={datalistId}
          value={value?.name || ''}
          onChange={onPickerChange}
          placeholder={placeholder}
          disabled={disabled}
          data-testid={`${testidPrefix}-select`}
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400"
        />
        <datalist id={datalistId}>
          {list.map((t) => (
            <option
              key={t.id}
              value={t.name}
              data-testid={`${testidPrefix}-opt-${t.id}`}
            >
              {t.simpro_employee_id
                ? `#${t.simpro_employee_id} · ${t.position || t.role || ''}`
                : (t.position || t.role || '')}
            </option>
          ))}
        </datalist>
        <button
          type="button"
          onClick={setFreetextMode}
          disabled={disabled}
          data-testid={`${testidPrefix}-freetext-toggle`}
          className="px-2 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50 whitespace-nowrap"
        >
          Type new
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        value={value?.name || ''}
        onChange={onFreetextChange}
        placeholder={freetextPlaceholder}
        disabled={disabled}
        data-testid={`${testidPrefix}-freetext`}
        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
      />
      {list.length > 0 && (
        <button
          type="button"
          onClick={setPickerMode}
          disabled={disabled}
          data-testid={`${testidPrefix}-back-to-picker`}
          className="text-[11px] text-slate-500 hover:text-slate-900 underline whitespace-nowrap"
        >
          Pick from list
        </button>
      )}
    </div>
  );
}

export default TechnicianPicker;
