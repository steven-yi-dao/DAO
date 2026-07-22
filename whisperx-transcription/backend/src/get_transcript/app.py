"""GET /jobs/{id} — one job, plus presigned transcript/log URLs once it's DONE."""

import os

import boto3
from botocore.client import Config

from common import jobs
from common.http import ApiError, handler, path_param, user_id

BUCKET = os.environ["DATA_BUCKET"]
DOWNLOAD_URL_TTL = 900

# See create_job/app.py: pinned to the regional endpoint + virtual addressing so
# the presigned URL's signed Host header matches the host the client actually hits.
_region = os.environ["AWS_REGION"]
s3 = boto3.client(
    "s3",
    region_name=_region,
    endpoint_url=f"https://s3.{_region}.amazonaws.com",
    config=Config(s3={"addressing_style": "virtual"}),
)


def presign(key: str) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=DOWNLOAD_URL_TTL,
    )


@handler
def lambda_handler(event: dict) -> tuple[int, dict]:
    user = user_id(event)
    job_id = path_param(event, "id")

    # Scoped to the caller's partition, so one user can never read another's job.
    job = jobs.find_by_id(user, job_id)
    if not job:
        raise ApiError(404, "Job not found")

    payload = jobs.to_api(job)
    if job.get("status") == "DONE" and job.get("transcriptKey"):
        payload["transcriptUrl"] = presign(job["transcriptKey"])
    if job.get("logKey"):
        payload["logUrl"] = presign(job["logKey"])

    return 200, payload
