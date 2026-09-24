import asyncio, os, sys
sys.path.insert(0, '/app/backend')
os.chdir('/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
from filename_expiry import parse_filename_expiry
from display_filename import display_filename

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = c[os.environ['DB_NAME']]

    newly_parsed = 0
    still_unparseable = 0
    samples = []

    async for f in db.doc_files.find(
        {'deleted_at': None, 'expires_at': None},
        {'_id': 0, 'id': 1, 'filename': 1},
    ):
        raw = f.get('filename') or ''
        stripped = display_filename(raw) or raw
        parsed = parse_filename_expiry(stripped)
        if parsed.expires_at:
            await db.doc_files.update_one(
                {'id': f['id']},
                {'$set': {'display_name': parsed.clean_name,
                          'expires_at': parsed.expires_at}},
            )
            newly_parsed += 1
            if len(samples) < 8:
                samples.append((raw, parsed.clean_name, parsed.expires_at))
        else:
            still_unparseable += 1

    print(f'newly_parsed:      {newly_parsed}')
    print(f'still_unparseable: {still_unparseable}')
    print()
    print('=== sample newly-parsed ===')
    for r, c, e in samples:
        print(f'  {r!r}')
        print(f'    → clean={c!r}  expires_at={e}')

    total_parsed = await db.doc_files.count_documents(
        {'deleted_at': None, 'expires_at': {'$ne': None}},
    )
    total = await db.doc_files.count_documents({'deleted_at': None})
    print()
    print(f'TOTAL parsed now: {total_parsed} / {total}')

asyncio.run(main())
