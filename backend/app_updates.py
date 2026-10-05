"""Admin-only proxy to the loopback recovery updater; no Docker access here."""
import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from auth import get_current_user

router = APIRouter(prefix='/admin/app-updates', tags=['app-updates'])


def admin(user=Depends(get_current_user)):
    if user.get('role') != 'admin':
        raise HTTPException(403, 'Only administrators can update the server app')
    return user


async def call(method, path, body=None):
    token = os.environ.get('PANELTEC_UPDATER_TOKEN', '')
    if not token:
        raise HTTPException(503, 'One-time updater setup in Portainer is required')
    try:
        async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
            response = await client.request(method, 'http://127.0.0.1:8022' + path,
                                            headers={'Authorization': 'Bearer ' + token}, json=body)
        if response.status_code >= 400:
            raise HTTPException(response.status_code, response.json().get('detail', 'Updater unavailable'))
        return response.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, 'Updater is unavailable. Check its container in Portainer.')


@router.get('/status')
async def status(user=Depends(admin)):
    return await call('GET', '/status')


@router.get('/check')
async def check(user=Depends(admin)):
    return await call('GET', '/check')


class InstallBody(BaseModel):
    sha: str = Field(..., pattern=r'^[0-9a-f]{40}$')


@router.post('/install', status_code=202)
async def install(body: InstallBody, user=Depends(admin)):
    return await call('POST', '/install', {'sha': body.sha})


@router.post('/rollback', status_code=202)
async def rollback(user=Depends(admin)):
    return await call('POST', '/rollback', {})
