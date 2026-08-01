// v160.3.9.25 — Per-tab field schemas for RecordFormModal.
//
// Each schema is reconciled to its backend router's Pydantic PATCH /
// POST model (or, for `extra="allow"` routers, to fields that
// actually exist in the live collection). Any key sent that is not in
// the router's Patch model — for strictly-typed models — will be
// silently dropped by Pydantic, which surfaces as a 400 "no-fields"
// on an otherwise valid save.
//
// The `/columns` metadata endpoint on sparse-schema modules
// (cs_incident, completed_training, companies) surfaces additional
// populated columns in the table; those extra columns remain read-
// only in the modal until we widen the schema below.
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

// list_forms.py::ListFormPatch → name, description, form_group (list[str]),
// public_enabled, mobile_enabled, asset_enabled. Create requires list_form_id.
export const LIST_FORMS_SCHEMA = [
  { key: 'list_form_id', label: 'List form ID', type: 'text', required: true, placeholder: 'e.g. 42' },
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'form_group', label: 'Form group', type: 'chips_multi', options: ['Operations', 'Administration'] },
  { key: 'public_enabled', label: 'Public enabled', type: 'boolean' },
  { key: 'mobile_enabled', label: 'Mobile enabled', type: 'boolean' },
  { key: 'asset_enabled',  label: 'Asset enabled',  type: 'boolean' },
];

// incident_root_causes.py::IRCPatch → description, contributing_factor,
// parent_question_id, has_action. Create requires question_id.
export const INCIDENT_ROOT_CAUSES_SCHEMA = [
  { key: 'question_id', label: 'Question ID', type: 'text', required: true, placeholder: 'e.g. 1.02' },
  { key: 'description', label: 'Description', type: 'textarea', required: true },
  { key: 'contributing_factor', label: 'Contributing factor', type: 'text' },
  { key: 'parent_question_id', label: 'Parent question ID', type: 'text' },
  { key: 'has_action', label: 'Has action', type: 'boolean' },
];

// cs_incident.py::RowPatch is `extra="allow"` — the field set below is
// the practical core (issue metadata + the most-populated text/date
// columns). Any other populated column stays visible in the table via
// /cs-incident/columns but is not editable from this form until added
// here. Create requires issue_number.
export const CS_INCIDENT_SCHEMA = [
  { key: 'issue_number', label: 'Issue number', type: 'text', required: true },
  { key: 'issue_type', label: 'Issue type', type: 'text' },
  { key: 'date_of_issue', label: 'Date of issue', type: 'date' },
  { key: 'business_unit', label: 'Business unit', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'identified_by', label: 'Identified by', type: 'text' },
  { key: 'responsible_manager', label: 'Responsible manager', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'hazard_description', label: 'Hazard description', type: 'textarea' },
  { key: 'injury_severity', label: 'Injury severity', type: 'text' },
  { key: 'actual_incident_category', label: 'Actual severity', type: 'text' },
  { key: 'potential_incident_category', label: 'Potential severity', type: 'text' },
];

// list_roles.py::RolePatch → role_title, description, capabilities_count
// (int), people_count (int), capabilities (list[str]), people (list[str]).
// Create requires role_id.
export const LIST_ROLES_SCHEMA = [
  { key: 'role_id', label: 'Role ID', type: 'text', required: true },
  { key: 'role_title', label: 'Role title', type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'capabilities_count', label: 'Capabilities count', type: 'number' },
  { key: 'people_count', label: 'People count', type: 'number' },
  { key: 'capabilities', label: 'Capabilities', type: 'array_of_strings', placeholder: 'comma-separated capability names' },
  { key: 'people', label: 'People', type: 'array_of_strings', placeholder: 'comma-separated person names' },
];

// completed_training.py::RowPatch is `extra="allow"`. Row key is a
// content_hash synthesized from payload on POST — so `competency` is
// treated as the practical required field (empty payload → 400
// "payload-required"). List of columns matches the tab's LABEL /
// COLUMN_ORDER (v160.3.9.18).
export const COMPLETED_TRAINING_SCHEMA = [
  { key: 'competency', label: 'Competency', type: 'text', required: true },
  { key: 'issue_date', label: 'Issue date', type: 'date' },
  { key: 'expiry_date', label: 'Expiry date', type: 'date' },
  { key: 'business_unit', label: 'Business unit', type: 'text' },
  { key: 'issuer', label: 'Issuer', type: 'text' },
  { key: 'created_by', label: 'Created by', type: 'text' },
  { key: 'licence_number', label: 'Licence #', type: 'text' },
  { key: 'card_number', label: 'Card #', type: 'text' },
  { key: 'certificate_number', label: 'Certificate #', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'description', label: 'Description', type: 'textarea' },
];

// companies.py::RowPatch is `extra="allow"`. Fields below match the
// columns the tab actually renders (v160.3.9.19). Create requires
// company_id.
export const COMPANIES_SCHEMA = [
  { key: 'company_id', label: 'Company ID', type: 'text', required: true },
  { key: 'company', label: 'Company name', type: 'text', required: true },
  { key: 'company_category', label: 'Category', type: 'text' },
  { key: 'company_classification', label: 'Classification', type: 'text' },
  { key: 'account_type', label: 'Account type', type: 'text' },
  { key: 'general_email', label: 'Email', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'suburb', label: 'Suburb', type: 'text' },
  { key: 'state', label: 'State', type: 'text' },
  { key: 'archived', label: 'Archived', type: 'boolean' },
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
