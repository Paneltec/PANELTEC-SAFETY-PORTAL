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

# ============== SWMS (Safe Work Method Statements) ==============
class SWMSStep(BaseModel):
    step_no: float = 1.0
    activity: str
    hazards: List[str] = []
    risk_class: int = 3  # 1-critical, 2-high, 3-moderate, 4-low
    controls: List[str] = []
    responsible: List[str] = []
    residual_risk: int = 4

class SWMS(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    high_risk_activity: str  # Mechanical Excavation, Working at Heights, Hot Work, etc.
    project_name: Optional[str] = None
    location_id: Optional[str] = None
    location_name: Optional[str] = None
    supervisor_name: Optional[str] = None
    prepared_by: Optional[str] = None
    description: Optional[str] = None
    ppe_required: List[str] = []
    plant_equipment: List[str] = []
    legislation: List[str] = []
    training_required: List[str] = []
    steps: List[Dict[str, Any]] = []
    signoffs: List[Dict[str, Any]] = []  # [{name, signature_b64, company, date}]
    status: str = 'draft'  # draft, approved, active, retired
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/swms')
async def list_swms(user=Depends(get_current_user)):
    return await db.swms.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)

@api_router.get('/swms/{sid}')
async def get_swms(sid: str, user=Depends(get_current_user)):
    s = await db.swms.find_one({'id': sid}, {'_id': 0})
    if not s: raise HTTPException(404, 'Not found')
    return s

@api_router.post('/swms')
async def create_swms(s: SWMS, user=Depends(get_current_user)):
    doc = s.model_dump()
    await db.swms.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/swms/{sid}')
async def update_swms(sid: str, s: SWMS, user=Depends(get_current_user)):
    doc = s.model_dump(); doc['id'] = sid
    await db.swms.update_one({'id': sid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/swms/{sid}')
async def delete_swms(sid: str, user=Depends(require_admin)):
    await db.swms.delete_one({'id': sid})
    return {'ok': True}

@api_router.post('/swms/{sid}/signoff')
async def signoff_swms(sid: str, body: dict, user=Depends(get_current_user)):
    signoff = {
        'name': body.get('name', user.get('name')),
        'signature_b64': body.get('signature_b64'),
        'company': body.get('company', 'Paneltec'),
        'date': now_iso(),
        'user_id': user['id'],
    }
    await db.swms.update_one({'id': sid}, {'$push': {'signoffs': signoff}})
    return signoff

class AISwmsIn(BaseModel):
    title: str
    activity: str
    description: Optional[str] = None
    location_name: Optional[str] = None

@api_router.post('/ai/swms-draft')
async def ai_swms_draft(body: AISwmsIn, user=Depends(get_current_user)):
    """AI generates a draft SWMS from a task description."""
    prompt = f"""Generate a Safe Work Method Statement (SWMS) for a civil contractor.

Title: {body.title}
High Risk Activity: {body.activity}
Location: {body.location_name or 'Construction site'}
Description: {body.description or ''}

Return a valid JSON object with this exact structure (no markdown, no commentary, just JSON):
{{
  "ppe_required": ["item1", "item2", ...],
  "plant_equipment": ["item1", ...],
  "legislation": ["WHS Act 2011", "Code of Practice ..."],
  "training_required": ["White Card", "..."],
  "steps": [
    {{
      "step_no": 1.0,
      "activity": "Setup and pre-start checks",
      "hazards": ["Hazard 1", "Hazard 2"],
      "risk_class": 2,
      "controls": ["Control 1", "Control 2"],
      "responsible": ["Supervisor", "Operator"],
      "residual_risk": 4
    }},
    ...
  ]
}}

risk_class scale: 1=Critical, 2=High, 3=Moderate, 4=Low.
Provide 5-8 sequential steps covering setup, execution, and pack-down. Be specific to civil contractor work."""

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"swms-{uuid.uuid4()}",
            system_message="You are an Australian/Canadian WHS expert helping a civil contractor draft Safe Work Method Statements. Always return only valid JSON, no commentary, no markdown code fences."
        ).with_model('openai', 'gpt-4o-mini')
        result = await chat.send_message(UserMessage(text=prompt))
        text = str(result).strip()
        if text.startswith('```'):
            text = text.split('```', 2)[1]
            if text.startswith('json'): text = text[4:]
            text = text.strip()
        import json
        data = json.loads(text)
        return data
    except Exception as e:
        logger.error(f"AI SWMS error: {e}")
        # Fallback skeleton
        return {
            'ppe_required': ['Hard Hat', 'Safety Boots', 'High-Vis Vest', 'Safety Glasses', 'Gloves'],
            'plant_equipment': ['As required by activity'],
            'legislation': ['WHS Act', 'Code of Practice: Construction Work'],
            'training_required': ['Construction Induction Card (White Card)'],
            'steps': [
                {'step_no': 1.0, 'activity': 'Site setup and pre-start inspection', 'hazards': ['Slips, trips, falls'], 'risk_class': 3, 'controls': ['Walk site', 'Toolbox talk'], 'responsible': ['Supervisor'], 'residual_risk': 4},
                {'step_no': 2.0, 'activity': f'Execute {body.activity}', 'hazards': ['Activity-specific'], 'risk_class': 2, 'controls': ['Follow SWMS', 'PPE'], 'responsible': ['Operators'], 'residual_risk': 3},
                {'step_no': 3.0, 'activity': 'Pack-down and housekeeping', 'hazards': ['Manual handling'], 'risk_class': 3, 'controls': ['Team lift'], 'responsible': ['Crew'], 'residual_risk': 4},
            ],
            '_fallback': True,
        }

# ============== ITP (Inspection & Test Plans) ==============
class ITPItem(BaseModel):
    item_no: float = 1.0
    description: str
    reference: Optional[str] = None  # spec / standard
    inspection_type: str = 'check'  # check, hold_point, witness_point, survey, test
    frequency: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    operations_by: Optional[str] = 'Paneltec'
    verification_by: Optional[str] = 'Client'
    status: str = 'pending'  # pending, in_progress, passed, failed, n_a
    completed_at: Optional[str] = None
    notes: Optional[str] = None

class ITP(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    project_name: Optional[str] = None
    location_id: Optional[str] = None
    location_name: Optional[str] = None
    discipline: str = 'civil'  # civil, structural, mechanical, electrical
    description: Optional[str] = None
    items: List[Dict[str, Any]] = []
    status: str = 'open'
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/itps')
async def list_itps(user=Depends(get_current_user)):
    return await db.itps.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)

@api_router.get('/itps/{iid}')
async def get_itp(iid: str, user=Depends(get_current_user)):
    i = await db.itps.find_one({'id': iid}, {'_id': 0})
    if not i: raise HTTPException(404, 'Not found')
    return i

@api_router.post('/itps')
async def create_itp(i: ITP, user=Depends(get_current_user)):
    doc = i.model_dump()
    await db.itps.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/itps/{iid}')
async def update_itp(iid: str, i: ITP, user=Depends(get_current_user)):
    doc = i.model_dump(); doc['id'] = iid
    await db.itps.update_one({'id': iid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/itps/{iid}')
async def delete_itp(iid: str, user=Depends(require_admin)):
    await db.itps.delete_one({'id': iid})
    return {'ok': True}

# ============== PERMITS TO WORK ==============
class Permit(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    permit_type: str = 'hot_work'  # hot_work, confined_space, excavation, working_at_heights, electrical_isolation
    project_name: Optional[str] = None
    location_id: Optional[str] = None
    location_name: Optional[str] = None
    description: str
    valid_from: str
    valid_until: str
    issued_by: Optional[str] = None
    issued_to: Optional[str] = None
    precautions: List[str] = []
    checklist: List[Dict[str, Any]] = []  # [{label, checked}]
    status: str = 'active'  # draft, active, expired, closed, cancelled
    signoffs: List[Dict[str, Any]] = []
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/permits')
async def list_permits(user=Depends(get_current_user)):
    items = await db.permits.find({}, {'_id': 0}).sort('valid_from', -1).to_list(500)
    # Auto-expire
    now = datetime.now(timezone.utc).isoformat()
    for p in items:
        if p.get('status') == 'active' and p.get('valid_until', '') < now:
            await db.permits.update_one({'id': p['id']}, {'$set': {'status': 'expired'}})
            p['status'] = 'expired'
    return items

@api_router.post('/permits')
async def create_permit(p: Permit, user=Depends(get_current_user)):
    doc = p.model_dump()
    await db.permits.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/permits/{pid}')
async def update_permit(pid: str, p: Permit, user=Depends(get_current_user)):
    doc = p.model_dump(); doc['id'] = pid
    await db.permits.update_one({'id': pid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/permits/{pid}')
async def delete_permit(pid: str, user=Depends(require_admin)):
    await db.permits.delete_one({'id': pid})
    return {'ok': True}

# ============== ENVIRONMENTAL ASPECTS ==============
class EnvAspect(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    aspect_code: str  # EM-01..EM-09
    category: str  # air_quality, noise, soil_water, flora_fauna, heritage, fuels_chemicals, community, waste, biodiversity
    title: str
    description: Optional[str] = None
    control_measures: List[str] = []
    location_id: Optional[str] = None
    location_name: Optional[str] = None
    monitoring_frequency: Optional[str] = None
    responsible: Optional[str] = None
    status: str = 'active'
    created_at: str = Field(default_factory=now_iso)

class EnvMonitoringLog(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    aspect_id: str
    aspect_title: Optional[str] = None
    reading: str  # e.g. "75 dB", "pH 7.2"
    threshold: Optional[str] = None
    status: str = 'within_limits'  # within_limits, exceeded, action_required
    notes: Optional[str] = None
    photo_b64: Optional[str] = None
    recorded_by: Optional[str] = None
    recorded_at: str = Field(default_factory=now_iso)

@api_router.get('/env/aspects')
async def list_env_aspects(user=Depends(get_current_user)):
    return await db.env_aspects.find({}, {'_id': 0}).to_list(500)

@api_router.post('/env/aspects')
async def create_env_aspect(a: EnvAspect, user=Depends(get_current_user)):
    doc = a.model_dump()
    await db.env_aspects.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/env/aspects/{aid}')
async def delete_env_aspect(aid: str, user=Depends(require_admin)):
    await db.env_aspects.delete_one({'id': aid})
    return {'ok': True}

@api_router.get('/env/logs')
async def list_env_logs(user=Depends(get_current_user)):
    return await db.env_logs.find({}, {'_id': 0}).sort('recorded_at', -1).to_list(2000)

@api_router.post('/env/logs')
async def create_env_log(l: EnvMonitoringLog, user=Depends(get_current_user)):
    doc = l.model_dump()
    doc['recorded_by'] = user.get('name')
    await db.env_logs.insert_one(doc)
    doc.pop('_id', None)
    return doc

# ============== INSURANCE POLICIES ==============
class InsurancePolicy(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    contractor_id: Optional[str] = None  # if linked to contractor; if null = own/Paneltec
    insurance_type: str  # combined_business, employers_liability, motor_vehicle, public_liability, professional_indemnity
    company: str
    policy_number: str
    coverage_amount: Optional[str] = None
    issued_date: Optional[str] = None
    expiry_date: str
    document_b64: Optional[str] = None
    notes: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/insurance')
async def list_insurance(user=Depends(get_current_user)):
    return await db.insurance.find({}, {'_id': 0}).sort('expiry_date', 1).to_list(500)

@api_router.post('/insurance')
async def create_insurance(p: InsurancePolicy, user=Depends(get_current_user)):
    doc = p.model_dump()
    await db.insurance.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/insurance/{pid}')
async def delete_insurance(pid: str, user=Depends(require_admin)):
    await db.insurance.delete_one({'id': pid})
    return {'ok': True}

# ============== AUDIT REGISTER ==============
class AuditFinding(BaseModel):
    description: str
    severity: str = 'observation'  # major_nc, minor_nc, observation, opportunity
    corrective_action: Optional[str] = None
    closed: bool = False

class Audit(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    audit_type: str = 'internal'  # internal, external, client, regulatory
    scope: Optional[str] = None
    location_id: Optional[str] = None
    location_name: Optional[str] = None
    auditor: Optional[str] = None
    planned_date: Optional[str] = None
    actual_date: Optional[str] = None
    status: str = 'planned'  # planned, in_progress, completed, cancelled
    findings: List[Dict[str, Any]] = []
    report_b64: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/audits')
async def list_audits(user=Depends(get_current_user)):
    return await db.audits.find({}, {'_id': 0}).sort('planned_date', -1).to_list(500)

@api_router.post('/audits')
async def create_audit(a: Audit, user=Depends(get_current_user)):
    doc = a.model_dump()
    await db.audits.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.put('/audits/{aid}')
async def update_audit(aid: str, a: Audit, user=Depends(get_current_user)):
    doc = a.model_dump(); doc['id'] = aid
    await db.audits.update_one({'id': aid}, {'$set': doc}, upsert=True)
    return doc

@api_router.delete('/audits/{aid}')
async def delete_audit(aid: str, user=Depends(require_admin)):
    await db.audits.delete_one({'id': aid})
    return {'ok': True}

# ============== SEED COMPLIANCE EXTRAS (SWMS/ITP/Permits/Env/Insurance/Audits + TasWater project) ==============
@api_router.post('/seed-compliance')
async def seed_compliance():
    import random
    random.seed(11)
    await db.swms.delete_many({})
    await db.itps.delete_many({})
    await db.permits.delete_many({})
    await db.env_aspects.delete_many({})
    await db.env_logs.delete_many({})
    await db.insurance.delete_many({})
    await db.audits.delete_many({})

    # Add TasWater realistic location if not present
    locations = await db.locations.find({}, {'_id': 0}).to_list(100)
    taswater = next((l for l in locations if 'Tasman' in l.get('name','')), None)
    if not taswater:
        taswater = Location(
            name='Tasman Hwy Scottsdale — WTP Sledge Track',
            address='35480-35530 Tasman Highway, Scottsdale TAS',
            project_code='PT-TW-WTP-001',
        ).model_dump()
        await db.locations.insert_one(dict(taswater))
        locations.append(taswater)

    workers = await db.workers.find({}, {'_id': 0}).to_list(100)
    today = datetime.now(timezone.utc)

    # SWMS — TasWater project examples
    swms_seed = [
        {
            'title': 'SWMS-003 — Water Main Construction & Traffic Management',
            'high_risk_activity': 'Mechanical Excavation in Road Reserve',
            'project_name': 'TasWater Tasman Hwy Scottsdale',
            'description': 'Replacement of 605m DN200 AC raw water main in and adjacent to road reserve. Covers excavation, asbestos pipe removal, traffic management.',
            'ppe_required': ['Hard Hat', 'Hi-Vis Vest (white reflective for night)', 'Safety Boots', 'Safety Glasses', 'Hearing Protection', 'P2 Dust Masks', 'Razor Shield Gloves'],
            'plant_equipment': ['Vacuum Truck', 'Excavator CAT 320', 'HDD Drill Rig', 'Dump Truck', 'Traffic Cones / Bollards'],
            'legislation': ['WHS Act 2012 (Tas)', 'WHS Regulations 2012', 'AS1742.3 Traffic Control', 'TasWater Supplement WSAA Code', 'Construction Work CoP 2013'],
            'training_required': ['White Card Construction Induction', 'TasWater Induction', 'Traffic Control Ticket', 'Class B Asbestos Awareness', 'Confined Space (if applicable)'],
            'steps': [
                {'step_no': 1.0, 'activity': 'General safety requirements & site induction', 'hazards': ['Personal injury to operator/workers'], 'risk_class': 2, 'controls': ['Current TasWater induction', 'Site-specific JSEA daily review', 'PPE per matrix'], 'responsible': ['Compliance Manager', 'Supervisor'], 'residual_risk': 4},
                {'step_no': 2.0, 'activity': 'Setting out / taking down roadwork signage', 'hazards': ['Struck by oncoming traffic'], 'risk_class': 1, 'controls': ['Verify signage per TGS', 'Hi-vis at all times', 'Traffic controllers at both ends'], 'responsible': ['Traffic Controllers'], 'residual_risk': 3},
                {'step_no': 3.0, 'activity': 'Underground asset locating', 'hazards': ['Strike on services', 'Contact electrical lines'], 'risk_class': 1, 'controls': ['DBYD lookup', 'Vacuum excavation for proving', 'Trained locator'], 'responsible': ['Supervisor', 'Asset Locator'], 'residual_risk': 3},
                {'step_no': 4.0, 'activity': 'Mechanical excavation of trench', 'hazards': ['Trench collapse', 'Falling into trench', 'Plant rollover'], 'risk_class': 1, 'controls': ['Shoring boxes >1.2m', 'Trench barriers', 'Spotter for plant', 'Daily competent person inspection'], 'responsible': ['Supervisor', 'Excavator Operator'], 'residual_risk': 3},
                {'step_no': 5.0, 'activity': 'Class B asbestos AC pipe removal', 'hazards': ['Asbestos fibre exposure'], 'risk_class': 1, 'controls': ['Wet methods', 'P2 respirators', 'Licensed removalist', 'Air monitoring', 'Decontamination'], 'responsible': ['Asbestos Supervisor'], 'residual_risk': 3},
                {'step_no': 6.0, 'activity': 'Pipe laying & connection', 'hazards': ['Manual handling', 'Crush injury'], 'risk_class': 2, 'controls': ['Mechanical lifting aids', 'Pipe slings', 'Clear communication'], 'responsible': ['Crew', 'Crane Operator'], 'residual_risk': 4},
                {'step_no': 7.0, 'activity': 'Backfill & compaction', 'hazards': ['Compactor injury', 'Noise > 85dB'], 'risk_class': 2, 'controls': ['Double hearing protection', 'Compactor pre-start'], 'responsible': ['Operator'], 'residual_risk': 4},
                {'step_no': 8.0, 'activity': 'Pack-down & site reinstatement', 'hazards': ['Residual road hazards'], 'risk_class': 3, 'controls': ['Sweep roadway', 'Remove signage in correct order'], 'responsible': ['Supervisor'], 'residual_risk': 4},
            ],
            'location_id': taswater['id'],
            'location_name': taswater['name'],
            'supervisor_name': 'Mathew Loone',
            'prepared_by': 'Patrick Monaghan',
            'status': 'active',
            'valid_from': (today - timedelta(days=14)).isoformat(),
            'valid_until': (today + timedelta(days=90)).isoformat(),
        },
        {
            'title': 'SWMS-004 — Working at Heights (Scaffold Erection)',
            'high_risk_activity': 'Working at Heights >2m',
            'project_name': 'Downtown Bridge Reconstruction',
            'description': 'Erection and use of scaffold for bridge soffit works.',
            'ppe_required': ['Hard Hat', 'Hi-Vis Vest', 'Safety Boots', 'Fall Arrest Harness', 'Lanyard'],
            'plant_equipment': ['Modular scaffold system', 'Edge protection'],
            'legislation': ['Managing Risk of Falls at Workplaces CoP 2015'],
            'training_required': ['Working at Heights ticket', 'Scaffold High Risk Work Licence'],
            'steps': [
                {'step_no': 1.0, 'activity': 'Scaffold design verification', 'hazards': ['Scaffold collapse'], 'risk_class': 1, 'controls': ['Engineer-certified design', 'Competent erector'], 'responsible': ['Scaffold Supervisor'], 'residual_risk': 3},
                {'step_no': 2.0, 'activity': 'Erection of scaffold base', 'hazards': ['Falls from height', 'Falling objects'], 'risk_class': 1, 'controls': ['Edge protection', 'Tool tethers', 'Exclusion zone'], 'responsible': ['Scaffolders'], 'residual_risk': 3},
                {'step_no': 3.0, 'activity': 'Daily inspection & tagging', 'hazards': ['Use of defective scaffold'], 'risk_class': 2, 'controls': ['Scafftag system', 'Pre-use inspection'], 'responsible': ['Site Supervisor'], 'residual_risk': 4},
                {'step_no': 4.0, 'activity': 'Working on scaffold platform', 'hazards': ['Fall from edge'], 'risk_class': 2, 'controls': ['100% tie-off above 2m', 'Toe boards'], 'responsible': ['All Workers'], 'residual_risk': 4},
                {'step_no': 5.0, 'activity': 'Dismantling', 'hazards': ['Material falling'], 'risk_class': 1, 'controls': ['Reverse erection sequence', 'Drop zone'], 'responsible': ['Scaffolders'], 'residual_risk': 3},
            ],
            'location_id': locations[1]['id'] if len(locations) > 1 else None,
            'location_name': locations[1]['name'] if len(locations) > 1 else None,
            'status': 'active',
            'valid_from': (today - timedelta(days=5)).isoformat(),
            'valid_until': (today + timedelta(days=60)).isoformat(),
        },
        {
            'title': 'SWMS-005 — Hot Work (Welding & Cutting)',
            'high_risk_activity': 'Hot Work',
            'description': 'Welding and oxy-cutting of structural steel on site.',
            'ppe_required': ['Welding Helmet', 'Leather Gloves', 'Welding Jacket', 'Safety Boots', 'Hi-Vis'],
            'plant_equipment': ['Welder', 'Oxy-acetylene set', 'Fire extinguisher (CO2 + dry chem)'],
            'legislation': ['Welding Processes CoP 2016'],
            'training_required': ['Welding ticket', 'Hot Work Permit Holder training'],
            'steps': [
                {'step_no': 1.0, 'activity': 'Hot Work Permit issued', 'hazards': ['Fire ignition'], 'risk_class': 1, 'controls': ['Permit valid', 'Combustibles removed 11m radius'], 'responsible': ['Permit Issuer'], 'residual_risk': 3},
                {'step_no': 2.0, 'activity': 'Fire watch posted', 'hazards': ['Smouldering ignition post-work'], 'risk_class': 2, 'controls': ['Fire watch 60min post-work'], 'responsible': ['Fire Watch'], 'residual_risk': 4},
                {'step_no': 3.0, 'activity': 'Welding/cutting activity', 'hazards': ['Arc flash', 'UV burns', 'Fume inhalation'], 'risk_class': 2, 'controls': ['Welding screens', 'Extraction fans'], 'responsible': ['Welder'], 'residual_risk': 4},
            ],
            'status': 'active',
            'valid_from': (today - timedelta(days=2)).isoformat(),
            'valid_until': (today + timedelta(days=30)).isoformat(),
        },
    ]
    swms_docs = []
    for s in swms_seed:
        d = SWMS(**s).model_dump()
        swms_docs.append(d)
    await db.swms.insert_many([dict(x) for x in swms_docs])

    # ITPs — TasWater inspections
    itp_seed = [
        {
            'name': 'Hydrostatic Pressure Testing — Mains & Services',
            'project_name': 'TasWater Tasman Hwy Scottsdale',
            'discipline': 'civil',
            'description': 'Per TasWater guidelines & WSA 03-2011-3.1 Water Supply Code',
            'location_id': taswater['id'],
            'location_name': taswater['name'],
            'items': [
                {'item_no': 1.0, 'description': 'Pre-test visual inspection of joints', 'reference': 'WSA 03-2011 §13', 'inspection_type': 'check', 'frequency': 'Each section', 'acceptance_criteria': 'All joints visually sound', 'operations_by': 'Paneltec', 'verification_by': 'Paneltec', 'status': 'passed'},
                {'item_no': 2.0, 'description': 'Fill pipeline & vent', 'reference': 'WSA 03-2011', 'inspection_type': 'check', 'frequency': 'Each section', 'acceptance_criteria': 'No air pockets', 'operations_by': 'Paneltec', 'verification_by': 'Paneltec', 'status': 'passed'},
                {'item_no': 3.0, 'description': 'Pressurise to 1.5× design pressure', 'inspection_type': 'hold_point', 'frequency': 'Each test', 'acceptance_criteria': 'Hold pressure 2 hours, drop ≤ 5kPa', 'operations_by': 'Paneltec', 'verification_by': 'TasWater', 'status': 'in_progress'},
                {'item_no': 4.0, 'description': 'Witness pressure decay test', 'inspection_type': 'witness_point', 'frequency': 'Each test', 'acceptance_criteria': 'TasWater witness present', 'operations_by': 'Paneltec', 'verification_by': 'TasWater', 'status': 'pending'},
                {'item_no': 5.0, 'description': 'Pressure test certificate issued', 'inspection_type': 'check', 'acceptance_criteria': 'Signed by both parties', 'operations_by': 'Paneltec', 'verification_by': 'TasWater', 'status': 'pending'},
            ],
        },
        {
            'name': 'Asphalt Reinstatement',
            'project_name': 'TasWater Tasman Hwy Scottsdale',
            'discipline': 'civil',
            'location_id': taswater['id'],
            'location_name': taswater['name'],
            'items': [
                {'item_no': 1.0, 'description': 'Subgrade preparation', 'inspection_type': 'check', 'acceptance_criteria': 'CBR ≥ 5%', 'operations_by': 'Paneltec', 'verification_by': 'Paneltec', 'status': 'passed'},
                {'item_no': 2.0, 'description': 'Sub-base compaction', 'inspection_type': 'hold_point', 'acceptance_criteria': '95% MMDD', 'operations_by': 'Paneltec', 'verification_by': 'TasWater', 'status': 'passed'},
                {'item_no': 3.0, 'description': 'Prime coat applied', 'inspection_type': 'check', 'acceptance_criteria': 'Coverage even', 'operations_by': 'Paneltec', 'verification_by': 'Paneltec', 'status': 'passed'},
                {'item_no': 4.0, 'description': 'Asphalt laid to spec thickness', 'inspection_type': 'witness_point', 'acceptance_criteria': '50mm AC10', 'operations_by': 'Paneltec', 'verification_by': 'TasWater', 'status': 'in_progress'},
                {'item_no': 5.0, 'description': 'Final survey & line marking', 'inspection_type': 'survey', 'operations_by': 'Paneltec', 'verification_by': 'TasWater', 'status': 'pending'},
            ],
        },
        {
            'name': 'Concrete Foundation Pour — Industrial Park',
            'discipline': 'civil',
            'items': [
                {'item_no': 1.0, 'description': 'Formwork inspection', 'inspection_type': 'hold_point', 'acceptance_criteria': 'Per drawing', 'operations_by': 'Paneltec', 'verification_by': 'Engineer', 'status': 'passed'},
                {'item_no': 2.0, 'description': 'Reinforcement placement', 'inspection_type': 'hold_point', 'acceptance_criteria': 'Cover ≥ 50mm', 'operations_by': 'Paneltec', 'verification_by': 'Engineer', 'status': 'passed'},
                {'item_no': 3.0, 'description': 'Concrete delivery slump test', 'inspection_type': 'test', 'acceptance_criteria': 'Slump 80±20mm', 'operations_by': 'Paneltec', 'verification_by': 'Paneltec', 'status': 'in_progress'},
                {'item_no': 4.0, 'description': '28-day cylinder strength', 'inspection_type': 'test', 'acceptance_criteria': '32 MPa min', 'operations_by': 'Lab', 'verification_by': 'Engineer', 'status': 'pending'},
            ],
        },
    ]
    itp_docs = []
    for i in itp_seed:
        d = ITP(**i).model_dump()
        itp_docs.append(d)
    await db.itps.insert_many([dict(x) for x in itp_docs])

    # PERMITS
    permit_seed = [
        {
            'permit_type': 'hot_work',
            'description': 'Oxy-cutting of redundant steel pipe brackets',
            'location_id': taswater['id'],
            'location_name': taswater['name'],
            'valid_from': today.isoformat(),
            'valid_until': (today + timedelta(hours=8)).isoformat(),
            'issued_by': 'Mathew Loone',
            'issued_to': 'John Carpenter',
            'precautions': ['Fire extinguisher within 5m', 'Fire watch 60min after', 'Combustibles removed 11m radius', 'Hot work area screened'],
            'checklist': [
                {'label': 'Combustible materials removed within 11m', 'checked': True},
                {'label': 'Fire extinguisher available', 'checked': True},
                {'label': 'Fire watch assigned', 'checked': True},
                {'label': 'SDS reviewed for materials being cut', 'checked': True},
                {'label': 'PPE inspected', 'checked': True},
            ],
            'status': 'active',
        },
        {
            'permit_type': 'excavation',
            'description': 'Trench excavation 1.8m deep for water main replacement Ch 0+200 to 0+250',
            'location_id': taswater['id'],
            'location_name': taswater['name'],
            'valid_from': (today - timedelta(days=2)).isoformat(),
            'valid_until': (today + timedelta(days=5)).isoformat(),
            'issued_by': 'Patrick Monaghan',
            'issued_to': 'Mike Rodriguez',
            'precautions': ['DBYD completed', 'Shoring boxes installed', 'Edge protection', 'Daily competent person inspection'],
            'checklist': [
                {'label': 'Dial Before You Dig (DBYD) completed', 'checked': True},
                {'label': 'Underground services visually proven via vacuum excavation', 'checked': True},
                {'label': 'Shoring or benching plan in place', 'checked': True},
                {'label': 'Safe access/egress every 7.5m', 'checked': True},
                {'label': 'Emergency rescue plan briefed', 'checked': False},
            ],
            'status': 'active',
        },
        {
            'permit_type': 'confined_space',
            'description': 'Entry into existing valve chamber for inspection',
            'location_id': taswater['id'],
            'location_name': taswater['name'],
            'valid_from': (today - timedelta(days=15)).isoformat(),
            'valid_until': (today - timedelta(days=14)).isoformat(),
            'issued_by': 'Patrick Monaghan',
            'issued_to': 'David Chen',
            'precautions': ['Gas test before entry', 'Stand-by person', 'Tripod rescue setup'],
            'checklist': [
                {'label': 'Atmospheric testing (O₂, LEL, H₂S, CO)', 'checked': True},
                {'label': 'Stand-by person posted', 'checked': True},
                {'label': 'Rescue tripod & harness in place', 'checked': True},
            ],
            'status': 'expired',
        },
        {
            'permit_type': 'working_at_heights',
            'description': 'Working on scaffold deck at Level 2 of bridge soffit',
            'location_id': locations[1]['id'] if len(locations) > 1 else None,
            'location_name': locations[1]['name'] if len(locations) > 1 else None,
            'valid_from': today.isoformat(),
            'valid_until': (today + timedelta(days=14)).isoformat(),
            'issued_by': 'Liam OConnor',
            'issued_to': 'Sarah Thompson',
            'precautions': ['Scaffold tagged green', 'Harness inspected', '100% tie-off above 2m'],
            'checklist': [
                {'label': 'Scaffold inspected & tagged today', 'checked': True},
                {'label': 'Harness & lanyard inspected', 'checked': True},
                {'label': 'Anchor points identified', 'checked': True},
                {'label': 'Rescue plan briefed', 'checked': True},
            ],
            'status': 'active',
        },
    ]
    permit_docs = []
    for p in permit_seed:
        d = Permit(**p).model_dump()
        permit_docs.append(d)
    await db.permits.insert_many([dict(x) for x in permit_docs])

    # ENVIRONMENTAL ASPECTS (EM-01 .. EM-09)
    env_seed = [
        ('EM-01', 'air_quality', 'Air Quality (Dust Control & Plant Emissions)', 'Manage dust from earthworks and emissions from plant', ['Water carts for dust suppression', 'Regular plant maintenance', 'Tarp loaded trucks'], 'Daily'),
        ('EM-02', 'air_quality', 'Prime & Bitumen', 'Manage fumes from bituminous works', ['Apply at correct temperature', 'PPE for crew', 'Avoid sensitive receptors'], 'Per pour'),
        ('EM-03', 'community', 'Community Relations', 'Manage community impact and complaints', ['Letterbox drop pre-works', 'Public complaints to TasWater CSC', 'Site signage with contact'], 'Ongoing'),
        ('EM-04', 'flora_fauna', 'Flora & Fauna', 'Protect biodiversity', ['No-go zones marked', 'Spotter for tree felling', 'Wildlife rescue plan'], 'Ongoing'),
        ('EM-05', 'heritage', 'Heritage & Archaeology', 'Protect cultural heritage', ['Unexpected finds procedure', 'Aboriginal cultural awareness'], 'Ongoing'),
        ('EM-06', 'noise', 'Noise Pollution', 'Manage construction noise to neighbours', ['Work during normal hours', 'Quieter equipment selection', 'Noise monitoring'], 'Weekly'),
        ('EM-07', 'soil_water', 'Soil Management (Inc. Contaminated Soil)', 'Prevent erosion & manage spoil', ['Silt fences', 'Stabilised site entry', 'Contaminated soil segregation'], 'Daily'),
        ('EM-08', 'fuels_chemicals', 'Storage of Fuels & Chemicals on Site', 'Prevent spills', ['Bunded storage', 'Spill kits at each site', 'SDS available'], 'Weekly'),
        ('EM-09', 'soil_water', 'Water Quality Monitoring', 'Protect waterways', ['No-discharge to waterways', 'Wash-down bay', 'pH monitoring'], 'Weekly'),
    ]
    env_docs = []
    for code, cat, title, desc, ctrl, freq in env_seed:
        a = EnvAspect(
            aspect_code=code, category=cat, title=title, description=desc,
            control_measures=ctrl, monitoring_frequency=freq,
            location_id=taswater['id'], location_name=taswater['name'],
            responsible='Site Supervisor'
        ).model_dump()
        env_docs.append(a)
    await db.env_aspects.insert_many([dict(x) for x in env_docs])

    # Environmental monitoring logs
    log_docs = []
    log_samples = [
        ('Noise Pollution', '72 dB', '75 dB (daytime limit)', 'within_limits', 'Background reading at boundary'),
        ('Noise Pollution', '83 dB', '75 dB', 'exceeded', 'Compactor in operation, residents notified'),
        ('Air Quality (Dust Control & Plant Emissions)', 'PM10 45 µg/m³', '50 µg/m³', 'within_limits', 'Water cart in use'),
        ('Water Quality Monitoring', 'pH 7.4', 'pH 6.5-8.5', 'within_limits', 'Wash-bay discharge'),
        ('Water Quality Monitoring', 'pH 9.1', 'pH 6.5-8.5', 'exceeded', 'Concrete washout — investigated, washout bin emptied'),
        ('Storage of Fuels & Chemicals on Site', 'No leaks', 'No leaks', 'within_limits', 'Weekly bund check OK'),
    ]
    for title, reading, threshold, status, notes in log_samples:
        aspect = next((a for a in env_docs if a['title'] == title), env_docs[0])
        days_ago = random.randint(0, 30)
        log_docs.append(EnvMonitoringLog(
            aspect_id=aspect['id'], aspect_title=aspect['title'],
            reading=reading, threshold=threshold, status=status, notes=notes,
            recorded_by='Site Supervisor',
            recorded_at=(today - timedelta(days=days_ago)).isoformat(),
        ).model_dump())
    await db.env_logs.insert_many([dict(x) for x in log_docs])

    # INSURANCE POLICIES (Paneltec own + on contractors)
    insurance_seed = [
        # Paneltec own
        ('combined_business', 'QBE Insurance Australia Ltd', '183A327842BPK', '$20M', 365),
        ('employers_liability', 'QBE Insurance Australia Ltd', '1HO1962502GWC', '$50M', 365),
        ('motor_vehicle', 'National Transport Insurance', '9924502', '$2M per vehicle', 200),
        ('public_liability', 'Allianz', 'PL-PT-2025-008', '$20M', 14),  # expiring soon!
        ('professional_indemnity', 'CGU', 'PI-PT-2025-002', '$5M', 60),
    ]
    insurance_docs = []
    for itype, company, polno, cov, days in insurance_seed:
        p = InsurancePolicy(
            contractor_id=None,
            insurance_type=itype, company=company, policy_number=polno,
            coverage_amount=cov,
            issued_date=(today - timedelta(days=365 - days)).date().isoformat(),
            expiry_date=(today + timedelta(days=days)).date().isoformat(),
        ).model_dump()
        insurance_docs.append(p)
    # Link insurance to existing contractors
    contractors = await db.contractors.find({}, {'_id': 0}).to_list(100)
    for i, c in enumerate(contractors[:3]):
        days = [180, -10, 30][i]
        p = InsurancePolicy(
            contractor_id=c['id'],
            insurance_type='public_liability',
            company='Various',
            policy_number=f'CTR-{c["id"][:6]}-PL',
            coverage_amount='$10M',
            issued_date=(today - timedelta(days=365)).date().isoformat(),
            expiry_date=(today + timedelta(days=days)).date().isoformat(),
        ).model_dump()
        insurance_docs.append(p)
    await db.insurance.insert_many([dict(x) for x in insurance_docs])

    # AUDITS
    audit_seed = [
        {
            'title': 'Internal WHS System Audit Q1',
            'audit_type': 'internal',
            'scope': 'Full WHS management system review',
            'location_id': taswater['id'],
            'location_name': taswater['name'],
            'auditor': 'Emily Brooks',
            'planned_date': (today - timedelta(days=20)).date().isoformat(),
            'actual_date': (today - timedelta(days=18)).date().isoformat(),
            'status': 'completed',
            'findings': [
                {'description': 'SWMS not signed by all crew before commencement on 2 occasions', 'severity': 'minor_nc', 'corrective_action': 'Supervisor verification at pre-start', 'closed': True},
                {'description': 'First aid kit at site office missing eye-wash solution', 'severity': 'observation', 'corrective_action': 'Restock from supplier', 'closed': True},
                {'description': 'Opportunity: Digitise sign-in register via QR code', 'severity': 'opportunity', 'closed': False},
            ],
        },
        {
            'title': 'TasWater Client Compliance Audit',
            'audit_type': 'client',
            'scope': 'Audit against TasWater Contractor Compliance Standards',
            'location_id': taswater['id'],
            'location_name': taswater['name'],
            'auditor': 'TasWater HSE Team',
            'planned_date': (today + timedelta(days=14)).date().isoformat(),
            'status': 'planned',
            'findings': [],
        },
        {
            'title': 'External ISO 45001 Surveillance Audit',
            'audit_type': 'external',
            'scope': 'ISO 45001:2018 Occupational Health & Safety surveillance',
            'auditor': 'SAI Global',
            'planned_date': (today - timedelta(days=90)).date().isoformat(),
            'actual_date': (today - timedelta(days=88)).date().isoformat(),
            'status': 'completed',
            'findings': [
                {'description': 'Minor: Risk register review frequency not consistently documented', 'severity': 'minor_nc', 'corrective_action': 'Monthly review cadence with sign-off', 'closed': True},
            ],
        },
        {
            'title': 'Site Inspection — Highway 401',
            'audit_type': 'internal',
            'scope': 'PPE & site setup audit',
            'location_id': locations[0]['id'] if locations else None,
            'location_name': locations[0]['name'] if locations else None,
            'auditor': 'Liam OConnor',
            'planned_date': (today + timedelta(days=3)).date().isoformat(),
            'status': 'planned',
            'findings': [],
        },
    ]
    audit_docs = []
    for a in audit_seed:
        d = Audit(**a).model_dump()
        audit_docs.append(d)
    await db.audits.insert_many([dict(x) for x in audit_docs])

    return {
        'ok': True,
        'counts': {
            'swms': len(swms_docs), 'itps': len(itp_docs), 'permits': len(permit_docs),
            'env_aspects': len(env_docs), 'env_logs': len(log_docs),
            'insurance': len(insurance_docs), 'audits': len(audit_docs),
        }
    }





# ============== DOCUMENT LIBRARY ==============
# Pre-defined categories based on Paneltec Risk & Compliance structure
DEFAULT_DOC_CATEGORIES = [
    {'slug': 'alcohol-drug', 'name': 'Alcohol & Drug Screening', 'icon': 'flask', 'color': '#8B5CF6'},
    {'slug': 'asbestos', 'name': 'Asbestos', 'icon': 'shield-alert', 'color': '#DC2626'},
    {'slug': 'audits', 'name': 'Audits', 'icon': 'clipboard-check', 'color': '#0EA5E9'},
    {'slug': 'australian-standards', 'name': 'Australian Standards', 'icon': 'book', 'color': '#0891B2'},
    {'slug': 'barriers', 'name': 'Barriers', 'icon': 'fence', 'color': '#EA580C'},
    {'slug': 'byda', 'name': 'BYDA (Before You Dig)', 'icon': 'shovel', 'color': '#CA8A04'},
    {'slug': 'calibration', 'name': 'Calibration Certificates', 'icon': 'gauge', 'color': '#0D9488'},
    {'slug': 'carbon-reduction', 'name': 'Carbon Reduction', 'icon': 'leaf', 'color': '#16A34A'},
    {'slug': 'ccf', 'name': 'CCF (Civil Contractors Federation)', 'icon': 'building', 'color': '#2563EB'},
    {'slug': 'checklists', 'name': 'Checklists', 'icon': 'list-checks', 'color': '#7C3AED'},
    {'slug': 'chemical-storage', 'name': 'Chemical Storage & Bunding', 'icon': 'flask', 'color': '#B91C1C'},
    {'slug': 'codesafe', 'name': 'CodeSafe', 'icon': 'shield', 'color': '#059669'},
    {'slug': 'committees', 'name': 'Committees & Memberships', 'icon': 'users', 'color': '#9333EA'},
    {'slug': 'competencies', 'name': 'Competencies Matrices', 'icon': 'grid', 'color': '#0284C7'},
    {'slug': 'confined-space', 'name': 'Confined Space', 'icon': 'box', 'color': '#DC2626'},
    {'slug': 'contract-mgmt', 'name': 'Contract Management Plans', 'icon': 'file-text', 'color': '#0F172A'},
    {'slug': 'electrical', 'name': 'Electrical Safety', 'icon': 'zap', 'color': '#F59E0B'},
    {'slug': 'emergency', 'name': 'Emergency Management', 'icon': 'siren', 'color': '#DC2626'},
    {'slug': 'environmental', 'name': 'Environmental Management', 'icon': 'leaf', 'color': '#16A34A'},
    {'slug': 'first-aid', 'name': 'First Aid', 'icon': 'heart-pulse', 'color': '#EF4444'},
    {'slug': 'forms', 'name': 'Forms', 'icon': 'file-text', 'color': '#6366F1'},
    {'slug': 'heights', 'name': 'Working at Heights', 'icon': 'arrow-up', 'color': '#F97316'},
    {'slug': 'hot-work', 'name': 'Hot Work', 'icon': 'flame', 'color': '#DC2626'},
    {'slug': 'incidents', 'name': 'Incident Reports', 'icon': 'alert-triangle', 'color': '#DC2626'},
    {'slug': 'inductions', 'name': 'Inductions', 'icon': 'user-check', 'color': '#0891B2'},
    {'slug': 'insurance', 'name': 'Insurance', 'icon': 'shield-check', 'color': '#2563EB'},
    {'slug': 'itp', 'name': 'ITPs (Inspection & Test Plans)', 'icon': 'clipboard-list', 'color': '#0D9488'},
    {'slug': 'jsea', 'name': 'JSEA / Risk Assessments', 'icon': 'alert-octagon', 'color': '#F59E0B'},
    {'slug': 'licences', 'name': 'Licences & Tickets', 'icon': 'award', 'color': '#CA8A04'},
    {'slug': 'manuals', 'name': 'Manuals & Procedures', 'icon': 'book-open', 'color': '#475569'},
    {'slug': 'permits', 'name': 'Permits to Work', 'icon': 'key', 'color': '#9333EA'},
    {'slug': 'plant-equipment', 'name': 'Plant & Equipment', 'icon': 'truck', 'color': '#0EA5E9'},
    {'slug': 'policies', 'name': 'Company Policies', 'icon': 'file-badge', 'color': '#1E40AF'},
    {'slug': 'ppe', 'name': 'PPE', 'icon': 'hard-hat', 'color': '#FBBF24'},
    {'slug': 'procurement', 'name': 'Procurement', 'icon': 'shopping-cart', 'color': '#7C3AED'},
    {'slug': 'rehab', 'name': 'Rehabilitation & RTW', 'icon': 'activity', 'color': '#0D9488'},
    {'slug': 'reports', 'name': 'Reports', 'icon': 'bar-chart', 'color': '#3B82F6'},
    {'slug': 'sds', 'name': 'SDS (Safety Data Sheets)', 'icon': 'flask-conical', 'color': '#B91C1C'},
    {'slug': 'site-management', 'name': 'Site Management', 'icon': 'map-pin', 'color': '#0891B2'},
    {'slug': 'subcontractors', 'name': 'Subcontractor Management', 'icon': 'briefcase', 'color': '#7C3AED'},
    {'slug': 'swms', 'name': 'SWMS', 'icon': 'shield-alert', 'color': '#EA580C'},
    {'slug': 'toolbox', 'name': 'Toolbox Talks', 'icon': 'message-square', 'color': '#10B981'},
    {'slug': 'traffic', 'name': 'Traffic Management', 'icon': 'traffic-cone', 'color': '#F97316'},
    {'slug': 'training', 'name': 'Training Records', 'icon': 'graduation-cap', 'color': '#0284C7'},
    {'slug': 'whs-acts', 'name': 'WHS Acts & Regulations', 'icon': 'scale', 'color': '#1E40AF'},
    {'slug': 'uncategorized', 'name': 'Uncategorized', 'icon': 'folder', 'color': '#64748B'},
]

class DocCategory(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    slug: str
    name: str
    icon: str = 'folder'
    color: str = '#64748B'
    created_at: str = Field(default_factory=now_iso)

class Document(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    category_slug: str = 'uncategorized'
    file_type: str = 'unknown'  # pdf, docx, xlsx, pptx, image, txt, other
    mime_type: Optional[str] = None
    size_bytes: int = 0
    content_b64: Optional[str] = None  # base64 encoded file content (data: prefix)
    ai_summary: Optional[str] = None
    ai_tags: List[str] = []
    ai_doc_type: Optional[str] = None  # SWMS, Policy, Procedure, Form, Permit, ITP, SDS, Standard, etc.
    is_form: bool = False
    extracted_fields: List[Dict[str, Any]] = []
    uploaded_by: Optional[str] = None
    description: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

@api_router.get('/doc-categories')
async def list_doc_categories(user=Depends(get_current_user)):
    items = await db.doc_categories.find({}, {'_id': 0}).to_list(200)
    if not items:
        # Auto-seed on first call
        for c in DEFAULT_DOC_CATEGORIES:
            doc = DocCategory(**c).model_dump()
            await db.doc_categories.insert_one(doc)
        items = await db.doc_categories.find({}, {'_id': 0}).to_list(200)
    # Add document counts
    docs = await db.documents.find({}, {'_id': 0, 'category_slug': 1}).to_list(5000)
    counts = {}
    for d in docs:
        slug = d.get('category_slug', 'uncategorized')
        counts[slug] = counts.get(slug, 0) + 1
    for c in items:
        c['doc_count'] = counts.get(c['slug'], 0)
    return items

@api_router.post('/doc-categories')
async def create_doc_category(c: DocCategory, user=Depends(require_admin)):
    doc = c.model_dump()
    await db.doc_categories.insert_one(doc)
    doc.pop('_id', None)
    return doc

@api_router.delete('/doc-categories/{cid}')
async def delete_doc_category(cid: str, user=Depends(require_admin)):
    await db.doc_categories.delete_one({'id': cid})
    return {'ok': True}

@api_router.get('/documents')
async def list_documents(category: Optional[str] = None, search: Optional[str] = None,
                         user=Depends(get_current_user)):
    q = {}
    if category and category != 'all':
        q['category_slug'] = category
    if search:
        q['$or'] = [
            {'name': {'$regex': search, '$options': 'i'}},
            {'ai_tags': {'$regex': search, '$options': 'i'}},
            {'ai_summary': {'$regex': search, '$options': 'i'}},
        ]
    # Don't return content_b64 in list view (heavy)
    items = await db.documents.find(q, {'_id': 0, 'content_b64': 0}).sort('created_at', -1).to_list(1000)
    return items

@api_router.get('/documents/{did}')
async def get_document(did: str, user=Depends(get_current_user)):
    d = await db.documents.find_one({'id': did}, {'_id': 0})
    if not d: raise HTTPException(404, 'Not found')
    return d

@api_router.post('/documents')
async def create_document(d: Document, user=Depends(get_current_user)):
    doc = d.model_dump()
    doc['uploaded_by'] = user.get('name')
    await db.documents.insert_one(doc)
    # Return without heavy content
    doc.pop('_id', None)
    doc.pop('content_b64', None)
    return doc

@api_router.put('/documents/{did}')
async def update_document(did: str, body: dict, user=Depends(get_current_user)):
    allowed = {k: v for k, v in body.items() if k in ('name', 'category_slug', 'description', 'ai_summary', 'ai_tags', 'ai_doc_type', 'is_form', 'extracted_fields')}
    await db.documents.update_one({'id': did}, {'$set': allowed})
    d = await db.documents.find_one({'id': did}, {'_id': 0, 'content_b64': 0})
    return d

@api_router.delete('/documents/{did}')
async def delete_document(did: str, user=Depends(get_current_user)):
    await db.documents.delete_one({'id': did})
    return {'ok': True}

# AI classifier
class AIClassifyIn(BaseModel):
    filename: str
    content_b64: Optional[str] = None  # data: prefix or raw base64
    text_excerpt: Optional[str] = None  # if client extracted text already
    file_type: Optional[str] = None

def _detect_filetype(name: str, mime: Optional[str] = None) -> str:
    n = name.lower()
    if n.endswith('.pdf'): return 'pdf'
    if n.endswith('.docx') or n.endswith('.doc'): return 'docx'
    if n.endswith('.xlsx') or n.endswith('.xls') or n.endswith('.csv'): return 'xlsx'
    if n.endswith('.pptx') or n.endswith('.ppt'): return 'pptx'
    if any(n.endswith(e) for e in ('.png', '.jpg', '.jpeg', '.webp', '.gif')): return 'image'
    if n.endswith('.txt') or n.endswith('.md'): return 'txt'
    return 'other'

def _extract_text_from_b64(content_b64: str, file_type: str) -> str:
    """Best-effort text extraction from a base64 file."""
    try:
        # Strip data: prefix
        if ',' in content_b64:
            content_b64 = content_b64.split(',', 1)[1]
        raw = base64.b64decode(content_b64)
        if file_type == 'txt':
            return raw.decode('utf-8', errors='ignore')[:8000]
        if file_type == 'docx':
            try:
                from docx import Document as DocxDoc
                buf = io.BytesIO(raw)
                d = DocxDoc(buf)
                txt = []
                for p in d.paragraphs:
                    if p.text.strip(): txt.append(p.text.strip())
                for t in d.tables[:20]:
                    for r in t.rows[:20]:
                        for c in r.cells:
                            if c.text.strip(): txt.append(c.text.strip())
                return '\n'.join(txt)[:8000]
            except Exception as e:
                logger.warning(f"docx extract failed: {e}")
                return ''
        if file_type == 'pdf':
            try:
                # Lightweight: try pypdf if available, else skip
                try:
                    from pypdf import PdfReader
                except ImportError:
                    return ''
                buf = io.BytesIO(raw)
                reader = PdfReader(buf)
                txt = []
                for p in reader.pages[:10]:
                    try: txt.append(p.extract_text() or '')
                    except: pass
                return '\n'.join(txt)[:8000]
            except Exception as e:
                logger.warning(f"pdf extract failed: {e}")
                return ''
        if file_type == 'xlsx':
            try:
                from openpyxl import load_workbook
                buf = io.BytesIO(raw)
                wb = load_workbook(buf, read_only=True, data_only=True)
                txt = []
                for sh in wb.sheetnames[:5]:
                    ws = wb[sh]
                    txt.append(f"# Sheet: {sh}")
                    for row in ws.iter_rows(max_row=50, values_only=True):
                        cells = [str(c) for c in row if c is not None]
                        if cells: txt.append(' | '.join(cells))
                return '\n'.join(txt)[:8000]
            except Exception as e:
                logger.warning(f"xlsx extract failed: {e}")
                return ''
        return ''
    except Exception as e:
        logger.warning(f"extract_text error: {e}")
        return ''

@api_router.post('/ai/classify-document')
async def ai_classify_document(body: AIClassifyIn, user=Depends(get_current_user)):
    """AI classifies a document into a category, generates tags + summary, detects if it's a form."""
    file_type = body.file_type or _detect_filetype(body.filename)
    text = body.text_excerpt or ''
    if not text and body.content_b64:
        text = _extract_text_from_b64(body.content_b64, file_type)

    # Build category catalog for the AI
    cat_list = '\n'.join([f"- {c['slug']}: {c['name']}" for c in DEFAULT_DOC_CATEGORIES])

    prompt = f"""You are a document classification assistant for a civil contractor's risk & compliance library.

Filename: {body.filename}
File type: {file_type}

Available categories (use the slug):
{cat_list}

Document text excerpt (first 8000 chars):
\"\"\"
{text[:7500] if text else '(no text extracted — classify based on filename only)'}
\"\"\"

Return ONLY a valid JSON object with this structure (no markdown, no commentary):
{{
  "category_slug": "one-of-the-slugs-above",
  "doc_type": "Policy|Procedure|SWMS|Permit|ITP|Form|Checklist|Risk Assessment|SDS|Standard|Manual|Report|Certificate|Audit|Training Record|Other",
  "summary": "2-3 sentence summary of what this document is about",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "is_form": true_or_false_whether_this_is_a_fillable_form_or_checklist,
  "extracted_fields": [
    {{"label": "Field label from form", "type": "text|textarea|date|number|select|checkbox|signature|photo", "required": true_or_false}},
    ...
  ]
}}

Only include extracted_fields if is_form is true. Extract realistic form fields if you can identify them in the text. Be concise."""

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"doc-classify-{uuid.uuid4()}",
            system_message="You classify civil-contractor risk & compliance documents. Return only valid JSON, no commentary, no markdown code fences."
        ).with_model('openai', 'gpt-4o-mini')
        result = await chat.send_message(UserMessage(text=prompt))
        raw = str(result).strip()
        if raw.startswith('```'):
            raw = raw.split('```', 2)[1]
            if raw.startswith('json'): raw = raw[4:]
            raw = raw.strip()
        import json
        data = json.loads(raw)
        # Validate category exists
        valid_slugs = {c['slug'] for c in DEFAULT_DOC_CATEGORIES}
        if data.get('category_slug') not in valid_slugs:
            data['category_slug'] = 'uncategorized'
        return data
    except Exception as e:
        logger.error(f"AI classify error: {e}")
        # Heuristic fallback based on filename
        name_l = body.filename.lower()
        guess_slug = 'uncategorized'
        for c in DEFAULT_DOC_CATEGORIES:
            kw = c['name'].lower().split()[0]
            if kw in name_l:
                guess_slug = c['slug']; break
        return {
            'category_slug': guess_slug,
            'doc_type': 'Other',
            'summary': f"Document {body.filename} — automatic classification unavailable, please review.",
            'tags': [file_type],
            'is_form': False,
            'extracted_fields': [],
            '_fallback': True,
        }

@api_router.post('/documents/{did}/to-template')
async def doc_to_template(did: str, user=Depends(require_admin)):
    """Convert a classified form document into a fillable form template."""
    d = await db.documents.find_one({'id': did}, {'_id': 0})
    if not d: raise HTTPException(404, 'Not found')
    if not d.get('extracted_fields'):
        raise HTTPException(400, 'No extracted fields — run AI classify first or document is not a form')

    tpl = FormTemplate(
        name=d['name'].rsplit('.', 1)[0],
        description=f"Auto-generated from document: {d['name']}",
        category='general',
        fields=[{'id': f"f{i+1}", **f} for i, f in enumerate(d['extracted_fields'])],
    ).model_dump()
    await db.form_templates.insert_one(tpl)
    tpl.pop('_id', None)
    return tpl



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
    count = await db.users.count_documents({})
    if count == 0:
        logger.info('No users found, auto-seeding demo data...')
        try:
            await seed_demo()
            logger.info('Seed complete.')
        except Exception as e:
            logger.error(f'Seed failed: {e}')
    risk_count = await db.risks.count_documents({})
    if risk_count == 0:
        logger.info('Seeding extras (risks, actions, chemicals, assets, contractors)...')
        try:
            await seed_extras()
        except Exception as e:
            logger.error(f'Extras seed failed: {e}')
    swms_count = await db.swms.count_documents({})
    if swms_count == 0:
        logger.info('Seeding compliance (SWMS, ITPs, Permits, Env, Insurance, Audits)...')
        try:
            await seed_compliance()
        except Exception as e:
            logger.error(f'Compliance seed failed: {e}')

@app.on_event('shutdown')
async def shutdown_db_client():
    client.close()
