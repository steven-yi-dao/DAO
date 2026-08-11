"""FastAPI upload and job API.

One request uploads a file: the bytes stream to /data, get renamed into place,
and only then does a QUEUED row appear. That replaces the old
create → presigned PUT → submit sequence, and with it every failure mode where
a row and its object disagreed about what had actually been stored.
"""

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from . import config, db, storage

log = logging.getLogger("whisperx.api")

CHUNK = 1024 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    config.ensure_dirs()
    conn = db.connect()
    db.init(conn)
    conn.close()
    yield


app = FastAPI(title="WhisperX transcription", lifespan=lifespan)


def get_conn():
    """A fresh connection per request. SQLite connections aren't safe to share
    across the threadpool, and opening one is cheap."""
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


# The SPA reads `message` off error bodies, so normalise FastAPI's `detail`.
@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"message": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=400, content={"message": "Invalid request.", "detail": exc.errors()})


def _require(conn, job_id: str):
    row = db.get(conn, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return row


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/jobs", status_code=201)
async def create_job(file: UploadFile = File(...), conn=Depends(get_conn)):
    if not storage.is_allowed(file.filename or ""):
        raise HTTPException(status_code=400, detail=storage.UNSUPPORTED_FORMAT)

    job_id = str(uuid.uuid4())
    stored_name = storage.safe_name(file.filename or "")
    tmp = storage.new_tmp_path()

    # Count as we stream: Content-Length is client-supplied, so the only honest
    # limit is the one enforced against the bytes actually written.
    size = 0
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(CHUNK):
                size += len(chunk)
                if size > config.MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=storage.TOO_LARGE)
                out.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="File is empty.")
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

    try:
        storage.finalize(tmp, job_id, stored_name)
        row = db.insert(conn, job_id, file.filename or stored_name, stored_name, size)
    except Exception:
        storage.delete_audio(job_id)
        tmp.unlink(missing_ok=True)
        raise

    log.info("queued job %s (%s, %d bytes)", job_id, stored_name, size)
    return db.to_api(row)


@app.get("/api/jobs")
def list_jobs(limit: int = Query(100, ge=1, le=200), conn=Depends(get_conn)):
    return {"jobs": [db.to_api(r) for r in db.list_recent(conn, limit)]}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, conn=Depends(get_conn)):
    return db.to_api(_require(conn, job_id))


@app.get("/api/jobs/{job_id}/transcript")
def get_transcript(job_id: str, conn=Depends(get_conn)):
    row = _require(conn, job_id)
    if row["status"] != db.DONE:
        raise HTTPException(status_code=409, detail="Transcript is not ready yet.")
    path = config.transcript_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Transcript file is missing.")
    return FileResponse(path, media_type="application/json")


@app.get("/api/jobs/{job_id}/log")
def get_log(job_id: str, conn=Depends(get_conn)):
    _require(conn, job_id)
    path = config.log_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="No log for this job yet.")
    return FileResponse(path, media_type="text/plain")


@app.post("/api/jobs/{job_id}/retry")
def retry_job(job_id: str, conn=Depends(get_conn)):
    row = _require(conn, job_id)
    if row["status"] != db.ERROR:
        raise HTTPException(status_code=409, detail="Only failed jobs can be retried.")
    if row["audio_deleted"]:
        raise HTTPException(status_code=409, detail="Source audio was deleted — upload the file again.")
    if not db.retry(conn, job_id):
        raise HTTPException(status_code=409, detail="Job is no longer retryable.")
    return db.to_api(db.get(conn, job_id))


@app.delete("/api/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, conn=Depends(get_conn)):
    row = _require(conn, job_id)
    if row["status"] == db.RUNNING:
        raise HTTPException(status_code=409, detail="Job is running — wait for it to finish.")
    db.delete(conn, job_id)
    storage.delete_all(job_id)
    return None
