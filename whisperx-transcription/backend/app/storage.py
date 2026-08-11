"""Filesystem side of a job: upload staging, atomic placement, and cleanup.

Stdlib only and free of FastAPI, so the validation rules here are testable
without installing the web stack.
"""

import os
import re
import shutil
import time
import uuid
from pathlib import Path

from . import config

UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]")

# Matches the SPA's client-side check in src/lib/utils.ts, so a file the UI
# accepted never gets a different answer from the server.
UNSUPPORTED_FORMAT = "Unsupported format — try MP3, WAV, M4A, FLAC, or OGG."
TOO_LARGE = "File too large — 500MB max."


def safe_name(name: str) -> str:
    """The filename becomes a path component, so strip anything that could
    traverse or confuse the directory while keeping it recognisable."""
    base = os.path.basename(name or "").strip()
    cleaned = UNSAFE_CHARS.sub("_", base).lstrip(".")
    return cleaned[:120] or "audio"


def extension_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in (name or "") else ""


def is_allowed(name: str) -> bool:
    return extension_of(name) in config.ALLOWED_EXTENSIONS


def new_tmp_path() -> Path:
    config.TMP_DIR.mkdir(parents=True, exist_ok=True)
    return config.TMP_DIR / f"{uuid.uuid4()}.part"


def finalize(tmp_path: Path, job_id: str, stored_name: str) -> Path:
    """Move a fully-written upload into its job directory. os.replace is atomic
    within a filesystem, and both paths live on /data, so the file is either
    absent or complete — never half-visible to the worker."""
    dest_dir = config.audio_dir(job_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / stored_name
    os.replace(tmp_path, dest)
    return dest


def audio_path(job_id: str, stored_name: str) -> Path:
    return config.audio_dir(job_id) / stored_name


def delete_audio(job_id: str) -> None:
    shutil.rmtree(config.audio_dir(job_id), ignore_errors=True)


def delete_all(job_id: str) -> None:
    delete_audio(job_id)
    config.transcript_path(job_id).unlink(missing_ok=True)
    config.log_path(job_id).unlink(missing_ok=True)


def sweep_tmp(max_age_s: float = 86400) -> int:
    """A crash or a client disconnect mid-upload leaves a .part file with no row
    behind it. Nothing will ever claim those, so age them out."""
    if not config.TMP_DIR.exists():
        return 0
    removed = 0
    cutoff = time.time() - max_age_s
    for part in config.TMP_DIR.glob("*.part"):
        try:
            if part.stat().st_mtime < cutoff:
                part.unlink()
                removed += 1
        except OSError:
            continue
    return removed
