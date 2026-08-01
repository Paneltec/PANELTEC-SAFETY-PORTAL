// v160.3.9.24 — Per-tab field schemas for RecordFormModal.
// Includes columns that are 100% empty in current XLSX imports so
// admins can populate them manually — they'll surface in the table on
// next fetch via each module's `/columns` metadata endpoint.

// Field names below match the backend `MasterRiskPatch` Pydantic model
// exactly (any other keys → 400 no-fields). The `/columns` metadata
// endpoint surfaces additional populated columns on the FE — those are
// read-only until the backend PATCH model widens.
export const MASTER_RISKS_SCHEMA = [
  { key: 'risk_id', label: 'Risk ID', type: 'text', required: true, placeholder: 'e.g. RSK-042' },
  { key: 'classification', label: 'Classification', type: 'text' },
  { key: 'activity', label: 'Activity', type: 'text' },
  { key: 'hazard_aspect', label: 'Hazard / aspect', type: 'text' },
  { key: 'unwanted_event', label: 'Unwanted event', type: 'textarea' },
  { key: 'risk_score_uncontrolled', label: 'Risk score (uncontrolled)', type: 'text' },
  { key: 'risk_score_controlled', label: 'Risk score (controlled)', type: 'text' },
  { key: 'mandatory_controls', label: 'Mandatory controls', type: 'textarea' },
  { key: 'other_controls', label: 'Other controls', type: 'textarea' },
  { key: 'legal_references', label: 'Legal references', type: 'text' },
  { key: 'swms_reference', label: 'SWMS reference', type: 'text' },
  { key: 'severity', label: 'Severity', type: 'text' },
  { key: 'fill_hex', label: 'Fill hex (uncontrolled)', type: 'text', placeholder: '#RRGGBB' },
  { key: 'fill_hex_controlled', label: 'Fill hex (controlled)', type: 'text', placeholder: '#RRGGBB' },
];

export const LIST_FORMS_SCHEMA = [
  { key: 'list_form_id', label: 'List form ID', type: 'text', required: true },
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'group', label: 'Group', type: 'text' },
  { key: 'active', label: 'Active', type: 'boolean' },
];

export const INCIDENT_ROOT_CAUSES_SCHEMA = [
  { key: 'question_id', label: 'Question ID', type: 'text', required: true },
  { key: 'question', label: 'Question', type: 'textarea', required: true },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'guidance', label: 'Guidance', type: 'textarea' },
];

export const CS_INCIDENT_SCHEMA = [
  { key: 'issue_number', label: 'Issue number', type: 'text', required: true },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'severity', label: 'Severity', type: 'enum', options: ['Low', 'Medium', 'High', 'Critical'] },
  { key: 'status', label: 'Status', type: 'enum', options: ['Open', 'In progress', 'Closed'] },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'assigned_to', label: 'Assigned to', type: 'text' },
  { key: 'due_date', label: 'Due date', type: 'date' },
  { key: 'resolution', label: 'Resolution', type: 'textarea' },
];

export const LIST_ROLES_SCHEMA = [
  { key: 'role_id', label: 'Role ID', type: 'text', required: true },
  { key: 'role_name', label: 'Role name', type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'reports_to', label: 'Reports to', type: 'text' },
  { key: 'active', label: 'Active', type: 'boolean' },
];

export const COMPLETED_TRAINING_SCHEMA = [
  { key: 'training_name', label: 'Training name', type: 'text', required: true },
  { key: 'worker_name', label: 'Worker name', type: 'text', required: true },
  { key: 'date_completed', label: 'Date completed', type: 'date' },
  { key: 'provider', label: 'Provider', type: 'text' },
  { key: 'certificate_number', label: 'Certificate number', type: 'text' },
  { key: 'expiry_date', label: 'Expiry date', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

export const COMPANIES_SCHEMA = [
  { key: 'company_id', label: 'Company ID', type: 'text', required: true },
  { key: 'company_name', label: 'Company name', type: 'text', required: true },
  { key: 'abn', label: 'ABN', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'status', label: 'Status', type: 'enum', options: ['Active', 'Inactive', 'Blocked'] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

export const TAB_CONFIGS = {
  master_risks:         { resource: '/master-risks',         keyField: 'risk_id',       schema: MASTER_RISKS_SCHEMA },
  list_forms:           { resource: '/list-forms',           keyField: 'list_form_id',  schema: LIST_FORMS_SCHEMA },
  incident_root_causes: { resource: '/incident-root-causes', keyField: 'question_id',   schema: INCIDENT_ROOT_CAUSES_SCHEMA },
  cs_incident:          { resource: '/cs-incident',          keyField: 'issue_number',  schema: CS_INCIDENT_SCHEMA },
  list_roles:           { resource: '/list-roles',           keyField: 'role_id',       schema: LIST_ROLES_SCHEMA },
  completed_training:   { resource: '/completed-training',   keyField: 'id',            schema: COMPLETED_TRAINING_SCHEMA },
  companies:            { resource: '/companies',            keyField: 'company_id',    schema: COMPANIES_SCHEMA },
};
