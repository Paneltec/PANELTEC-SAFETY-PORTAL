"""Round-trip test for uploaded-file export/restore using an in-memory
stand-in for Mongo/GridFS (no database needed)."""
import asyncio, io, json, os, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test")
from bson import ObjectId
import backup_service as bs


class Coll:
    def __init__(self): self.rows = []
    def find(self, q=None, proj=None):
        rows = list(self.rows)
        async def gen():
            for r in rows: yield r
        return gen()
    async def count_documents(self, q): return len(self.rows)
    async def delete_many(self, q): self.rows.clear()
    async def find_one(self, q, proj=None):
        return next((r for r in self.rows if r.get("_id") == q.get("_id")), None)
    async def insert_one(self, r): self.rows.append(dict(r))
    async def insert_many(self, rs, ordered=True): self.rows.extend(dict(r) for r in rs)
    async def update_one(self, q, u):
        for r in self.rows:
            if r["_id"] == q["_id"]: r.update(u["$set"])


class DB(dict):
    def __getitem__(self, k):
        if k not in self: super().__setitem__(k, Coll())
        return super().__getitem__(k)
    def __getattr__(self, k): return self[k]


class GridOut:
    def __init__(self, data): self.chunks = [data[i:i+7] for i in range(0, len(data), 7)]
    async def readchunk(self): return self.chunks.pop(0) if self.chunks else b""


class GridIn:
    def __init__(self, db, b, fid, filename, metadata):
        self.db, self.b, self.fid, self.filename, self.md, self.buf = db, b, fid, filename, metadata, bytearray()
    async def write(self, d): self.buf += d
    async def close(self):
        self.db[f"{self.b}.files"].rows.append({"_id": self.fid, "filename": self.filename, "metadata": self.md, "length": len(self.buf)})
        self.db[f"{self.b}.chunks"].rows.append({"files_id": self.fid, "data": bytes(self.buf)})


class Bucket:
    def __init__(self, db, bucket_name="fs"): self.db, self.b = db, bucket_name
    async def open_download_stream(self, fid):
        for c in self.db[f"{self.b}.chunks"].rows:
            if c["files_id"] == fid: return GridOut(c["data"])
        raise KeyError(fid)
    def open_upload_stream_with_id(self, fid, filename, metadata=None):
        return GridIn(self.db, self.b, fid, filename, metadata)


def test_roundtrip(monkeypatch):
    monkeypatch.setattr(bs, "AsyncIOMotorGridFSBucket", Bucket)
    src = DB()
    fid1, fid2 = ObjectId(), ObjectId()
    data1, data2 = os.urandom(50_000), b"%PDF-1.4 hello"
    src["upload_storage.files"].rows += [
        {"_id": fid1, "filename": "a.png", "metadata": {"key": "photos/a.png"}, "length": len(data1)},
        {"_id": fid2, "filename": "b.pdf", "metadata": {"key": "docs/b.pdf"}, "length": len(data2)},
    ]
    src["upload_storage.chunks"].rows += [{"files_id": fid1, "data": data1}, {"files_id": fid2, "data": data2}]
    src["bk_fs.files"].rows.append({"_id": ObjectId()})   # must be skipped
    src["bk_fs.chunks"]
    collections = list(src.keys())

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        z.writestr("mongo/orgs.json", json.dumps([{"id": "o1", "name": "Paneltec"}]))
        summary = asyncio.run(bs._export_gridfs_buckets(z, collections, src))
        z.writestr("manifest.json", json.dumps({"app": "paneltec-hub", "gridfs": summary}))
    assert summary == {"upload_storage": {"files": 2, "bytes": len(data1) + len(data2)}}

    names = zipfile.ZipFile(io.BytesIO(buf.getvalue())).namelist()
    assert f"gridfs/upload_storage/{fid1}" in names and "gridfs/upload_storage.json" in names
    assert not any(n.startswith("gridfs/bk_fs") for n in names)

    # Restore into a fresh DB via the real _run_restore (extracted from install()).
    dst = DB()
    monkeypatch.setattr(bs, "_db", dst)
    captured = {}
    class App:
        state = type("S", (), {})()
        def on_event(self, *a, **k): return lambda f: f
        def include_router(self, *a, **k): pass
    # install() defines _run_restore in a closure; grab it via the route it registers.
    import fastapi
    orig = fastapi.APIRouter.post
    def fake_post(self, path, **kw):
        def deco(fn):
            if path == "/restore": captured["restore"] = fn
            return fn
        return deco
    monkeypatch.setattr(fastapi.APIRouter, "post", fake_post)
    monkeypatch.setattr(fastapi.APIRouter, "get", lambda self, *a, **k: (lambda f: f))
    monkeypatch.setattr(fastapi.APIRouter, "delete", lambda self, *a, **k: (lambda f: f))
    monkeypatch.setattr(fastapi.APIRouter, "put", lambda self, *a, **k: (lambda f: f))
    monkeypatch.setattr(fastapi.APIRouter, "patch", lambda self, *a, **k: (lambda f: f))
    bs.install(App(), dst, lambda: None)
    restore = captured["restore"]

    class Upload:
        filename = "snap.zip"
        file = io.BytesIO(buf.getvalue())
    res = asyncio.run(restore(file=Upload(), mode="replace", confirm="RESTORE", background=False))
    byname = {c["collection"]: c for c in res["collections"]}
    assert byname["orgs"]["status"] == "replaced"
    f = byname["upload_storage (files)"]
    assert f["status"] == "replaced" and f["rows_in_zip"] == 2 and f["rows_after"] == 2, f
    got = {c["files_id"]: c["data"] for c in dst["upload_storage.chunks"].rows}
    assert got[fid1] == data1 and got[fid2] == data2          # same bytes, same ids
    assert dst["upload_storage.files"].rows[0]["metadata"]["key"] in ("photos/a.png", "docs/b.pdf")
