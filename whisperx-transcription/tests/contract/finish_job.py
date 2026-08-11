"""Drive a job to DONE using the backend's own modules.

The contract test needs a finished job to fetch a transcript for, but a real
run needs a GPU and minutes. This performs exactly the transition the worker
performs — `transcribe.write_transcript` then `db.finish_ok` — so the file on
disk and the row are shaped by the shipped code rather than by a copy of it.

torch and whisperx are stubbed the same way `backend/tests/test_worker.py`
stubs them, since `transcribe` imports both at module scope.
"""

import sys
import types

_torch = types.ModuleType("torch")
_torch.cuda = types.SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None)
sys.modules.setdefault("torch", _torch)
sys.modules.setdefault("whisperx", types.ModuleType("whisperx"))

from app import config, db, transcribe  # noqa: E402

SEGMENTS = [
    {
        "start": 0.0,
        "end": 3.5,
        "speaker": None,
        "text": "Thanks for coming in.",
        "words": [
            {"display": "Thanks ", "low": False},
            {"display": "for ", "low": False},
            {"display": "coming ", "low": True},
            {"display": "in.", "low": False},
        ],
    },
    {
        "start": 3.5,
        "end": 7.25,
        "speaker": None,
        "text": "Your accommodations are already on file.",
        "words": [
            {"display": "Your ", "low": False},
            {"display": "accommodations ", "low": True},
            {"display": "are ", "low": False},
            {"display": "already ", "low": False},
            {"display": "on ", "low": False},
            {"display": "file.", "low": False},
        ],
    },
]
DURATION_SEC = 7.25
LANGUAGE = "en"


def main(job_id: str) -> None:
    transcribe.write_transcript(
        config.transcript_path(job_id),
        {"jobId": job_id, "language": LANGUAGE, "segments": SEGMENTS, "durationSec": DURATION_SEC},
    )
    conn = db.connect()
    try:
        db.finish_ok(
            conn,
            job_id,
            language=LANGUAGE,
            segment_count=len(SEGMENTS),
            duration_sec=DURATION_SEC,
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main(sys.argv[1])
