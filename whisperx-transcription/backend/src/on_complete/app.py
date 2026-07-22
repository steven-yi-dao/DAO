"""SNS-triggered — mark jobs DONE or ERROR when the async endpoint reports back.

SageMaker publishes one notification per invocation to the success or error
topic. The message carries the inferenceId we set in submit_job (== jobId) plus
the S3 location of the container's summary output.
"""

import json
import logging
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError

from common import jobs

log = logging.getLogger()
log.setLevel(logging.INFO)

s3 = boto3.client("s3")

GENERIC_FAILURE = "We couldn't transcribe this file. It may be corrupted or unreadable."


def read_summary(output_location: str) -> dict[str, Any]:
    """The container's return value, written by SageMaker to async-output/."""
    parsed = urlparse(output_location)
    try:
        raw = s3.get_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/"))["Body"].read()
        summary = json.loads(raw)
        return summary if isinstance(summary, dict) else {}
    except (ClientError, json.JSONDecodeError):
        # A missing or malformed summary shouldn't strand the job — the
        # transcript is written by the container at a deterministic key anyway.
        log.warning("could not read summary at %s", output_location, exc_info=True)
        return {}


def apply_notification(message: dict) -> None:
    inference_id = message.get("inferenceId")
    if not inference_id:
        log.warning("notification without inferenceId: %s", message)
        return

    job = jobs.find_by_inference_id(inference_id)
    if not job:
        log.warning("no job for inferenceId %s", inference_id)
        return

    # SNS delivery is at-least-once; a terminal job stays as it is.
    if job.get("status") in ("DONE", "ERROR"):
        log.info("job %s already terminal, skipping", job.get("jobId"))
        return

    if message.get("invocationStatus") == "Completed":
        summary = read_summary(message.get("responseParameters", {}).get("outputLocation", ""))
        jobs.update(
            job,
            status="DONE",
            segmentCount=int(summary.get("segmentCount", 0)),
            language=summary.get("language") or job.get("language") or "",
            transcriptKey=summary.get("transcriptKey") or job.get("transcriptKey"),
            logKey=summary.get("logKey") or job.get("logKey"),
        )
    else:
        # failureReason carries container stack traces; log it, show the user a
        # generic message rather than surfacing internals.
        reason = message.get("failureReason", "")
        log.error("job %s failed: %s", job.get("jobId"), reason)
        jobs.update(job, status="ERROR", errorMsg=GENERIC_FAILURE)


def lambda_handler(event: dict, _context: Any) -> dict:
    for record in event.get("Records", []):
        try:
            apply_notification(json.loads(record["Sns"]["Message"]))
        except Exception:
            # Don't let one bad record fail the batch and trigger redelivery of
            # the records that already applied cleanly.
            log.exception("failed to process record")
    return {"ok": True}
