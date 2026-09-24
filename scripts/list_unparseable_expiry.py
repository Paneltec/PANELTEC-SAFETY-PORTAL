import asyncio, os, sys, json
sys.path.insert(0, '/app/backend')
os.chdir('/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
from filename_expiry import parse_filename_expiry
from display_filename import display_filename

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = c[os.environ['DB_NAME']]

    # Build a lookup of folder_id -> path (using breadcrumb heuristic:
    # walk parent chain).
    folders = {}
    async for f in db.doc_folders.find({}, {'_id': 0, 'id': 1, 'name': 1, 'parent_id': 1}):
        folders[f['id']] = f

    def folder_path(fid):
        if not fid: return '/'
        parts = []
        cur = fid
        seen = set()
        while cur and cur not in seen:
            seen.add(cur)
            row = folders.get(cur)
            if not row: break
            parts.append(row['name'])
            cur = row.get('parent_id')
        return '/' + '/'.join(reversed(parts))

    unparseable = []
    async for f in db.doc_files.find(
        {'deleted_at': None,
         'filename': {'$regex': 'EXP|Exp', '$options': 'i'}},
        {'_id': 0, 'id': 1, 'filename': 1, 'folder_id': 1,
         'expires_at': 1, 'display_name': 1},
    ):
        if f.get('expires_at') is not None:
            continue
        # Confirm it's genuinely unparseable through our helper
        stripped = display_filename(f['filename']) or f['filename']
        parsed = parse_filename_expiry(stripped)
        if parsed.expires_at is None:
            unparseable.append({
                'id': f['id'],
                'filename': f['filename'],
                'display_after_hex_strip': stripped,
                'folder_id': f.get('folder_id'),
                'folder_path': folder_path(f.get('folder_id')),
            })

    with open('/app/memory/v58_13_132mg_unparseable_expiry.json', 'w') as fp:
        json.dump(unparseable, fp, indent=2)

    print(f'unparseable count: {len(unparseable)}')
    print(f'saved to: /app/memory/v58_13_132mg_unparseable_expiry.json')
    print()
    print('sample (first 10):')
    for u in unparseable[:10]:
        print(f"  {u['filename']!r}")
        print(f"    folder: {u['folder_path']}")

asyncio.run(main())
