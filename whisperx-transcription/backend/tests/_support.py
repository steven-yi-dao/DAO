"""Point DATA_DIR at a scratch directory before app.config is first imported.

Every test module imports this first — config computes its paths at import
time, so the environment has to be set before anything under app/ is loaded.
"""

import os
import shutil
import tempfile

TMP_ROOT = tempfile.mkdtemp(prefix="whisperx-tests-")
os.environ["DATA_DIR"] = TMP_ROOT
os.environ.setdefault("MAX_UPLOAD_BYTES", str(1024 * 1024))  # 1 MiB, so size tests stay fast


def reset_data_dir() -> None:
    """Wipe /data between tests without invalidating config's cached paths."""
    from app import config

    for child in (config.UPLOADS_DIR, config.TRANSCRIPTS_DIR, config.LOGS_DIR):
        shutil.rmtree(child, ignore_errors=True)
    config.DB_PATH.unlink(missing_ok=True)
    for suffix in ("-wal", "-shm"):
        config.DB_PATH.with_name(config.DB_PATH.name + suffix).unlink(missing_ok=True)
    config.ensure_dirs()
