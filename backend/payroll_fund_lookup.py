"""Official APRA USI/product register lookup. No member details are transmitted."""
import asyncio
import re
import time
from datetime import datetime, timezone
from urllib.request import urlopen
from fastapi import HTTPException
URL='https://superfundlookup.gov.au/Tools/DownloadUsiList?download=usi'
_cache=None
_cached_at=0
_lock=asyncio.Lock()
def parse_register(text):
    rows=[]
    for line in text.splitlines():
        if len(line)<481 or not line[:11].isdigit():continue
        rows.append({'abn':line[:11].strip(),'fund_name':line[12:213].strip(),'usi':line[213:234].strip().upper(),'product_name':line[234:435].strip(),'restricted':line[435:460].strip()=='Y','from_date':line[460:471].strip(),'to_date':line[471:482].strip()})
    if not rows:raise ValueError('Official USI register format not recognised')
    return rows

def fetch():
    with urlopen(URL,timeout=20) as response:
        raw=response.read(4000001)
        if len(raw)>4000000:raise ValueError('USI register exceeds size limit')
    return parse_register(raw.decode('utf-8-sig'))

def normal(value):return re.sub(r'[^a-z0-9]','',value.casefold())
def match(rows,usi,name):
    matches=[r for r in rows if r['usi']==usi.strip().upper()]
    if not matches:return {'status':'not_found','matches':[]}
    today=datetime.now(timezone.utc).date().isoformat()
    current=[r for r in matches if (not r['from_date'] or r['from_date']<=today) and (not r['to_date'] or r['to_date']>=today)]
    if not current:return {'status':'inactive','matches':matches}
    matches=current
    # Exact normalised fund or product name only; never approve a fuzzy match.
    matched=bool(name.strip()) and any(normal(name) in (normal(r['fund_name']),normal(r['product_name'])) for r in matches)
    return {'status':'matched' if matched else 'name_mismatch','matches':matches}
async def lookup(usi,name):
    global _cache,_cached_at
    async with _lock:
        if _cache is None or time.time()-_cached_at>3600:
            try:_cache=await asyncio.to_thread(fetch);_cached_at=time.time()
            except Exception:raise HTTPException(503,'Official fund register is unavailable. No fund match has been verified; try again later.')
    return {**match(_cache,usi,name),'source':URL,'checked_at':datetime.now(timezone.utc).isoformat(),'note':'Checks fund/product identity only, not employee membership or contribution acceptance.'}
