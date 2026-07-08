"""Pydantic models — all IDs are uuid strings (JSON-serialisable).

Mongo documents are stored as plain dicts; we never use ObjectId.
Timestamps are stored as ISO-8601 strings in UTC.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field
import uuid

Role = Literal["worker", "supervisor", "hseq_lead", "auditor", "manager", "admin"]
SwmsStatus = Literal["draft", "submitted", "approved", "rejected", "changes_requested"]
HazardStatus = Literal["open", "in_progress", "closed"]
HazardSeverity = Literal["low", "medium", "high", "critical"]
IncidentCategory = Literal["near_miss", "first_aid", "medical", "ltc", "env", "property"]
IncidentStatus = Literal["open", "in_progress", "closed"]
ChecklistResponse = Literal["pass", "fail", "na"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)
    org_name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    # Phase 3.16 — opt-in 30-day idle override on this device. Backend
    # honours only when org_settings.remember_me_enabled is true.
    remember_me: Optional[bool] = False


class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    role: Role
    org_id: str
    workspace_ids: List[str] = Field(default_factory=list)
    created_at: str


# ---------- AI request/response ----------

class SwmsDraftIn(BaseModel):
    job_description: str = Field(min_length=10)
    location: Optional[str] = None


class DiaryStructureIn(BaseModel):
    raw_notes: str = Field(min_length=5)


# ---------- Capture entities (create/update payloads) ----------

class SwmsIn(BaseModel):
    title: str
    job_description: str = ""
    workspace_id: str
    location: Optional[str] = None
    tasks: List[dict] = Field(default_factory=list)
    hazards: List[dict] = Field(default_factory=list)
    controls: List[dict] = Field(default_factory=list)
    ppe: List[str] = Field(default_factory=list)
    status: SwmsStatus = "draft"

    # Phase 4.x — rich SWMS schema (all optional so the legacy AI-draft
    # path keeps working untouched).
    code: Optional[str] = None
    version: Optional[str] = None
    slug: Optional[str] = None
    scope: Optional[str] = None
    high_risk_construction_work: Optional[str] = None
    prepared_by: Optional[dict] = None
    approved_by: Optional[dict] = None
    review_date: Optional[str] = None
    activity_analysis: List[dict] = Field(default_factory=list)
    environmental_risks: List[dict] = Field(default_factory=list)
    training_requirements: List[str] = Field(default_factory=list)
    equipment_list: List[str] = Field(default_factory=list)
    emergency_procedures: Optional[dict] = None
    legislation_and_codes: List[str] = Field(default_factory=list)
    attendance_sheet_template: bool = True
    source_file: Optional[dict] = None
    applies_to: Optional[dict] = None      # {asset_kinds, asset_types, worker_ids, roles, companies}
    superseded_by: Optional[str] = None
    supersedes: Optional[str] = None


class SwmsReview(BaseModel):
    action: Literal["approve", "reject", "request_changes"]
    note: Optional[str] = None


class PreStartSignOn(BaseModel):
    name: str
    role: Optional[str] = None
    signature_ts: Optional[str] = None


class PreStartIn(BaseModel):
    workspace_id: str
    date: str  # YYYY-MM-DD
    crew_lead: str
    work_summary: str
    linked_swms_ids: List[str] = Field(default_factory=list)
    linked_permits: List[str] = Field(default_factory=list)
    hazards_discussed: str = ""
    sign_ons: List[PreStartSignOn] = Field(default_factory=list)
    notes: Optional[str] = None
    # v160.0.10.2
    crew_worker_ids: List[str] = Field(default_factory=list)
    gps_latitude: Optional[float] = None
    gps_longitude: Optional[float] = None
    gps_accuracy: Optional[float] = None
    gps_street: Optional[str] = None
    gps_suburb: Optional[str] = None


class SiteDiaryIn(BaseModel):
    workspace_id: str
    date: str
    raw_notes: str
    structured_log: Optional[dict] = None


class HazardIn(BaseModel):
    workspace_id: str
    title: str
    description: str = ""
    photo_url: Optional[str] = None
    location: Optional[str] = None
    severity: HazardSeverity = "medium"
    controls: List[str] = Field(default_factory=list)
    status: HazardStatus = "open"
    ai_analysis: Optional[dict] = None
    # v160.0.10.1 — new fields (all optional to preserve migration safety)
    reported_by: Optional[str] = None
    gps_latitude: Optional[float] = None
    gps_longitude: Optional[float] = None
    gps_accuracy: Optional[float] = None
    gps_street: Optional[str] = None
    gps_suburb: Optional[str] = None


class IncidentIn(BaseModel):
    workspace_id: str
    title: str
    occurred_at: str  # ISO
    location: Optional[str] = None
    category: IncidentCategory = "near_miss"
    description: str = ""
    immediate_actions: str = ""
    evidence_photos: List[str] = Field(default_factory=list)
    follow_up_actions: List[dict] = Field(default_factory=list)
    follow_up_status: IncidentStatus = "open"
    # v160.0.10.1
    person_involved: Optional[str] = None
    gps_latitude: Optional[float] = None
    gps_longitude: Optional[float] = None
    gps_accuracy: Optional[float] = None
    gps_street: Optional[str] = None
    gps_suburb: Optional[str] = None


class InspectionChecklistItem(BaseModel):
    label: str
    response: ChecklistResponse = "pass"
    notes: Optional[str] = None
    photo_url: Optional[str] = None


class InspectionIn(BaseModel):
    workspace_id: str
    template_name: str
    date: str
    checklist_items: List[InspectionChecklistItem] = Field(default_factory=list)
    corrective_actions: List[dict] = Field(default_factory=list)
    notes: Optional[str] = None
    # v160.0.10.1
    operator: Optional[str] = None
    operator_signature: Optional[str] = None  # base64 PNG data URL
    gps_latitude: Optional[float] = None
    gps_longitude: Optional[float] = None
    gps_accuracy: Optional[float] = None
    gps_street: Optional[str] = None
    gps_suburb: Optional[str] = None


# ---------- Dashboard ----------

class DashboardMetrics(BaseModel):
    swms_count: int
    prestarts_count: int
    diary_count: int
    hazards_count: int
    incidents_count: int
    inspections_count: int
    attention_score: int
    attention_band: Literal["Strong", "Watch", "Action needed", "hidden"]
    records_needing_attention: int
    registers_connected: int = 26
    monitoring_scope: str = "Organisation wide"
    workspaces_scope: str = "All allowed workspaces"
    # v157.1 — Per-metric growth deltas computed against the count of docs
    # that existed at the START of the current calendar quarter. A value of
    # `None` (null on the wire) means the previous period had zero docs and
    # a percentage delta would be undefined — the frontend hides the row.
    # `delta_label` is a single string ("vs last quarter" or similar).
    deltas: Optional[dict] = None
    delta_label: Optional[str] = None


def doc_with_id(payload: dict, **extra: Any) -> dict:
    """Build a Mongo doc using uuid string ids + iso timestamps."""
    out = {"id": new_id(), "created_at": now_iso(), "updated_at": now_iso(), **payload, **extra}
    out["deleted_at"] = None
    return out
