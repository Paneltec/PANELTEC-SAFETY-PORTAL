from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Any, Dict
import uuid
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

@app.on_event('shutdown')
async def shutdown_db_client():
    client.close()
