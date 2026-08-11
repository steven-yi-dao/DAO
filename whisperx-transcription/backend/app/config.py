"""Settings and the /data layout.

Everything durable lives under DATA_DIR, which in production is a separate
encrypted EBS volume with DeleteOnTermination disabled. Nothing is written to
the instance's local NVMe, because instance-store data is lost when the
instance stops or terminates.
"""

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))

DB_PATH = DATA_DIR / "jobs.db"
UPLOADS_DIR = DATA_DIR / "uploads"
TMP_DIR = UPLOADS_DIR / "tmp"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
LOGS_DIR = DATA_DIR / "logs"
MODELS_DIR = DATA_DIR / "models"

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 500 * 1024 * 1024))
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", 7))

# How long the worker sleeps when the queue is empty, and how often it runs the
# retention sweep while idle.
POLL_INTERVAL_S = float(os.environ.get("POLL_INTERVAL_S", 2.0))
RETENTION_SWEEP_INTERVAL_S = float(os.environ.get("RETENTION_SWEEP_INTERVAL_S", 3600))

ALLOWED_EXTENSIONS = {"mp3", "wav", "m4a", "flac", "ogg", "mp4", "aac"}

# One fixed model tier. Word alignment is on; diarization is not supported, so
# there is no pyannote and no Hugging Face token.
MODEL_NAME = os.environ.get("WHISPER_MODEL", "medium")


def ensure_dirs() -> None:
    for d in (UPLOADS_DIR, TMP_DIR, TRANSCRIPTS_DIR, LOGS_DIR, MODELS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def audio_dir(job_id: str) -> Path:
    return UPLOADS_DIR / job_id


def transcript_path(job_id: str) -> Path:
    return TRANSCRIPTS_DIR / f"{job_id}.json"


def log_path(job_id: str) -> Path:
    return LOGS_DIR / f"{job_id}.log"
