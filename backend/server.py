from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Any, Dict
import uuid
import secrets
import base64
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'change-me')
JWT_ALG = 'HS256'
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI(title="Paneltec Safety Portal API")
api_router = APIRouter(prefix="/api")

# ============== UTILS ==============
def now_iso():
    return datetime.now(timezone.utc).isoformat()

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def make_token(user_id: str, role: str) -> str:
    payload = {
        'sub': user_id,
        'role': role,
        'exp': datetime.now(timezone.utc) + timedelta(days=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Missing token')
    token = authorization.split(' ', 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(401, 'Invalid token')
    user = await db.users.find_one({'id': payload['sub']}, {'_id': 0, 'password': 0})
    if not user:
        raise HTTPException(401, 'User not found')
    return user

async def require_admin(user=Depends(get_current_user)):
    if user.get('role') != 'admin':
        raise HTTPException(403, 'Admin only')
    return user

# ============== MODELS ==============
class LoginIn(BaseModel):
    email: str
    password: str

class RegisterIn(BaseModel):
    email: str
    password: str
    name: str
    role: str = 'worker'

class Worker(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str = 'worker'  # worker, supervisor, admin
    trade: Optional[str] = None  # civil contractor trades
    location_ids: List[str] = []
    signature_b64: Optional[str] = None
    photo_b64: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

class Certification(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    worker_id: str
    name: str
    issuer: Optional[str] = None
    issued_date: Optional[str] = None
    expiry_date: Optional[str] = None
    image_b64: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

class Location(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    address: Optional[str] = None
    project_code: Optional[str] = None
    worker_ids: List[str] = []
    created_at: str = Field(default_factory=now_iso)

class FormField(BaseModel):
    id: str
    label: str
    type: str  # text, textarea, number, date, select, checkbox, radio, signature, photo, gps, repeatable
    required: bool = False
    options: List[str] = []  # for select/radio
    placeholder: Optional[str] = None
    is_critical: bool = False  # flag this form as critical (incident/near-miss)

class FormTemplate(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    category: str = 'general'  # general, incident, inspection, toolbox, near_miss
    is_private: bool = False
    fields: List[Dict[str, Any]] = []
    created_at: str = Field(default_factory=now_iso)

class FormSubmission(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    template_id: str
    template_name: str
    category: str = 'general'
    location_id: Optional[str] = None
    location_name: Optional[str] = None
    worker_id: Optional[str] = None
    worker_name: Optional[str] = None
    answers: Dict[str, Any] = {}
    signature_b64: Optional[str] = None
    photos_b64: List[str] = []
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    flagged: bool = False
    flag_note: Optional[str] = None
    ai_summary: Optional[str] = None
    submitted_at: str = Field(default_factory=now_iso)

# ============== AUTH ==============
@api_router.post('/auth/register')
async def register(body: RegisterIn):
    existing = await db.users.find_one({'email': body.email})
    if existing:
        raise HTTPException(400, 'Email already registered')
    uid = str(uuid.uuid4())
    doc = {
        'id': uid,
        'email': body.email,
        'password': hash_pw(body.password),
        'name': body.name,
        'role': body.role,
        'created_at': now_iso(),
    }
    await db.users.insert_one(doc)
    # Also create worker profile if worker
    if body.role == 'worker':
        w = Worker(name=body.name, email=body.email, role='worker').model_dump()
        await db.workers.insert_one(w)
    token = make_token(uid, body.role)
    return {'token': token, 'user': {'id': uid, 'email': body.email, 'name': body.name, 'role': body.role}}

@api_router.post('/auth/login')
async def login(body: LoginIn):
    user = await db.users.find_one({'email': body.email})
    if not user or not verify_pw(body.password, user['password']):
        raise HTTPException(401, 'Invalid credentials')
    token = make_token(user['id'], user['role'])
    return {'token': token, 'user': {'id': user['id'], 'email': user['email'], 'name': user['name'], 'role': user['role']}}

@api_router.get('/auth/me')
async def me(user=Depends(get_current_user)):
    return user

# ============== WORKERS ==============
@api_router.get('/workers')
async def list_workers(user=Depends(get_current_user)):
    items = await db.workers.find({}, {'_id': 0}).to_list(1000)
    return items

@api_router.post('/workers')
async def create_worker(w: Worker, user=Depends(require_admin)):
    doc = w.model_dump()
    await db.workers.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/workers/{wid}')
async def update_worker(wid: str, w: Worker, user=Depends(require_admin)):
    doc = w.model_dump()
    doc['id'] = wid
    await db.workers.update_one({'id': wid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/workers/{wid}')
async def delete_worker(wid: str, user=Depends(require_admin)):
    await db.workers.delete_one({'id': wid})
    await db.certifications.delete_many({'worker_id': wid})
    return {'ok': True}

# ============== CERTIFICATIONS ==============
@api_router.get('/certifications')
async def list_certs(user=Depends(get_current_user)):
    items = await db.certifications.find({}, {'_id': 0}).to_list(2000)
    return items

@api_router.post('/certifications')
async def create_cert(c: Certification, user=Depends(get_current_user)):
    doc = c.model_dump()
    await db.certifications.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/certifications/{cid}')
async def delete_cert(cid: str, user=Depends(get_current_user)):
    await db.certifications.delete_one({'id': cid})
    return {'ok': True}

# ============== LOCATIONS ==============
@api_router.get('/locations')
async def list_locations(user=Depends(get_current_user)):
    items = await db.locations.find({}, {'_id': 0}).to_list(1000)
    return items

@api_router.post('/locations')
async def create_location(l: Location, user=Depends(require_admin)):
    doc = l.model_dump()
    await db.locations.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/locations/{lid}')
async def update_location(lid: str, l: Location, user=Depends(require_admin)):
    doc = l.model_dump()
    doc['id'] = lid
    await db.locations.update_one({'id': lid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/locations/{lid}')
async def delete_location(lid: str, user=Depends(require_admin)):
    await db.locations.delete_one({'id': lid})
    return {'ok': True}

# ============== FORM TEMPLATES ==============
@api_router.get('/forms/templates')
async def list_templates(user=Depends(get_current_user)):
    items = await db.form_templates.find({}, {'_id': 0}).to_list(1000)
    return items

@api_router.get('/forms/templates/{tid}')
async def get_template(tid: str, user=Depends(get_current_user)):
    t = await db.form_templates.find_one({'id': tid}, {'_id': 0})
    if not t:
        raise HTTPException(404, 'Not found')
    return t

@api_router.post('/forms/templates')
async def create_template(t: FormTemplate, user=Depends(require_admin)):
    doc = t.model_dump()
    await db.form_templates.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/forms/templates/{tid}')
async def update_template(tid: str, t: FormTemplate, user=Depends(require_admin)):
    doc = t.model_dump()
    doc['id'] = tid
    await db.form_templates.update_one({'id': tid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/forms/templates/{tid}')
async def delete_template(tid: str, user=Depends(require_admin)):
    await db.form_templates.delete_one({'id': tid})
    return {'ok': True}

# ============== SUBMISSIONS ==============
@api_router.get('/submissions')
async def list_submissions(user=Depends(get_current_user)):
    items = await db.submissions.find({}, {'_id': 0}).sort('submitted_at', -1).to_list(2000)
    return items

@api_router.get('/submissions/{sid}')
async def get_submission(sid: str, user=Depends(get_current_user)):
    s = await db.submissions.find_one({'id': sid}, {'_id': 0})
    if not s:
        raise HTTPException(404, 'Not found')
    return s

@api_router.post('/submissions')
async def create_submission(s: FormSubmission, user=Depends(get_current_user)):
    doc = s.model_dump()
    # auto-flag critical categories
    if doc.get('category') in ('incident', 'near_miss'):
        doc['flagged'] = True
    await db.submissions.insert_one(doc)
    doc.pop('_id', None)
    # Trigger auto-share rules (mocked email log)
    try:
        await evaluate_share_rules(doc)
    except Exception as e:
        logger.warning(f"Share rule eval failed: {e}")
    return doc

@api_router.delete('/submissions/{sid}')
async def delete_submission(sid: str, user=Depends(require_admin)):
    await db.submissions.delete_one({'id': sid})
    return {'ok': True}

# ============== AI ==============
class AISummaryIn(BaseModel):
    submission_id: str

@api_router.post('/ai/summarize')
async def ai_summarize(body: AISummaryIn, user=Depends(get_current_user)):
    sub = await db.submissions.find_one({'id': body.submission_id}, {'_id': 0})
    if not sub:
        raise HTTPException(404, 'Submission not found')
    
    # Build context
    parts = [
        f"Form: {sub.get('template_name')}",
        f"Category: {sub.get('category')}",
        f"Location: {sub.get('location_name')}",
        f"Worker: {sub.get('worker_name')}",
        f"Submitted: {sub.get('submitted_at')}",
        "\nAnswers:",
    ]
    for k, v in (sub.get('answers') or {}).items():
        parts.append(f"- {k}: {v}")
    context = "\n".join(parts)

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"summary-{body.submission_id}",
            system_message=(
                "You are a safety compliance analyst at Paneltec, a civil contractor. "
                "Summarize the following safety form submission in 3-5 concise bullet points. "
                "Highlight key risks, root causes, and recommended corrective actions. "
                "Be specific, professional, and actionable."
            )
        ).with_model('openai', 'gpt-4o-mini')
        msg = UserMessage(text=context)
        result = await chat.send_message(msg)
        summary = str(result)
    except Exception as e:
        logger.error(f"AI error: {e}")
        summary = f"(AI summary unavailable: {str(e)[:120]})"

    await db.submissions.update_one({'id': body.submission_id}, {'$set': {'ai_summary': summary}})
    return {'summary': summary}

# ============== ANALYTICS ==============
@api_router.get('/analytics/overview')
async def analytics_overview(user=Depends(get_current_user)):
    subs = await db.submissions.find({}, {'_id': 0}).to_list(5000)
    workers = await db.workers.find({}, {'_id': 0}).to_list(2000)
    locations = await db.locations.find({}, {'_id': 0}).to_list(2000)
    certs = await db.certifications.find({}, {'_id': 0}).to_list(5000)

    incidents = [s for s in subs if s.get('category') == 'incident']
    near_misses = [s for s in subs if s.get('category') == 'near_miss']
    inspections = [s for s in subs if s.get('category') == 'inspection']
    toolbox = [s for s in subs if s.get('category') == 'toolbox']

    # By location
    by_loc = {}
    for s in subs:
        ln = s.get('location_name') or 'Unassigned'
        by_loc[ln] = by_loc.get(ln, 0) + 1
    by_location = [{'location': k, 'count': v} for k, v in sorted(by_loc.items(), key=lambda x: -x[1])][:10]

    # By worker (incident-prone)
    by_worker = {}
    for s in subs:
        if s.get('category') in ('incident', 'near_miss'):
            wn = s.get('worker_name') or 'Unknown'
            by_worker[wn] = by_worker.get(wn, 0) + 1
    accident_prone = [{'worker': k, 'count': v} for k, v in sorted(by_worker.items(), key=lambda x: -x[1])][:8]

    # Monthly trend
    monthly = {}
    for s in subs:
        try:
            dt = datetime.fromisoformat(s['submitted_at'].replace('Z', '+00:00'))
            key = dt.strftime('%Y-%m')
            monthly.setdefault(key, {'month': key, 'incidents': 0, 'near_misses': 0, 'inspections': 0, 'toolbox': 0})
            cat = s.get('category', 'general')
            if cat == 'incident':
                monthly[key]['incidents'] += 1
            elif cat == 'near_miss':
                monthly[key]['near_misses'] += 1
            elif cat == 'inspection':
                monthly[key]['inspections'] += 1
            elif cat == 'toolbox':
                monthly[key]['toolbox'] += 1
        except Exception:
            pass
    monthly_trend = sorted(monthly.values(), key=lambda x: x['month'])[-12:]

    # Expiring certs (30 days)
    soon = []
    today = datetime.now(timezone.utc).date()
    for c in certs:
        if c.get('expiry_date'):
            try:
                exp = datetime.fromisoformat(c['expiry_date']).date()
                days = (exp - today).days
                if days <= 60:
                    worker_name = next((w['name'] for w in workers if w['id'] == c.get('worker_id')), 'Unknown')
                    soon.append({
                        'cert_id': c['id'],
                        'name': c['name'],
                        'worker_name': worker_name,
                        'expiry_date': c['expiry_date'],
                        'days_remaining': days,
                        'status': 'expired' if days < 0 else ('critical' if days <= 14 else 'warning')
                    })
            except Exception:
                pass
    soon.sort(key=lambda x: x['days_remaining'])

    return {
        'kpis': {
            'total_submissions': len(subs),
            'incidents': len(incidents),
            'near_misses': len(near_misses),
            'inspections': len(inspections),
            'toolbox_talks': len(toolbox),
            'workers': len(workers),
            'locations': len(locations),
            'flagged': len([s for s in subs if s.get('flagged')]),
            'expiring_certs': len(soon),
        },
        'by_location': by_location,
        'accident_prone': accident_prone,
        'monthly_trend': monthly_trend,
        'expiring_certifications': soon[:20],
    }

# ============== SEED ==============
@api_router.post('/seed')
async def seed_demo():
    """Seed demo data for a civil contractor (Paneltec)."""
    # Clear
    await db.users.delete_many({})
    await db.workers.delete_many({})
    await db.locations.delete_many({})
    await db.certifications.delete_many({})
    await db.form_templates.delete_many({})
    await db.submissions.delete_many({})

    # Admin + worker
    admin_id = str(uuid.uuid4())
    await db.users.insert_one({
        'id': admin_id, 'email': 'admin@paneltec.com',
        'password': hash_pw('admin123'), 'name': 'Admin Paneltec',
        'role': 'admin', 'created_at': now_iso()
    })
    worker_uid = str(uuid.uuid4())
    await db.users.insert_one({
        'id': worker_uid, 'email': 'worker@paneltec.com',
        'password': hash_pw('worker123'), 'name': 'John Carpenter',
        'role': 'worker', 'created_at': now_iso()
    })

    # Locations - civil contractor jobsites
    locs = [
        {'name': 'Highway 401 Expansion - Section A', 'address': 'Toronto, ON', 'project_code': 'PT-HW401-A'},
        {'name': 'Downtown Bridge Reconstruction', 'address': 'Mississauga, ON', 'project_code': 'PT-BR-DT'},
        {'name': 'Industrial Park Foundation Site', 'address': 'Brampton, ON', 'project_code': 'PT-IP-FN'},
        {'name': 'Waterfront Drainage Project', 'address': 'Hamilton, ON', 'project_code': 'PT-WF-DR'},
    ]
    location_docs = []
    for l in locs:
        d = Location(**l).model_dump()
        location_docs.append(d)
    await db.locations.insert_many([dict(x) for x in location_docs])

    # Workers - civil contractor trades
    worker_data = [
        ('John Carpenter', 'Site Supervisor', 'supervisor'),
        ('Mike Rodriguez', 'Heavy Equipment Operator', 'worker'),
        ('Sarah Thompson', 'Concrete Finisher', 'worker'),
        ('David Chen', 'Surveyor', 'worker'),
        ('Emily Brooks', 'Safety Officer', 'supervisor'),
        ('Carlos Mendez', 'Excavator Operator', 'worker'),
        ('Liam OConnor', 'Foreman', 'supervisor'),
        ('Aisha Patel', 'Quality Inspector', 'worker'),
        ('Robert Kane', 'Pipelayer', 'worker'),
        ('Tom Walker', 'Crane Operator', 'worker'),
    ]
    worker_docs = []
    for name, trade, role in worker_data:
        w = Worker(name=name, trade=trade, role=role,
                   email=f"{name.split()[0].lower()}@paneltec.com",
                   location_ids=[location_docs[len(worker_docs) % len(location_docs)]['id']]).model_dump()
        worker_docs.append(w)
    await db.workers.insert_many([dict(x) for x in worker_docs])

    # Certifications with varied expiries
    today = datetime.now(timezone.utc).date()
    cert_data = [
        ('WHMIS 2015', 'Ontario Labour', 200),
        ('Working at Heights', 'MOL', 45),
        ('Confined Space Entry', 'IHSA', -10),
        ('First Aid / CPR', 'Red Cross', 90),
        ('Heavy Equipment Operator', 'IHSA', 12),
        ('Traffic Control Person', 'OTM Book 7', 365),
        ('Fall Protection', 'IHSA', 7),
        ('Excavation & Trenching', 'CSAO', 180),
    ]
    cert_docs = []
    for i, w in enumerate(worker_docs):
        # 2 certs per worker
        for j in range(2):
            cname, issuer, days = cert_data[(i + j) % len(cert_data)]
            exp = today + timedelta(days=days + (i * 5))
            issued = today - timedelta(days=365 - (i * 3))
            cert_docs.append(Certification(
                worker_id=w['id'], name=cname, issuer=issuer,
                issued_date=issued.isoformat(), expiry_date=exp.isoformat()
            ).model_dump())
    await db.certifications.insert_many([dict(x) for x in cert_docs])

    # Form Templates
    templates = [
        FormTemplate(
            name='Incident Report',
            category='incident',
            description='Report any workplace incident on a civil construction site',
            fields=[
                {'id': 'f1', 'label': 'Date & Time of Incident', 'type': 'date', 'required': True},
                {'id': 'f2', 'label': 'Type of Incident', 'type': 'select', 'required': True,
                 'options': ['Injury', 'Property Damage', 'Equipment Failure', 'Environmental Spill', 'Near Miss', 'Other']},
                {'id': 'f3', 'label': 'Description of Incident', 'type': 'textarea', 'required': True,
                 'placeholder': 'Describe what happened in detail...'},
                {'id': 'f4', 'label': 'Immediate Cause', 'type': 'textarea', 'required': False},
                {'id': 'f5', 'label': 'Body Part Affected (if injury)', 'type': 'select',
                 'options': ['N/A', 'Head', 'Eye', 'Hand', 'Arm', 'Back', 'Leg', 'Foot', 'Other']},
                {'id': 'f6', 'label': 'Witnesses', 'type': 'text'},
                {'id': 'f7', 'label': 'Corrective Actions Required', 'type': 'textarea'},
                {'id': 'f8', 'label': 'Photo Evidence', 'type': 'photo'},
                {'id': 'f9', 'label': 'Worker Signature', 'type': 'signature', 'required': True},
            ]
        ).model_dump(),
        FormTemplate(
            name='Daily Site Inspection',
            category='inspection',
            description='Pre-work safety inspection of the jobsite',
            fields=[
                {'id': 'f1', 'label': 'Inspection Date', 'type': 'date', 'required': True},
                {'id': 'f2', 'label': 'Weather Conditions', 'type': 'select',
                 'options': ['Clear', 'Cloudy', 'Rain', 'Snow', 'Windy', 'Fog']},
                {'id': 'f3', 'label': 'PPE Available & In Use?', 'type': 'radio', 'options': ['Yes', 'No', 'Partial']},
                {'id': 'f4', 'label': 'Excavations Properly Shored?', 'type': 'radio', 'options': ['Yes', 'No', 'N/A']},
                {'id': 'f5', 'label': 'Traffic Control in Place?', 'type': 'radio', 'options': ['Yes', 'No', 'N/A']},
                {'id': 'f6', 'label': 'Equipment Inspected?', 'type': 'radio', 'options': ['Yes', 'No']},
                {'id': 'f7', 'label': 'Hazards Identified', 'type': 'textarea'},
                {'id': 'f8', 'label': 'Site Photo', 'type': 'photo'},
                {'id': 'f9', 'label': 'Inspector Signature', 'type': 'signature', 'required': True},
            ]
        ).model_dump(),
        FormTemplate(
            name='Toolbox Talk',
            category='toolbox',
            description='Daily safety briefing with the crew',
            fields=[
                {'id': 'f1', 'label': 'Date', 'type': 'date', 'required': True},
                {'id': 'f2', 'label': 'Topic Discussed', 'type': 'text', 'required': True},
                {'id': 'f3', 'label': 'Key Points', 'type': 'textarea', 'required': True},
                {'id': 'f4', 'label': 'Number of Attendees', 'type': 'number'},
                {'id': 'f5', 'label': 'Questions / Concerns Raised', 'type': 'textarea'},
                {'id': 'f6', 'label': 'Foreman Signature', 'type': 'signature', 'required': True},
            ]
        ).model_dump(),
        FormTemplate(
            name='Near Miss Report',
            category='near_miss',
            description='Report a near miss to prevent future incidents',
            fields=[
                {'id': 'f1', 'label': 'Date & Time', 'type': 'date', 'required': True},
                {'id': 'f2', 'label': 'What Happened?', 'type': 'textarea', 'required': True},
                {'id': 'f3', 'label': 'Potential Severity', 'type': 'select',
                 'options': ['Low', 'Medium', 'High', 'Critical']},
                {'id': 'f4', 'label': 'Contributing Factors', 'type': 'textarea'},
                {'id': 'f5', 'label': 'Recommended Actions', 'type': 'textarea'},
                {'id': 'f6', 'label': 'Photo', 'type': 'photo'},
                {'id': 'f7', 'label': 'Signature', 'type': 'signature', 'required': True},
            ]
        ).model_dump(),
        FormTemplate(
            name='Equipment Pre-Use Checklist',
            category='inspection',
            description='Inspect heavy equipment before use',
            fields=[
                {'id': 'f1', 'label': 'Equipment Type', 'type': 'select',
                 'options': ['Excavator', 'Bulldozer', 'Crane', 'Loader', 'Dump Truck', 'Grader', 'Compactor']},
                {'id': 'f2', 'label': 'Equipment ID / Serial #', 'type': 'text', 'required': True},
                {'id': 'f3', 'label': 'Fluid Levels OK?', 'type': 'radio', 'options': ['Yes', 'No']},
                {'id': 'f4', 'label': 'Tires/Tracks Condition', 'type': 'radio', 'options': ['Good', 'Fair', 'Poor']},
                {'id': 'f5', 'label': 'Lights & Alarms Working?', 'type': 'radio', 'options': ['Yes', 'No']},
                {'id': 'f6', 'label': 'Defects Found', 'type': 'textarea'},
                {'id': 'f7', 'label': 'Operator Signature', 'type': 'signature', 'required': True},
            ]
        ).model_dump(),
    ]
    await db.form_templates.insert_many([dict(x) for x in templates])

    # Generate realistic submissions (~50)
    import random
    random.seed(42)
    incident_descriptions = [
        ('Worker slipped on muddy ground near excavation, sustained minor ankle sprain. Wet conditions from morning rain not properly cordoned off.', 'Injury'),
        ('Excavator bucket struck overhead utility line. Power outage to adjacent building. No injuries but significant property damage.', 'Property Damage'),
        ('Operator failed to perform pre-use brake check. Truck rolled 3 feet before being stopped. No damage.', 'Equipment Failure'),
        ('Hydraulic fluid leak from grader contaminated drainage ditch. Environmental cleanup required.', 'Environmental Spill'),
        ('Worker not wearing fall protection while installing rebar on elevated form. Caught by supervisor and corrected.', 'Near Miss'),
        ('Concrete splash to eye despite safety glasses (worn improperly). Flushed at site, sent for medical check.', 'Injury'),
    ]
    near_miss_descs = [
        'Steel beam swung dangerously close to ground crew during crane lift due to gust of wind.',
        'Worker stepped backward without looking, came within 2 feet of operating excavator swing radius.',
        'Trench collapse on unshored section just minutes after crew exited for break.',
        'Vehicle entered closed traffic zone after barricades were knocked over by wind overnight.',
    ]
    
    submissions = []
    for i in range(55):
        days_ago = random.randint(0, 180)
        sub_date = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
        cat_choice = random.choices(
            ['incident', 'near_miss', 'inspection', 'toolbox'],
            weights=[0.18, 0.20, 0.35, 0.27]
        )[0]
        tpl = next((t for t in templates if t['category'] == cat_choice), templates[0])
        loc = random.choice(location_docs)
        worker = random.choice(worker_docs)

        answers = {}
        if cat_choice == 'incident':
            desc, itype = random.choice(incident_descriptions)
            answers = {
                'Date & Time of Incident': sub_date[:10],
                'Type of Incident': itype,
                'Description of Incident': desc,
                'Immediate Cause': random.choice([
                    'Inadequate hazard assessment', 'Rushing to meet deadline',
                    'Equipment not properly maintained', 'Lack of training on new procedure'
                ]),
                'Body Part Affected (if injury)': random.choice(['N/A', 'Hand', 'Eye', 'Back', 'Foot']),
                'Corrective Actions Required': 'Retrain crew on procedure. Update site hazard assessment. Toolbox talk scheduled.',
            }
        elif cat_choice == 'near_miss':
            answers = {
                'Date & Time': sub_date[:10],
                'What Happened?': random.choice(near_miss_descs),
                'Potential Severity': random.choice(['Medium', 'High', 'Critical']),
                'Contributing Factors': 'Weather conditions; communication breakdown between operator and ground crew.',
                'Recommended Actions': 'Implement stop-work protocol for high winds. Add spotter requirement.'
            }
        elif cat_choice == 'inspection':
            answers = {
                'Inspection Date': sub_date[:10],
                'Weather Conditions': random.choice(['Clear', 'Cloudy', 'Rain']),
                'PPE Available & In Use?': random.choice(['Yes', 'Partial']),
                'Excavations Properly Shored?': random.choice(['Yes', 'N/A']),
                'Traffic Control in Place?': 'Yes',
                'Equipment Inspected?': 'Yes',
                'Hazards Identified': random.choice(['None', 'Loose debris near walkway', 'Standing water in trench'])
            }
        else:  # toolbox
            topics = ['Fall Protection', 'Trenching Safety', 'Crane Lift Plan', 'Heat Stress', 'PPE Compliance', 'Backup Alarms']
            answers = {
                'Date': sub_date[:10],
                'Topic Discussed': random.choice(topics),
                'Key Points': 'Reviewed proper use of equipment, hazard identification, emergency procedures.',
                'Number of Attendees': random.randint(5, 18),
            }
        sub = FormSubmission(
            template_id=tpl['id'],
            template_name=tpl['name'],
            category=cat_choice,
            location_id=loc['id'],
            location_name=loc['name'],
            worker_id=worker['id'],
            worker_name=worker['name'],
            answers=answers,
            gps_lat=43.6532 + random.uniform(-0.5, 0.5),
            gps_lng=-79.3832 + random.uniform(-0.5, 0.5),
            flagged=(cat_choice in ('incident', 'near_miss')),
            submitted_at=sub_date,
        ).model_dump()
        submissions.append(sub)
    await db.submissions.insert_many([dict(x) for x in submissions])

    return {'ok': True, 'message': 'Demo data seeded',
            'counts': {'workers': len(worker_docs), 'locations': len(location_docs),
                       'templates': len(templates), 'submissions': len(submissions),
                       'certifications': len(cert_docs)}}

# ============== AUTO-SHARE RULES ==============
class AutoShareRule(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    location_id: Optional[str] = None
    category: Optional[str] = None  # incident, near_miss, inspection, toolbox, general, or None=all
    emails: List[str] = []
    enabled: bool = True
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/share-rules')
async def list_share_rules(user=Depends(get_current_user)):
    items = await db.share_rules.find({}, {'_id': 0}).to_list(500)
    return items

@api_router.post('/share-rules')
async def create_share_rule(r: AutoShareRule, user=Depends(require_admin)):
    doc = r.model_dump()
    await db.share_rules.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/share-rules/{rid}')
async def delete_share_rule(rid: str, user=Depends(require_admin)):
    await db.share_rules.delete_one({'id': rid})
    return {'ok': True}

@api_router.get('/share-log')
async def list_share_log(user=Depends(get_current_user)):
    items = await db.share_log.find({}, {'_id': 0}).sort('sent_at', -1).to_list(500)
    return items

async def evaluate_share_rules(submission: dict):
    """Mock email dispatch — store every match in share_log."""
    rules = await db.share_rules.find({'enabled': True}, {'_id': 0}).to_list(500)
    for r in rules:
        loc_match = (not r.get('location_id')) or r.get('location_id') == submission.get('location_id')
        cat_match = (not r.get('category')) or r.get('category') == submission.get('category')
        if loc_match and cat_match and r.get('emails'):
            for email in r['emails']:
                log = {
                    'id': str(uuid.uuid4()),
                    'rule_id': r['id'],
                    'submission_id': submission['id'],
                    'template_name': submission.get('template_name'),
                    'location_name': submission.get('location_name'),
                    'category': submission.get('category'),
                    'recipient': email,
                    'status': 'mocked',
                    'sent_at': now_iso(),
                }
                await db.share_log.insert_one(log)

# ============== API TOKENS (Public API) ==============
class ApiToken(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    token: str = Field(default_factory=lambda: 'ptk_' + secrets.token_urlsafe(24))
    scopes: List[str] = ['read']  # read, write
    last_used: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/api-tokens')
async def list_tokens(user=Depends(require_admin)):
    items = await db.api_tokens.find({}, {'_id': 0}).to_list(200)
    return items

@api_router.post('/api-tokens')
async def create_token(t: ApiToken, user=Depends(require_admin)):
    doc = t.model_dump()
    await db.api_tokens.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/api-tokens/{tid}')
async def delete_token(tid: str, user=Depends(require_admin)):
    await db.api_tokens.delete_one({'id': tid})
    return {'ok': True}

async def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if not x_api_key:
        raise HTTPException(401, 'Missing X-API-Key header')
    tok = await db.api_tokens.find_one({'token': x_api_key}, {'_id': 0})
    if not tok:
        raise HTTPException(401, 'Invalid API key')
    await db.api_tokens.update_one({'id': tok['id']}, {'$set': {'last_used': now_iso()}})
    return tok

# Public API endpoints (consumed by Zapier-like integrations)
@api_router.get('/public/submissions')
async def public_list_submissions(tok=Depends(verify_api_key)):
    items = await db.submissions.find({}, {'_id': 0}).sort('submitted_at', -1).to_list(500)
    return items

@api_router.get('/public/workers')
async def public_list_workers(tok=Depends(verify_api_key)):
    return await db.workers.find({}, {'_id': 0}).to_list(500)

@api_router.get('/public/certifications')
async def public_list_certs(tok=Depends(verify_api_key)):
    return await db.certifications.find({}, {'_id': 0}).to_list(2000)

@api_router.get('/public/locations')
async def public_list_locations(tok=Depends(verify_api_key)):
    return await db.locations.find({}, {'_id': 0}).to_list(500)

# ============== CHAT / NOTIFICATIONS ==============
class ChatMessage(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sender_id: str
    sender_name: str
    sender_role: str = 'worker'
    channel: str = 'general'  # general | broadcast | direct:<user_id>
    body: str
    location_id: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/chat/messages')
async def list_messages(channel: str = 'general', limit: int = 100, user=Depends(get_current_user)):
    items = await db.chat_messages.find({'channel': channel}, {'_id': 0}).sort('created_at', -1).limit(limit).to_list(limit)
    return list(reversed(items))

@api_router.post('/chat/messages')
async def post_message(body: dict, user=Depends(get_current_user)):
    msg = ChatMessage(
        sender_id=user['id'],
        sender_name=user.get('name', 'Unknown'),
        sender_role=user.get('role', 'worker'),
        channel=body.get('channel', 'general'),
        body=body.get('body', '').strip(),
        location_id=body.get('location_id'),
    ).model_dump()
    if not msg['body']:
        raise HTTPException(400, 'Empty message')
    await db.chat_messages.insert_one(msg)
    msg.pop('_id', None)
    # Add a notification fan-out
    await db.notifications.insert_one({
        'id': str(uuid.uuid4()),
        'type': 'chat',
        'title': f"New message from {msg['sender_name']}",
        'body': msg['body'][:120],
        'channel': msg['channel'],
        'created_at': now_iso(),
        'read': False,
    })
    return msg

@api_router.get('/notifications')
async def list_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({}, {'_id': 0}).sort('created_at', -1).limit(50).to_list(50)
    return items

@api_router.post('/notifications/mark-read')
async def mark_read(user=Depends(get_current_user)):
    await db.notifications.update_many({}, {'$set': {'read': True}})
    return {'ok': True}

# ============== PDF EXPORT ==============
@api_router.get('/submissions/{sid}/pdf')
async def submission_pdf(sid: str, authorization: Optional[str] = Header(None), token: Optional[str] = None):
    # Accept either Authorization header or ?token=... query (for download links)
    user = None
    auth_token = None
    if authorization and authorization.startswith('Bearer '):
        auth_token = authorization.split(' ', 1)[1]
    elif token:
        auth_token = token
    if not auth_token:
        raise HTTPException(401, 'Missing token')
    try:
        payload = jwt.decode(auth_token, JWT_SECRET, algorithms=[JWT_ALG])
        user = await db.users.find_one({'id': payload['sub']}, {'_id': 0, 'password': 0})
    except Exception:
        raise HTTPException(401, 'Invalid token')
    if not user:
        raise HTTPException(401, 'User not found')

    sub = await db.submissions.find_one({'id': sid}, {'_id': 0})
    if not sub:
        raise HTTPException(404, 'Submission not found')

    # Build PDF
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, Table, TableStyle, PageBreak
    from reportlab.lib.units import inch

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.6*inch, rightMargin=0.6*inch,
                            topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    PT_YELLOW = colors.HexColor('#FBBF24')
    PT_BLACK = colors.HexColor('#0B0B0F')

    title_style = ParagraphStyle('Title', parent=styles['Title'], textColor=PT_BLACK, fontSize=20, spaceAfter=4, alignment=0)
    sub_style = ParagraphStyle('Sub', parent=styles['Normal'], textColor=colors.HexColor('#6B7280'), fontSize=10, spaceAfter=12)
    h2 = ParagraphStyle('H2', parent=styles['Heading2'], textColor=PT_BLACK, fontSize=13, spaceBefore=10, spaceAfter=6)
    body = styles['BodyText']

    story = []
    # Branded header
    header_data = [[
        Paragraph('<b><font color="#FBBF24">PANELTEC</font></b><br/><font size=8 color="#6B7280">SAFETY PORTAL · CIVIL CONTRACTORS</font>', styles['Normal']),
        Paragraph(f'<para align=right><font size=9 color="#6B7280">Generated: {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}<br/>Document ID: {sub["id"][:8]}</font></para>', styles['Normal']),
    ]]
    header_tbl = Table(header_data, colWidths=[3.5*inch, 3.5*inch])
    header_tbl.setStyle(TableStyle([
        ('LINEBELOW', (0,0), (-1,-1), 2, PT_YELLOW),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(header_tbl)
    story.append(Spacer(1, 12))

    story.append(Paragraph(sub.get('template_name', 'Safety Form'), title_style))
    cat_label = sub.get('category', 'general').replace('_', ' ').title()
    story.append(Paragraph(f"Category: <b>{cat_label}</b>", sub_style))

    # Metadata table
    meta = [
        ['Worker:', sub.get('worker_name') or '—', 'Submitted:', (sub.get('submitted_at') or '')[:19].replace('T', ' ')],
        ['Job Site:', sub.get('location_name') or '—', 'GPS:', f"{sub.get('gps_lat'):.4f}, {sub.get('gps_lng'):.4f}" if sub.get('gps_lat') else '—'],
    ]
    meta_tbl = Table(meta, colWidths=[1.0*inch, 2.5*inch, 1.0*inch, 2.5*inch])
    meta_tbl.setStyle(TableStyle([
        ('FONTNAME', (0,0), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F9FAFB')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#E5E7EB')),
        ('TEXTCOLOR', (0,0), (0,-1), colors.HexColor('#6B7280')),
        ('TEXTCOLOR', (2,0), (2,-1), colors.HexColor('#6B7280')),
        ('FONTNAME', (1,0), (1,-1), 'Helvetica-Bold'),
        ('FONTNAME', (3,0), (3,-1), 'Helvetica-Bold'),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(meta_tbl)

    # AI Summary
    if sub.get('ai_summary'):
        story.append(Paragraph('AI Safety Insights', h2))
        story.append(Paragraph(sub['ai_summary'].replace('\n', '<br/>'), body))

    # Responses
    story.append(Paragraph('Form Responses', h2))
    for k, v in (sub.get('answers') or {}).items():
        story.append(Paragraph(f"<b>{k}</b>", body))
        story.append(Paragraph(str(v), body))
        story.append(Spacer(1, 6))

    # Photos
    photos = sub.get('photos_b64') or []
    if photos:
        story.append(Paragraph('Photo Evidence', h2))
        for p in photos[:6]:
            try:
                if ',' in p:
                    p = p.split(',', 1)[1]
                img_bytes = base64.b64decode(p)
                img_buf = io.BytesIO(img_bytes)
                story.append(RLImage(img_buf, width=4.5*inch, height=3*inch, kind='proportional'))
                story.append(Spacer(1, 6))
            except Exception as e:
                logger.warning(f"PDF photo error: {e}")

    # Signature
    if sub.get('signature_b64'):
        story.append(Paragraph('Worker Signature', h2))
        try:
            sig = sub['signature_b64']
            if ',' in sig:
                sig = sig.split(',', 1)[1]
            sig_bytes = base64.b64decode(sig)
            story.append(RLImage(io.BytesIO(sig_bytes), width=3*inch, height=1*inch, kind='proportional'))
        except Exception as e:
            logger.warning(f"Sig render error: {e}")

    story.append(Spacer(1, 24))
    story.append(Paragraph(f'<para align=center><font size=8 color="#9CA3AF">© Paneltec Civil Contractors · This is an electronically signed record · {sub["id"]}</font></para>', styles['Normal']))

    doc.build(story)
    buf.seek(0)
    filename = f"paneltec-{sub.get('category','form')}-{sub['id'][:8]}.pdf"
    return StreamingResponse(buf, media_type='application/pdf',
                             headers={'Content-Disposition': f'inline; filename="{filename}"'})



# ============== RISK REGISTER ==============
RISK_RATING_LABELS = {
    1: 'Low', 2: 'Low', 3: 'Moderate', 4: 'Moderate',
    6: 'High', 8: 'High', 9: 'Critical', 12: 'Critical', 16: 'Critical', 25: 'Critical'
}

def risk_label(score: int) -> str:
    if score <= 2: return 'Low'
    if score <= 4: return 'Moderate'
    if score <= 8: return 'High'
    return 'Critical'

class Risk(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    location_id: Optional[str] = None
    hazard_category: str  # Gravity/fall, ICT, Administrative, Lighting, Biological, Chemical
    hazard: str
    risk_details: str
    likelihood: int = 3  # 1..5
    consequence: int = 3  # 1..5
    current_controls: List[str] = []
    residual_likelihood: int = 2
    residual_consequence: int = 2
    new_controls: List[str] = []
    owner_id: Optional[str] = None
    status: str = 'open'  # open, mitigated, closed
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/risks')
async def list_risks(user=Depends(get_current_user)):
    items = await db.risks.find({}, {'_id': 0}).sort('created_at', -1).to_list(2000)
    return items

@api_router.post('/risks')
async def create_risk(r: Risk, user=Depends(get_current_user)):
    doc = r.model_dump()
    await db.risks.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/risks/{rid}')
async def update_risk(rid: str, r: Risk, user=Depends(get_current_user)):
    doc = r.model_dump(); doc['id'] = rid
    await db.risks.update_one({'id': rid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/risks/{rid}')
async def delete_risk(rid: str, user=Depends(require_admin)):
    await db.risks.delete_one({'id': rid})
    return {'ok': True}

# ============== ACTION PLANS ==============
class ActionItem(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    submission_id: Optional[str] = None
    risk_id: Optional[str] = None
    location_id: Optional[str] = None
    priority: str = 'medium'  # low, medium, high, critical
    status: str = 'open'  # open, in_progress, done, overdue
    due_date: Optional[str] = None
    completed_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/actions')
async def list_actions(user=Depends(get_current_user)):
    items = await db.actions.find({}, {'_id': 0}).sort('due_date', 1).to_list(2000)
    return items

@api_router.post('/actions')
async def create_action(a: ActionItem, user=Depends(get_current_user)):
    doc = a.model_dump()
    await db.actions.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/actions/{aid}')
async def update_action(aid: str, a: ActionItem, user=Depends(get_current_user)):
    doc = a.model_dump(); doc['id'] = aid
    await db.actions.update_one({'id': aid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/actions/{aid}')
async def delete_action(aid: str, user=Depends(get_current_user)):
    await db.actions.delete_one({'id': aid})
    return {'ok': True}

# ============== CHEMICALS / SDS ==============
class Chemical(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    manufacturer: Optional[str] = None
    cas_number: Optional[str] = None
    hazard_class: str = 'general'  # flammable, corrosive, toxic, oxidizer, explosive, general
    sds_url: Optional[str] = None
    sds_b64: Optional[str] = None  # base64 PDF content
    location_id: Optional[str] = None
    quantity: Optional[str] = None
    notes: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/chemicals')
async def list_chemicals(user=Depends(get_current_user)):
    items = await db.chemicals.find({}, {'_id': 0}).to_list(2000)
    return items

@api_router.post('/chemicals')
async def create_chemical(c: Chemical, user=Depends(get_current_user)):
    doc = c.model_dump()
    await db.chemicals.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/chemicals/{cid}')
async def delete_chemical(cid: str, user=Depends(require_admin)):
    await db.chemicals.delete_one({'id': cid})
    return {'ok': True}

# ============== ASSETS ==============
class Asset(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    asset_type: str = 'equipment'  # equipment, vehicle, tool, ppe
    serial_number: Optional[str] = None
    location_id: Optional[str] = None
    assigned_worker_id: Optional[str] = None
    status: str = 'active'  # active, maintenance, retired
    next_inspection: Optional[str] = None
    last_inspection: Optional[str] = None
    notes: Optional[str] = None
    photo_b64: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/assets')
async def list_assets(user=Depends(get_current_user)):
    return await db.assets.find({}, {'_id': 0}).to_list(2000)

@api_router.post('/assets')
async def create_asset(a: Asset, user=Depends(get_current_user)):
    doc = a.model_dump()
    await db.assets.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/assets/{aid}')
async def delete_asset(aid: str, user=Depends(require_admin)):
    await db.assets.delete_one({'id': aid})
    return {'ok': True}

# ============== CONTRACTORS ==============
class Contractor(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    trade: Optional[str] = None
    insurance_expiry: Optional[str] = None
    prequalified: bool = False
    workers_count: int = 0
    notes: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/contractors')
async def list_contractors(user=Depends(get_current_user)):
    return await db.contractors.find({}, {'_id': 0}).to_list(2000)

@api_router.post('/contractors')
async def create_contractor(c: Contractor, user=Depends(get_current_user)):
    doc = c.model_dump()
    await db.contractors.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/contractors/{cid}')
async def delete_contractor(cid: str, user=Depends(require_admin)):
    await db.contractors.delete_one({'id': cid})
    return {'ok': True}

# ============== HAZARD QUICK REPORT ==============
class HazardReport(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    severity: str = 'medium'  # low, medium, high, critical
    location_id: Optional[str] = None
    location_name: Optional[str] = None
    reporter_id: Optional[str] = None
    reporter_name: Optional[str] = None
    photo_b64: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    status: str = 'open'
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/hazards')
async def list_hazards(user=Depends(get_current_user)):
    return await db.hazards.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)

@api_router.post('/hazards')
async def create_hazard(h: HazardReport, user=Depends(get_current_user)):
    doc = h.model_dump()
    doc['reporter_id'] = user['id']
    doc['reporter_name'] = user.get('name')
    await db.hazards.insert_one(doc)
    # Auto-create action for high/critical
    if doc.get('severity') in ('high', 'critical'):
        action = ActionItem(
            title=f"Address hazard: {doc['title']}",
            description=doc['description'],
            priority=doc['severity'],
            location_id=doc.get('location_id'),
            due_date=(datetime.now(timezone.utc) + timedelta(days=3 if doc['severity']=='critical' else 7)).date().isoformat(),
        ).model_dump()
        await db.actions.insert_one(action)
    doc.pop('_id', None)
    return doc

# ============== EXTEND SEED ==============
@api_router.post('/seed-extras')
async def seed_extras():
    """Seed risk register, chemicals, assets, contractors, actions for demo."""
    import random
    random.seed(7)
    await db.risks.delete_many({})
    await db.actions.delete_many({})
    await db.chemicals.delete_many({})
    await db.assets.delete_many({})
    await db.contractors.delete_many({})
    await db.hazards.delete_many({})

    locations = await db.locations.find({}, {'_id': 0}).to_list(100)
    workers = await db.workers.find({}, {'_id': 0}).to_list(100)

    # RISKS — civil-contractor specific
    risk_seed = [
        ('Gravity / Fall', 'Fall from height — scaffold without barrier on slab edge', 4, 5, ['Toe boards', 'PPE harness'], ['Install permanent guardrails', 'Daily inspection'], 2, 3),
        ('Excavation', 'Trench collapse — unshored excavation > 1.2m', 4, 5, ['Sloping at 1:1'], ['Hydraulic shoring boxes', 'Competent person daily check'], 1, 3),
        ('ICT', 'Loss of internet — no access to safe work procedures on jobsite', 3, 3, ['Paper backup of SWPs'], ['Offline mobile sync'], 1, 2),
        ('Administrative', 'Hearing damage — exposure to compactor / jackhammer noise', 4, 3, ['Hearing protection issued'], ['Mandatory double-hearing protection above 85dB'], 2, 2),
        ('Lighting', 'Insufficient lighting in stairwell of partially built structure', 3, 2, ['Temporary LED strings'], ['Permanent lighting install'], 1, 2),
        ('Biological', 'Possibility of exposure to flu/seasonal illness on crowded crew bus', 3, 2, ['Hand sanitizer at site entry'], ['Stagger crew shifts'], 2, 2),
        ('Plant / Equipment', 'Excavator swing-radius struck-by hazard for ground crew', 4, 5, ['Banksman / spotter'], ['Spatial awareness alarms', 'Exclusion zone tape'], 2, 4),
        ('Chemical', 'Exposure to silica dust during concrete cutting', 4, 4, ['Wet cutting', 'P2 respirators'], ['Engineered local exhaust ventilation'], 2, 3),
        ('Chemical', 'Asbestos exposure during demolition of legacy structures', 3, 5, ['Pre-demo asbestos survey'], ['Licensed asbestos removal contractor'], 1, 4),
        ('Manual Handling', 'Back strain — lifting heavy formwork timbers manually', 4, 3, ['2-person lift policy'], ['Mechanical lifting aid procurement'], 3, 2),
        ('Traffic', 'Public vehicle intrusion into work zone on Highway 401 expansion', 3, 5, ['TCP / cones / signage'], ['Concrete barriers', 'Variable message signs'], 2, 4),
        ('Electrical', 'Contact with overhead power lines during crane operations', 2, 5, ['Spotter / minimum distance'], ['De-energize lines via utility coordination'], 1, 4),
    ]
    risk_docs = []
    for hc, det, l, c, cur, new, rl, rc in risk_seed:
        r = Risk(
            location_id=random.choice(locations)['id'] if locations else None,
            hazard_category=hc,
            hazard=det.split(' — ')[0],
            risk_details=det,
            likelihood=l, consequence=c,
            current_controls=cur,
            new_controls=new,
            residual_likelihood=rl, residual_consequence=rc,
            owner_id=random.choice(workers)['id'] if workers else None,
        ).model_dump()
        risk_docs.append(r)
    await db.risks.insert_many([dict(x) for x in risk_docs])

    # ACTIONS
    action_seed = [
        ('Install permanent guardrails — Level 3 slab', 'high', 5),
        ('Procure hydraulic shoring boxes', 'critical', 2),
        ('Schedule licensed asbestos removal vendor', 'critical', 1),
        ('Roll out P2 fit-testing for concrete cutters', 'high', 14),
        ('Coordinate utility de-energization for crane lifts', 'high', 7),
        ('Toolbox talk: hearing protection above 85dB', 'medium', 3),
        ('Replace damaged barricades on Highway 401 zone', 'high', 4),
        ('Refresh first-aid kits at all 4 sites', 'medium', 10),
        ('Investigate near-miss: ground crew swing-radius', 'critical', -2),  # overdue
        ('Update lighting in Downtown Bridge stairwell', 'medium', 21),
    ]
    today = datetime.now(timezone.utc)
    action_docs = []
    for title, pri, days in action_seed:
        due = (today + timedelta(days=days)).date().isoformat()
        st = 'overdue' if days < 0 else random.choice(['open', 'open', 'in_progress'])
        w = random.choice(workers) if workers else None
        a = ActionItem(
            title=title,
            description=f"Follow-up corrective action — assigned during risk review.",
            assignee_id=w['id'] if w else None,
            assignee_name=w['name'] if w else None,
            priority=pri,
            status=st,
            due_date=due,
            location_id=random.choice(locations)['id'] if locations else None,
        ).model_dump()
        action_docs.append(a)
    await db.actions.insert_many([dict(x) for x in action_docs])

    # CHEMICALS / SDS
    chemicals = [
        ('Diesel Fuel #2', 'Petro-Canada', 'flammable', '68476-34-6', '500 L drum'),
        ('Portland Cement Type GU', 'Lafarge', 'general', '65997-15-1', '50 bags'),
        ('Concrete Sealer Solvent', 'Sika', 'flammable', '64742-95-6', '20 L'),
        ('Hydraulic Oil ISO 46', 'Shell Tellus', 'general', None, '200 L drum'),
        ('Acetylene Gas', 'Air Liquide', 'explosive', '74-86-2', '4 cylinders'),
        ('Oxygen Gas', 'Air Liquide', 'oxidizer', '7782-44-7', '4 cylinders'),
        ('Hydrochloric Acid 10%', 'Acme Chem', 'corrosive', '7647-01-0', '5 L'),
        ('Form Release Agent', 'BASF', 'general', None, '20 L'),
        ('Spray Paint - Marking', 'Krylon', 'flammable', None, '24 cans'),
        ('Sodium Hypochlorite (Bleach)', 'Univar', 'corrosive', '7681-52-9', '10 L'),
    ]
    chem_docs = []
    for n, m, hc, cas, qty in chemicals:
        c = Chemical(
            name=n, manufacturer=m, hazard_class=hc, cas_number=cas, quantity=qty,
            location_id=random.choice(locations)['id'] if locations else None,
            notes='SDS reviewed and on-site.'
        ).model_dump()
        chem_docs.append(c)
    await db.chemicals.insert_many([dict(x) for x in chem_docs])

    # ASSETS
    asset_seed = [
        ('CAT 320 Excavator', 'equipment', 'CAT320-2023-001', 14),
        ('Komatsu D65 Bulldozer', 'equipment', 'KOM-D65-022', 30),
        ('Manitowoc 18000 Crane', 'equipment', 'MTC-18K-08', 5),
        ('Ford F-550 Service Truck', 'vehicle', 'F550-PT-12', 60),
        ('Wacker DPU 6555 Compactor', 'equipment', 'WK-6555-04', -3),  # overdue
        ('Genie Z-45 Boom Lift', 'equipment', 'GZ45-19', 21),
        ('Stihl Concrete Saw', 'tool', 'STL-TS420-07', 45),
        ('Total Station Surveying Kit', 'tool', 'TS-LEICA-01', 90),
    ]
    asset_docs = []
    for n, t, sn, days in asset_seed:
        nxt = (today + timedelta(days=days)).date().isoformat()
        a = Asset(
            name=n, asset_type=t, serial_number=sn,
            location_id=random.choice(locations)['id'] if locations else None,
            next_inspection=nxt,
            last_inspection=(today - timedelta(days=180)).date().isoformat(),
            status='active' if days > 0 else 'maintenance',
        ).model_dump()
        asset_docs.append(a)
    await db.assets.insert_many([dict(x) for x in asset_docs])

    # CONTRACTORS
    contractor_seed = [
        ('Northern Steel Erectors Inc', 'Mark Lawson', 'mark@nse.ca', '416-555-1010', 'Structural Steel', True, 45, 200),
        ('Apex Excavation Ltd', 'Diane Walters', 'd.walters@apex.ca', '905-555-2222', 'Earthworks', True, 28, 90),
        ('Stellar Electrical Co', 'Raj Singh', 'raj@stellarelec.ca', '647-555-3333', 'Electrical', True, 12, -10),  # expired
        ('CleanSite Asbestos Removal', 'Hannah Patel', 'hannah@cleansite.ca', '416-555-4444', 'Hazmat / Asbestos', True, 6, 365),
        ('GreenScape Landscaping', 'Tom Chen', 'tom@greenscape.ca', '905-555-5555', 'Landscaping', False, 8, -45),  # not prequalified
    ]
    contractor_docs = []
    for company, contact, email, phone, trade, prequal, count, days in contractor_seed:
        exp = (today + timedelta(days=days)).date().isoformat()
        c = Contractor(
            company_name=company, contact_name=contact, email=email, phone=phone,
            trade=trade, prequalified=prequal, workers_count=count, insurance_expiry=exp,
            notes='Active on multiple jobsites.' if prequal else 'Pending prequalification review.',
        ).model_dump()
        contractor_docs.append(c)
    await db.contractors.insert_many([dict(x) for x in contractor_docs])

    return {
        'ok': True,
        'counts': {
            'risks': len(risk_docs), 'actions': len(action_docs),
            'chemicals': len(chem_docs), 'assets': len(asset_docs),
            'contractors': len(contractor_docs),
        }
    }



@api_router.get('/')
async def root():
    return {'message': 'Paneltec Safety Portal API', 'status': 'ok'}

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event('startup')
async def startup_seed():
    # Auto-seed on first run if empty
    count = await db.users.count_documents({})
    if count == 0:
        logger.info('No users found, auto-seeding demo data...')
        try:
            await seed_demo()
            logger.info('Seed complete.')
        except Exception as e:
            logger.error(f'Seed failed: {e}')
    # Always ensure extras exist (idempotent on count check)
    risk_count = await db.risks.count_documents({})
    if risk_count == 0:
        logger.info('Seeding extras (risks, actions, chemicals, assets, contractors)...')
        try:
            await seed_extras()
        except Exception as e:
            logger.error(f'Extras seed failed: {e}')

@app.on_event('shutdown')
async def shutdown_db_client():
    client.close()
