"""POST /jobs/{id}/submit — verify the upload landed, then queue GPU inference."""

import json
import os

import boto3
from botocore.exceptions import ClientError

from common import jobs
from common.http import ApiError, handler, path_param, user_id

BUCKET = os.environ["DATA_BUCKET"]
MAX_BYTES = int(os.environ["MAX_UPLOAD_BYTES"])
ENDPOINT_NAME = os.environ.get("ENDPOINT_NAME", "")

s3 = boto3.client("s3")
sagemaker = boto3.client("sagemaker-runtime")


def uploaded_size(key: str) -> int:
    try:
        return s3.head_object(Bucket=BUCKET, Key=key)["ContentLength"]
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("404", "NoSuchKey"):
            raise ApiError(409, "Upload not found — PUT the file to uploadUrl first.") from exc
        raise


@handler
def lambda_handler(event: dict) -> tuple[int, dict]:
    if not ENDPOINT_NAME:
        raise ApiError(503, "Inference endpoint is not deployed yet.")

    user = user_id(event)
    job_id = path_param(event, "id")

    job = jobs.find_by_id(user, job_id)
    if not job:
        raise ApiError(404, "Job not found")
    if job["status"] not in ("CREATED", "UPLOADED", "ERROR"):
        raise ApiError(409, f"Job is already {job['status']}")

    # The presigned PUT can't enforce a size limit on its own, so this is where
    # an oversized upload actually gets caught.
    size = uploaded_size(job["audioKey"])
    if size > MAX_BYTES:
        s3.delete_object(Bucket=BUCKET, Key=job["audioKey"])
        jobs.update(job, status="ERROR", errorMsg="File too large — 500MB max.")
        raise ApiError(400, "File too large — 500MB max.")

    manifest = {
        "jobId": job_id,
        "userId": user,
        "bucket": BUCKET,
        "audioKey": job["audioKey"],
        "model": job["model"],
        "language": job.get("language") or "",
        "diarize": bool(job.get("diarize")),
        "transcriptKey": f"transcripts/{user}/{job_id}.json",
        "logKey": f"logs/jobs/{job_id}.log",
    }
    manifest_key = f"manifests/{job_id}.json"
    s3.put_object(
        Bucket=BUCKET,
        Key=manifest_key,
        Body=json.dumps(manifest).encode(),
        ContentType="application/json",
    )

    result = sagemaker.invoke_endpoint_async(
        EndpointName=ENDPOINT_NAME,
        InputLocation=f"s3://{BUCKET}/{manifest_key}",
        ContentType="application/json",
        InferenceId=job_id,
    )

    jobs.update(
        job,
        status="QUEUED",
        inferenceId=result["InferenceId"],
        sizeBytes=size,
        transcriptKey=manifest["transcriptKey"],
        logKey=manifest["logKey"],
    )

    return 202, {"jobId": job_id, "status": "QUEUED"}
