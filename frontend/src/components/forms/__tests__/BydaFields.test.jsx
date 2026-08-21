// v58.12.2 — jsdom evidence pass for the BYDA render arms.
// Covers every acceptance criterion the previous v58.12.1 session
// couldn't verify because Cloudflare 1010 blocked Playwright. Run:
//   CI=true yarn --cwd frontend test --watchAll=false src/components/forms/__tests__/BydaFields.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// api is the axios instance BydaFields uses. Mock it so we can assert
// what got POST'd without hitting the live backend.
jest.mock('../../../lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));
import api from '../../../lib/api';

import {
  ReferenceMatrixField,
  AttachmentField,
  ActionsField,
  attachmentPreflight,
  actionsFieldErrors,
} from '../BydaFields';

const matrixField = {
  id: 'byda_reference_matrix',
  label: 'Utility Awareness Reference Matrix',
  type: 'reference_matrix',
  config: {
    columns: [
      { key: 'asset', label: 'Asset' },
      { key: 'condition', label: 'Condition' },
      { key: 'requirement', label: 'Requirement' },
    ],
    sections: [
      { title: 'Gas', header_style: 'highlighted' },
      { title: 'Water', header_style: 'highlighted' },
      { title: 'General', header_style: 'plain' },
    ],
    rows: [
      { section: 'Gas',     asset: 'Gas main',   condition: 'live',  requirement: 'Isolate before work' },
      { section: 'Water',   asset: 'Water main', condition: 'live',  requirement: 'Confirm valve position' },
      { section: 'General', asset: 'Access pit', condition: 'open',  requirement: 'Barricade + signage' },
    ],
  },
};

const attachmentField = {
  id: 'byda_attachments',
  label: 'Supporting docs',
  type: 'attachment',
  config: {
    allowed_mimes: ['application/pdf', 'image/png', 'image/jpeg'],
    max_bytes: 1024 * 1024, // 1 MB — keeps test files tiny
    allow_multiple: true,
  },
};

const actionsField = {
  id: 'byda_actions',
  label: 'Follow-up actions',
  type: 'actions',
  config: {
    columns: [
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'actionee_id',  label: 'Actionee',    type: 'worker_directory' },
      { key: 'status',       label: 'Status',      type: 'select', options: ['Open', 'In Progress', 'Closed'] },
      { key: 'date_closed',  label: 'Date closed', type: 'date' },
    ],
  },
};

const makeFile = (name, type, sizeBytes) => {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  // Every test needs the worker-directory mock (ActionsField
  // fetches on mount).
  api.get.mockImplementation((path) => {
    if (path === '/workers/directory') {
      return Promise.resolve({ data: [
        { id: 'w-aaron', name: 'AARON FOSTER', simpro_employee_id: 'EMP001' },
        { id: 'w-bob',   name: 'BOB SMITH',    simpro_employee_id: 'EMP002' },
      ]});
    }
    return Promise.resolve({ data: [] });
  });
});

// ─────────────────────────── ReferenceMatrixField ───────────────────────────

describe('ReferenceMatrixField', () => {
  test('renders banded read-only table with highlighted Gas / Water sections', () => {
    render(<ReferenceMatrixField field={matrixField} />);
    // Root container has the expected testid
    expect(screen.getByTestId('ref-matrix-byda_reference_matrix')).toBeInTheDocument();
    // Section bands (testid built from title)
    expect(screen.getByTestId('ref-matrix-section-gas')).toHaveClass('bg-yellow-100');
    expect(screen.getByTestId('ref-matrix-section-water')).toHaveClass('bg-yellow-100');
    // Non-highlighted section keeps the plain style
    expect(screen.getByTestId('ref-matrix-section-general')).toHaveClass('bg-slate-100');
    // Data rows rendered
    expect(screen.getByText('Gas main')).toBeInTheDocument();
    expect(screen.getByText('Water main')).toBeInTheDocument();
    expect(screen.getByText('Barricade + signage')).toBeInTheDocument();
  });
});

// ────────────────────────── attachmentPreflight (pure) ──────────────────────

describe('attachmentPreflight', () => {
  const cfg = { allowed_mimes: ['application/pdf'], max_bytes: 1024 };

  test('passes a valid file', () => {
    expect(attachmentPreflight(makeFile('a.pdf', 'application/pdf', 100), cfg)).toEqual({ ok: true });
  });
  test('rejects wrong MIME', () => {
    const r = attachmentPreflight(makeFile('a.exe', 'application/x-msdownload', 100), cfg);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unsupported file type/);
  });
  test('rejects oversize', () => {
    const r = attachmentPreflight(makeFile('big.pdf', 'application/pdf', 2048), cfg);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large/i);
  });
  test('empty allowed_mimes list accepts anything under size cap', () => {
    expect(attachmentPreflight(makeFile('anything.bin', 'x/y', 50), { max_bytes: 1024 })).toEqual({ ok: true });
  });
});

// ─────────────────────────── AttachmentField ────────────────────────────────

describe('AttachmentField — disabled dropzone (submissionId null)', () => {
  test('shows "Save the form first" hint and does NOT POST on file drop', async () => {
    render(<AttachmentField field={attachmentField} value={[]} submissionId={null} />);
    // Hint testid rendered inside the disabled dropzone
    expect(screen.getByTestId('attachment-dropzone-hint-byda_attachments')).toBeInTheDocument();
    // data-canupload attribute reflects the disabled state
    expect(screen.getByTestId('attachment-dropzone-byda_attachments')).toHaveAttribute('data-canupload', '0');
    // Try firing a drop event — should be a no-op
    const good = makeFile('site-plan.pdf', 'application/pdf', 100);
    fireEvent.drop(screen.getByTestId('attachment-dropzone-byda_attachments'), {
      dataTransfer: { files: [good] },
    });
    // Give any (accidentally scheduled) microtask time to fire
    await new Promise((r) => setTimeout(r, 5));
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('AttachmentField — client MIME rejection', () => {
  test('rejects .exe pre-flight, no network POST', async () => {
    render(<AttachmentField field={attachmentField} value={[]} submissionId="sub-1" />);
    const bad = makeFile('malware.exe', 'application/x-msdownload', 100);
    const input = screen.getByTestId('attachment-input-byda_attachments');
    await act(async () => {
      // fireEvent.change on hidden file input
      Object.defineProperty(input, 'files', { value: [bad], writable: false });
      fireEvent.change(input);
    });
    // A pending row exists (with tempKey testid — we can find via the error message)
    expect(await screen.findByText(/Unsupported file type/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('AttachmentField — client size rejection', () => {
  test('rejects >max_bytes pre-flight, no network POST', async () => {
    render(<AttachmentField field={attachmentField} value={[]} submissionId="sub-1" />);
    const bloated = makeFile('big.pdf', 'application/pdf', 2 * 1024 * 1024); // 2 MB > 1 MB cap
    const input = screen.getByTestId('attachment-input-byda_attachments');
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [bloated], writable: false });
      fireEvent.change(input);
    });
    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('AttachmentField — successful upload', () => {
  test('uploads a valid file, transitions pending → server-row', async () => {
    api.post.mockResolvedValue({ data: { attachments: [{
      file_id: 'stored-uuid-1',
      stored_name: 'stored-uuid-1',
      name: 'site-plan',
      description: '',
      mime: 'application/pdf',
      size: 100,
      url: '/api/forms/submissions/sub-1/attachments/stored-uuid-1',
      deleted_at: null,
    }]}});
    render(<AttachmentField field={attachmentField} value={[]} submissionId="sub-1" />);
    const good = makeFile('site-plan.pdf', 'application/pdf', 100);
    const input = screen.getByTestId('attachment-input-byda_attachments');
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [good], writable: false });
      fireEvent.change(input);
    });
    // Server responded — final row uses the stored_name as testid.
    await waitFor(() => {
      expect(screen.getByTestId('attachment-row-stored-uuid-1')).toBeInTheDocument();
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, formData] = api.post.mock.calls[0];
    expect(url).toBe('/forms/submissions/sub-1/attachments');
    // FormData is multipart — we can inspect the entries via .get()
    expect(formData.get('field_id')).toBe('byda_attachments');
    expect(formData.get('files')).toBe(good);
    expect(formData.get('names')).toBe('site-plan');
    // Download button rendered on the server row
    expect(screen.getByTestId('attachment-download-stored-uuid-1')).toBeInTheDocument();
  });
});

describe('AttachmentField — server error surfaces Retry', () => {
  test('shows error + Retry button on 413', async () => {
    api.post.mockRejectedValue({ response: { status: 413, data: { detail: 'File exceeds max' }}});
    render(<AttachmentField field={attachmentField} value={[]} submissionId="sub-1" />);
    const good = makeFile('doc.pdf', 'application/pdf', 100);
    const input = screen.getByTestId('attachment-input-byda_attachments');
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [good], writable: false });
      fireEvent.change(input);
    });
    await waitFor(() => expect(screen.getByText('File exceeds max')).toBeInTheDocument());
    // Retry button present — testid contains the tempKey but we can grep by prefix
    const retryBtns = screen.getAllByText(/Retry/i);
    expect(retryBtns.length).toBeGreaterThan(0);
  });
});

describe('AttachmentField — read-only server rows', () => {
  test('renders download + disabled-Remove tooltip for uploaded attachments', () => {
    const uploaded = [{
      file_id: 'f1', stored_name: 'f1', name: 'plan', description: 'north',
      mime: 'application/pdf', size: 100,
      url: '/api/forms/submissions/sub-1/attachments/f1',
      deleted_at: null,
    }];
    render(<AttachmentField field={attachmentField} value={uploaded} submissionId="sub-1" readOnly />);
    // No dropzone in readOnly mode
    expect(screen.queryByTestId('attachment-dropzone-byda_attachments')).toBeNull();
    expect(screen.getByTestId('attachment-download-f1')).toBeInTheDocument();
    // Disabled remove button with the v58.12.3 tooltip
    const removeBtn = screen.getByTestId('attachment-row-remove-f1');
    expect(removeBtn).toBeDisabled();
    expect(removeBtn).toHaveAttribute('title', 'Delete lands in v58.12.3');
  });
});

// ────────────────────────── actionsFieldErrors (pure) ───────────────────────

describe('actionsFieldErrors', () => {
  test('flags every Closed row without date_closed', () => {
    const value = [
      { description: 'a', status: 'Open',   date_closed: '' },
      { description: 'b', status: 'Closed', date_closed: '' },
      { description: 'c', status: 'Closed', date_closed: '2026-01-01' },
      { description: 'd', status: 'Closed', date_closed: null },
    ];
    expect(actionsFieldErrors(actionsField, value)).toEqual([
      { rowIndex: 1 },
      { rowIndex: 3 },
    ]);
  });
  test('non-actions field type returns []', () => {
    expect(actionsFieldErrors({ type: 'text' }, [])).toEqual([]);
  });
  test('non-array value returns []', () => {
    expect(actionsFieldErrors(actionsField, null)).toEqual([]);
  });
});

// ─────────────────────────── ActionsField ───────────────────────────────────

describe('ActionsField — off-roster toggle strips _off_roster from payload', () => {
  test('setting off-roster does NOT put _off_roster into the row emitted via onChange', async () => {
    const rows = [{ status: 'Open' }];
    let latest = rows;
    const onChange = jest.fn((next) => { latest = next; });
    render(<ActionsField field={actionsField} value={rows} onChange={onChange} />);
    // Wait for the worker-directory fetch to resolve so the select renders.
    await waitFor(() => expect(screen.getByTestId(`actions-input-byda_actions-0-actionee_id`)).toBeInTheDocument());
    // Pick the sentinel __off__ option
    const select = screen.getByTestId(`actions-input-byda_actions-0-actionee_id`);
    await act(async () => {
      fireEvent.change(select, { target: { value: '__off__' } });
    });
    // onChange emitted a row with actionee_id/name cleared but WITHOUT _off_roster
    expect(onChange).toHaveBeenCalled();
    const emitted = latest[0];
    expect(emitted).toHaveProperty('actionee_id', '');
    expect(emitted).toHaveProperty('actionee_name', '');
    expect(Object.keys(emitted)).not.toContain('_off_roster');
  });
});

describe('ActionsField — off-roster picks emit only actionee_name', () => {
  test('typing a name in off-roster mode sets actionee_name only', async () => {
    const rows = [{ status: 'Open' }];
    let latest = rows;
    const onChange = jest.fn((next) => { latest = next; });
    const { rerender } = render(<ActionsField field={actionsField} value={rows} onChange={onChange} />);
    await waitFor(() => expect(screen.getByTestId(`actions-input-byda_actions-0-actionee_id`)).toBeInTheDocument());
    await act(async () => {
      fireEvent.change(screen.getByTestId(`actions-input-byda_actions-0-actionee_id`), { target: { value: '__off__' } });
    });
    // parent re-renders with the emitted row
    rerender(<ActionsField field={actionsField} value={latest} onChange={onChange} />);
    // Free-text input now visible
    const txt = await screen.findByTestId('actions-input-byda_actions-0-actionee_id-freetext');
    await act(async () => {
      fireEvent.change(txt, { target: { value: 'Bob Smith' } });
    });
    expect(latest[0].actionee_name).toBe('Bob Smith');
    expect(latest[0].actionee_id).toBe('');
    expect(Object.keys(latest[0])).not.toContain('_off_roster');
  });
});

describe('ActionsField — Closed-requires-date_closed error surface', () => {
  test('renders actions-row-error-{i} span for offending rows', async () => {
    const rows = [
      { description: 'ok row',     status: 'Open',   date_closed: '' },
      { description: 'closed bad', status: 'Closed', date_closed: '' },
    ];
    render(<ActionsField field={actionsField} value={rows} onChange={() => {}} />);
    // Row 0 is fine — no error span
    expect(screen.queryByTestId('actions-row-error-0')).toBeNull();
    // Row 1 has status=Closed but no date — error span present
    expect(screen.getByTestId('actions-row-error-1')).toBeInTheDocument();
    expect(screen.getByTestId('actions-row-error-1').textContent).toMatch(/Status = Closed requires/i);
  });
});

describe('ActionsField — readOnly renders resolved actionee_name', () => {
  test('read-only cell shows the resolved name for the actionee_id column', () => {
    const rows = [{
      id: 'row-1',
      description: 'weld inspection',
      actionee_id: 'w-aaron',
      actionee_name: 'AARON FOSTER',
      status: 'Open',
      date_closed: '',
    }];
    render(<ActionsField field={actionsField} value={rows} readOnly />);
    // No input dispatched — the row cell is a plain <td> with the resolved name
    expect(screen.getByText('AARON FOSTER')).toBeInTheDocument();
    // Add-row button hidden
    expect(screen.queryByTestId('actions-add-row')).toBeNull();
  });
});
