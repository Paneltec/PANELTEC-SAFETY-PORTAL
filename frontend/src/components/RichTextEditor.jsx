// v58.13.19 — Rich-text editor for schedule `description_html`.
//
// Homegrown `contentEditable` + `document.execCommand` toolbar. Zero
// external deps. Deliberately matches the backend bleach allowlist in
// `asset_service.py:_HTML_ALLOWED_TAGS` (v58.13.0-a) exactly:
//
//   p, br, b, strong, i, em, u, ul, ol, li, a, h1-h4  (+ href/title/rel)
//
// so every button here maps 1:1 to an allowed tag. Any HTML the user
// pastes that isn't in that allowlist is stripped server-side on write,
// so we don't need to sanitise pre-save — bleach is the source of
// truth. We DO best-effort normalise pasted HTML to remove obviously
// unwanted tags (script/style/style-attrs) so the visible editor
// doesn't render junk between paste and save.
//
// `execCommand` is deprecated but universally supported and produces
// standard HTML that a future Tiptap migration can consume unchanged.
//
// Props: { value, onChange, placeholder, testid, onInsertChecklist }
//   value             — HTML string
//   onChange(html)    — fired on every input event
//   placeholder       — greyed-out hint when the editor is empty
//   testid            — data-testid prefix
//   onInsertChecklist — () => void (parent opens the picker)
import React, { useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Underline, List, ListOrdered, Heading3, Link as LinkIcon,
  ClipboardList,
} from 'lucide-react';

// Tags we KEEP when pasting; everything else is stripped inline.
const KEEP_TAGS = new Set([
  'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U',
  'UL', 'OL', 'LI', 'A', 'H1', 'H2', 'H3', 'H4',
]);

function scrubPastedHtml(html) {
  // Best-effort: parse via DOMParser and walk-strip anything not in
  // KEEP_TAGS. Preserves inner text of stripped nodes (so pasting a
  // <div> full of text keeps the text). Bleach on the backend is the
  // authoritative pass.
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walk = (node) => {
      const children = Array.from(node.childNodes);
      for (const c of children) {
        if (c.nodeType === 1) { // element
          walk(c);
          if (!KEEP_TAGS.has(c.nodeName)) {
            // Unwrap: move children up, remove the node.
            while (c.firstChild) node.insertBefore(c.firstChild, c);
            node.removeChild(c);
          } else {
            // Strip all attributes except href/title/rel on <a>.
            const keepAttrs = c.nodeName === 'A'
              ? new Set(['href', 'title', 'rel'])
              : new Set();
            Array.from(c.attributes).forEach((a) => {
              if (!keepAttrs.has(a.name.toLowerCase())) c.removeAttribute(a.name);
            });
          }
        }
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  } catch {
    // Parser failed → fall back to naive tag strip.
    return html.replace(/<(?!\/?(?:p|br|b|strong|i|em|u|ul|ol|li|a|h[1-4])\b)[^>]+>/gi, '');
  }
}

export default function RichTextEditor({
  value, onChange, placeholder, testid = 'rte',
  onInsertChecklist,
}) {
  const ref = useRef(null);
  const [empty, setEmpty] = useState(!value);

  // Sync incoming `value` prop into the DOM only when it differs from
  // the current DOM innerHTML — avoids cursor-reset on every parent
  // re-render (React re-renders us on state change; if we blindly wrote
  // innerHTML each time, the caret would jump to position 0 on every
  // keystroke).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if ((value || '') !== el.innerHTML) {
      el.innerHTML = value || '';
    }
    setEmpty(!el.textContent);
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML;
    setEmpty(!el.textContent);
    onChange(html);
  };

  const cmd = (name, arg = null) => {
    // Focus the editor so execCommand acts on the correct selection.
    ref.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  };

  const insertLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (!url) return;
    cmd('createLink', url);
    // Add rel="noopener" defensively — bleach allowlist permits rel.
    const el = ref.current;
    if (el) {
      el.querySelectorAll('a').forEach((a) => {
        if (!a.getAttribute('rel')) a.setAttribute('rel', 'noopener');
      });
      emit();
    }
  };

  const onPaste = (e) => {
    // Grab any HTML the clipboard offers; if only plain text is
    // available, fall back to that (execCommand does the right thing
    // for plain text).
    const html = e.clipboardData?.getData('text/html');
    if (!html) return; // let default plain-text paste happen
    e.preventDefault();
    const cleaned = scrubPastedHtml(html);
    document.execCommand('insertHTML', false, cleaned);
    emit();
  };

  const btnBase = 'inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 active:bg-slate-100 transition-colors';

  return (
    <div className="rounded-lg border border-slate-300 bg-white overflow-hidden"
      data-testid={testid}>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 bg-slate-50">
        <button type="button" className={btnBase} title="Bold (Ctrl+B)"
          onClick={() => cmd('bold')} data-testid={`${testid}-bold`}>
          <Bold size={13} />
        </button>
        <button type="button" className={btnBase} title="Italic (Ctrl+I)"
          onClick={() => cmd('italic')} data-testid={`${testid}-italic`}>
          <Italic size={13} />
        </button>
        <button type="button" className={btnBase} title="Underline (Ctrl+U)"
          onClick={() => cmd('underline')} data-testid={`${testid}-underline`}>
          <Underline size={13} />
        </button>
        <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden />
        <button type="button" className={btnBase} title="Bullet list"
          onClick={() => cmd('insertUnorderedList')} data-testid={`${testid}-ul`}>
          <List size={13} />
        </button>
        <button type="button" className={btnBase} title="Numbered list"
          onClick={() => cmd('insertOrderedList')} data-testid={`${testid}-ol`}>
          <ListOrdered size={13} />
        </button>
        <button type="button" className={btnBase} title="Heading"
          onClick={() => cmd('formatBlock', '<h3>')} data-testid={`${testid}-h3`}>
          <Heading3 size={13} />
        </button>
        <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden />
        <button type="button" className={btnBase} title="Insert link"
          onClick={insertLink} data-testid={`${testid}-link`}>
          <LinkIcon size={13} />
        </button>
        <button type="button" className={btnBase + ' !text-blue-600'}
          title="Insert link to a form checklist"
          onClick={(e) => { e.stopPropagation(); onInsertChecklist?.(); }}
          data-testid={`${testid}-checklist`}>
          <ClipboardList size={13} />
        </button>
      </div>
      <div className="relative">
        {empty && placeholder && (
          <div className="pointer-events-none absolute top-2 left-3 text-sm text-slate-400 select-none"
            data-testid={`${testid}-placeholder`}>
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onPaste={onPaste}
          className="prose prose-sm max-w-none px-3 py-2 min-h-[96px] text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-inset"
          data-testid={`${testid}-content`}
          role="textbox"
          aria-multiline="true"
        />
      </div>
    </div>
  );
}
