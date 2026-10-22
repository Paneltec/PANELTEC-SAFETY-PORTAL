"""Read-only verification delegated to the agent that delivered this snapshot."""
from datetime import datetime, timezone
import time
from nas_ops_service import enqueue_op, wait_for_result

async def verify_nas_snapshot(db, snap):
    started = time.monotonic()
    sid = snap['id']
    async def pending(detail):
        await db.bk_snapshots.update_one({'id': sid}, {'$set': {'verification_state': 'pending', 'verification_message': detail}})
        return {'snapshot_id': sid, 'ok': False, 'pending': True, 'source': 'nas', 'checks': [], 'detail': detail}

    report = await db.bk_agent_logs.find_one(
        {'snapshot_id': sid, 'status': 'ok', 'bytes_written': {'$gte': 1000000}},
        {'_id': 0, 'agent_id': 1}, sort=[('received_at', -1)])
    if not report or not report.get('agent_id'):
        return await pending('Verification pending: no delivery agent is recorded for this snapshot.')
    if not snap.get('sha256') or not snap.get('size'):
        return await pending('Verification pending: this snapshot has no original checksum or size to compare.')
    try:
        op = await enqueue_op('verify_backup', sid, agent_id=report['agent_id'])
        settled = await wait_for_result(op['id'], timeout_s=95)
    except RuntimeError:
        return await pending('Verification pending: the secure NAS agent connection needs configuration. No backup was changed.')
    if settled.get('status') != 'done':
        return await pending('Verification pending: the NAS agent did not complete the check. Ensure it is online and restart the backup agent in UGREEN Docker to load the latest version.')
    result = settled.get('result') or {}
    if not result.get('available'):
        return await pending('Verification pending: the agent could not find this ZIP in its backup folder. Check its location on UGREEN NAS.')
    checks = result.get('checks')
    if result.get('snapshot_id') != sid or not isinstance(checks, list) or not checks or any(not isinstance(c, dict) or not isinstance(c.get('ok'), bool) for c in checks):
        return await pending('Verification pending: the NAS agent returned an incomplete verification result.')
    checks = checks + [
        {'name': 'SHA256 integrity', 'ok': result.get('sha256') == snap['sha256'], 'detail': 'NAS file checksum compared with the original backup'},
        {'name': 'Archive size', 'ok': result.get('size') == snap['size'], 'detail': 'NAS file size compared with the original backup'},
    ]
    ok = all(c['ok'] for c in checks)
    now = datetime.now(timezone.utc).isoformat()
    await db.bk_snapshots.update_one({'id': sid}, {'$set': {
        'verification_state': 'verified' if ok else 'failed', 'verification_message': '',
        'last_verified_at': now, 'last_verified_ok': ok, 'last_verified_source': 'nas',
        'last_verified_summary': f"{sum(c['ok'] for c in checks)}/{len(checks)} NAS checks passed",
    }})
    return {'snapshot_id': sid, 'ok': ok, 'pending': False, 'source': 'nas', 'verified_at': now,
            'duration_ms': int((time.monotonic()-started)*1000), 'checks': checks}
