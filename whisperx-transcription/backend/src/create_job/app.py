"""POST /jobs — reserve a job row and hand back a presigned upload URL."""

import os
import re
import uuid

import boto3
from botocore.client import Config

from common import jobs
from common.http import ApiError, body_of, handler, user_id

BUCKET = os.environ["DATA_BUCKET"]
MAX_BYTES = int(os.environ["MAX_UPLOAD_BYTES"])
UPLOAD_URL_TTL = 3600

ALLOWED_EXTENSIONS = {"mp3", "wav", "m4a", "flac", "ogg", "mp4", "aac"}
UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]")

# Pinned to the regional endpoint with virtual-hosted addressing: boto3's default
# signs against the global s3.amazonaws.com host, which 307-redirects any bucket
# outside us-east-1 — and since Host is a signed header, naively following that
# redirect breaks the signature instead of fixing it.
_region = os.environ["AWS_REGION"]
s3 = boto3.client(
    "s3",
    region_name=_region,
    endpoint_url=f"https://s3.{_region}.amazonaws.com",
    config=Config(s3={"addressing_style": "virtual"}),
)


def safe_name(name: str) -> str:
    """The filename becomes part of an S3 key, so strip anything that could
    traverse or confuse the key space while keeping it recognisable to the user."""
    base = os.path.basename(name or "").strip()
    cleaned = UNSAFE_CHARS.sub("_", base).lstrip(".")
    return cleaned[:120] or "audio"


def validate(body: dict) -> dict:
    name = body.get("fileName")
    if not isinstance(name, str) or not name.strip():
        raise ApiError(400, "fileName is required")

    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ApiError(400, "Unsupported format — try MP3, WAV, M4A, FLAC, or OGG.")

    size = body.get("sizeBytes")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise ApiError(400, "sizeBytes must be a positive integer")
    if size > MAX_BYTES:
        raise ApiError(400, "File too large — 500MB max.")

    model = body.get("model", "balanced")
    if model not in jobs.MODEL_TIERS:
        raise ApiError(400, f"model must be one of {', '.join(jobs.MODEL_TIERS)}")

    language = body.get("language") or ""
    if not isinstance(language, str) or len(language) > 16:
        raise ApiError(400, "language must be a short locale string")

    return {
        "fileName": name.strip(),
        "sizeBytes": size,
        "model": model,
        "language": language,
        "diarize": bool(body.get("diarize", False)),
        "durationSec": body.get("durationSec") if isinstance(body.get("durationSec"), int) else None,
    }


@handler
def lambda_handler(event: dict) -> tuple[int, dict]:
    user = user_id(event)
    spec = validate(body_of(event))

    job_id = str(uuid.uuid4())
    created_at = jobs.now_iso()
    audio_key = f"uploads/{user}/{job_id}/{safe_name(spec['fileName'])}"

    jobs.put(
        {
            "pk": jobs.user_pk(user),
            "sk": jobs.job_sk(created_at, job_id),
            "jobId": job_id,
            "userId": user,
            "audioKey": audio_key,
            "status": "CREATED",
            "createdAt": created_at,
            "updatedAt": created_at,
            **spec,
        }
    )

    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": audio_key},
        ExpiresIn=UPLOAD_URL_TTL,
    )

    return 201, {"jobId": job_id, "uploadUrl": upload_url, "expiresIn": UPLOAD_URL_TTL}
