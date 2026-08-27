"""SQLite job store.

This table *is* the queue. There is no Redis, SQS, or Celery — one worker
claims the oldest QUEUED row inside a transaction, which is all the mutual
exclusion a single-server, one-job-at-a-time product needs.

Two processes hold the file open (the API inserts and reads, the worker claims
and updates), so WAL plus a busy timeout is what keeps them from tripping over
each other.
"""

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config

QUEUED = "QUEUED"
RUNNING = "RUNNING"
DONE = "DONE"
ERROR = "ERROR"
STATUSES = (QUEUED, RUNNING, DONE, ERROR)

# Which post-alignment treatment the job asked for. "standard" is WhisperX on
# its own; "vad" is BetterTranscribe, the experimental silero-vad boundary
# correction in app/vad.py.
PIPELINE_STANDARD = "standard"
PIPELINE_VAD = "vad"
PIPELINES = (PIPELINE_STANDARD, PIPELINE_VAD)

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  file_name     TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  duration_sec  REAL,
  status        TEXT    NOT NULL CHECK (status IN ('QUEUED','RUNNING','DONE','ERROR')),
  pipeline      TEXT    NOT NULL DEFAULT 'standard',
  attempt       INTEGER NOT NULL DEFAULT 1,
  language      TEXT,
  segment_count INTEGER,
  error_msg     TEXT,
  audio_deleted INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  started_at    TEXT
);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS jobs_recent ON jobs (created_at DESC);
"""


def now_iso() -> str:
    """Microsecond precision, because created_at is both the queue's FIFO order
    and the SPA's display order. At second resolution two uploads in the same
    second tie, and the tiebreaker is a random UUID."""
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def connect(path: Path | None = None) -> sqlite3.Connection:
    # check_same_thread=False because a FastAPI request can open the connection
    # on a threadpool thread and use it from the event loop. Each connection is
    # still owned by exactly one request (or the worker) and never shared
    # concurrently, so the guard is redundant here rather than protective.
    conn = sqlite3.connect(
        str(path or config.DB_PATH), isolation_level=None, timeout=10, check_same_thread=False
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    _migrate(conn)


def _migrate(conn: sqlite3.Connection) -> None:
    """Bring an existing table up to SCHEMA.

    SCHEMA is CREATE TABLE IF NOT EXISTS, so it does nothing at all to the live
    /data/jobs.db - a column added there only ever reaches a fresh database.
    Every additive change needs a line here too. Both processes call init() on
    startup, so this has to stay idempotent.
    """
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(jobs)")}
    if "pipeline" not in columns:
        conn.execute(
            "ALTER TABLE jobs ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'standard'"
        )


def to_api(row: sqlite3.Row) -> dict:
    """The JSON the SPA consumes. Camel-cased to match the existing frontend
    types; `model` and `diarize` are gone with the fixed product config."""
    return {
        "jobId": row["id"],
        "fileName": row["file_name"],
        "sizeBytes": row["size_bytes"],
        "durationSec": row["duration_sec"],
        "status": row["status"],
        "pipeline": row["pipeline"],
        "attempt": row["attempt"],
        "language": row["language"],
        "segmentCount": row["segment_count"],
        "errorMsg": row["error_msg"],
        "audioDeleted": bool(row["audio_deleted"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


# ---- writes -----------------------------------------------------------------


def insert(
    conn: sqlite3.Connection,
    job_id: str,
    file_name: str,
    stored_name: str,
    size_bytes: int,
    pipeline: str = PIPELINE_STANDARD,
) -> sqlite3.Row:
    """Called only after the upload has been renamed into place, so a QUEUED row
    can never point at a partial file."""
    ts = now_iso()
    conn.execute(
        "INSERT INTO jobs (id, file_name, stored_name, size_bytes, status, pipeline, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (job_id, file_name, stored_name, size_bytes, QUEUED, pipeline, ts, ts),
    )
    return get(conn, job_id)


def claim_next(conn: sqlite3.Connection) -> sqlite3.Row | None:
    """Take the oldest QUEUED job. BEGIN IMMEDIATE takes the write lock up front
    so the select and the update can't interleave with another claimer."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT id FROM jobs WHERE status = ? ORDER BY created_at LIMIT 1", (QUEUED,)
        ).fetchone()
        if row is None:
            conn.execute("ROLLBACK")
            return None

        ts = now_iso()
        cur = conn.execute(
            "UPDATE jobs SET status = ?, started_at = ?, updated_at = ? WHERE id = ? AND status = ?",
            (RUNNING, ts, ts, row["id"], QUEUED),
        )
        if cur.rowcount == 0:
            # Someone else got it between the select and the update.
            conn.execute("ROLLBACK")
            return None
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return get(conn, row["id"])


def recover_running(conn: sqlite3.Connection) -> int:
    """A RUNNING row on startup means the worker died mid-job. Requeue it and
    burn an attempt so a job that reliably kills the process is visible rather
    than looping forever."""
    cur = conn.execute(
        "UPDATE jobs SET status = ?, attempt = attempt + 1, started_at = NULL, updated_at = ?"
        " WHERE status = ?",
        (QUEUED, now_iso(), RUNNING),
    )
    return cur.rowcount


def finish_ok(
    conn: sqlite3.Connection, job_id: str, language: str, segment_count: int, duration_sec: float
) -> None:
    conn.execute(
        "UPDATE jobs SET status = ?, language = ?, segment_count = ?, duration_sec = ?,"
        " error_msg = NULL, updated_at = ? WHERE id = ?",
        (DONE, language, segment_count, duration_sec, now_iso(), job_id),
    )


def finish_error(conn: sqlite3.Connection, job_id: str, message: str) -> None:
    conn.execute(
        "UPDATE jobs SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?",
        (ERROR, message[:500], now_iso(), job_id),
    )


def retry(conn: sqlite3.Connection, job_id: str) -> bool:
    """Requeue an ERROR job under a fresh attempt number. Returns False when the
    job isn't in ERROR, which the API turns into a 409."""
    cur = conn.execute(
        "UPDATE jobs SET status = ?, attempt = attempt + 1, error_msg = NULL,"
        " started_at = NULL, updated_at = ? WHERE id = ? AND status = ? AND audio_deleted = 0",
        (QUEUED, now_iso(), job_id, ERROR),
    )
    return cur.rowcount > 0


def mark_audio_deleted(conn: sqlite3.Connection, job_id: str) -> None:
    conn.execute(
        "UPDATE jobs SET audio_deleted = 1, updated_at = ? WHERE id = ?", (now_iso(), job_id)
    )


def delete(conn: sqlite3.Connection, job_id: str) -> bool:
    cur = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    return cur.rowcount > 0


# ---- reads ------------------------------------------------------------------


def get(conn: sqlite3.Connection, job_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()


def list_recent(conn: sqlite3.Connection, limit: int = 100) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)
    ).fetchall()


def reapable(conn: sqlite3.Connection, retention_days: int) -> list[sqlite3.Row]:
    """Terminal jobs whose source audio has outlived the retention window. The
    row and the transcript are kept; only the audio goes."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat(
        timespec="microseconds"
    )
    return conn.execute(
        "SELECT * FROM jobs WHERE audio_deleted = 0 AND status IN (?, ?) AND created_at < ?",
        (DONE, ERROR, cutoff),
    ).fetchall()
