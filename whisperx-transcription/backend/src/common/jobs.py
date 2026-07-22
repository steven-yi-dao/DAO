"""DynamoDB access for the whisperx-jobs table.

Key layout (see BACKEND_PLAN.md §3):
    pk = USER#<cognito-sub>
    sk = JOB#<createdAtISO>#<jobId>
"""

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ["JOBS_TABLE"]
INFERENCE_INDEX = "inferenceId-index"

MODEL_TIERS = ("fast", "balanced", "accurate")
STATUSES = ("CREATED", "UPLOADED", "QUEUED", "PROCESSING", "DONE", "ERROR")

_table = boto3.resource("dynamodb").Table(TABLE_NAME)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def user_pk(user: str) -> str:
    return f"USER#{user}"


def job_sk(created_at: str, job_id: str) -> str:
    return f"JOB#{created_at}#{job_id}"


def undecimal(value: Any) -> Any:
    """DynamoDB hands numbers back as Decimal, which json.dumps rejects."""
    if isinstance(value, list):
        return [undecimal(v) for v in value]
    if isinstance(value, dict):
        return {k: undecimal(v) for k, v in value.items()}
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    return value


def put(item: dict) -> None:
    _table.put_item(Item=item)


def get(user: str, created_at: str, job_id: str) -> dict | None:
    res = _table.get_item(Key={"pk": user_pk(user), "sk": job_sk(created_at, job_id)})
    return res.get("Item")


def find_by_id(user: str, job_id: str) -> dict | None:
    """Look a job up by id alone. createdAt is part of the sort key, so this is a
    prefix query on the user's partition rather than a point read."""
    res = _table.query(
        KeyConditionExpression=Key("pk").eq(user_pk(user)) & Key("sk").begins_with("JOB#"),
        FilterExpression="jobId = :j",
        ExpressionAttributeValues={":j": job_id},
    )
    items = res.get("Items", [])
    return items[0] if items else None


def find_by_inference_id(inference_id: str) -> dict | None:
    """onComplete only gets an inferenceId from SNS; the GSI maps it back."""
    res = _table.query(
        IndexName=INFERENCE_INDEX,
        KeyConditionExpression=Key("inferenceId").eq(inference_id),
    )
    items = res.get("Items", [])
    return items[0] if items else None


def list_for_user(user: str, limit: int = 100) -> list[dict]:
    """Newest first — the sort key embeds an ISO timestamp, so descending order
    on the sort key is chronological."""
    res = _table.query(
        KeyConditionExpression=Key("pk").eq(user_pk(user)) & Key("sk").begins_with("JOB#"),
        ScanIndexForward=False,
        Limit=limit,
    )
    return res.get("Items", [])


def update(item: dict, **attrs: Any) -> None:
    """Patch attributes on an existing row, keyed off the row itself."""
    if not attrs:
        return
    attrs["updatedAt"] = now_iso()
    names = {f"#{k}": k for k in attrs}
    values = {f":{k}": v for k, v in attrs.items()}
    expr = "SET " + ", ".join(f"#{k} = :{k}" for k in attrs)
    _table.update_item(
        Key={"pk": item["pk"], "sk": item["sk"]},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def to_api(item: dict) -> dict:
    """Shape a stored row into the JSON the SPA consumes."""
    return undecimal(
        {
            "jobId": item.get("jobId"),
            "fileName": item.get("fileName"),
            "sizeBytes": item.get("sizeBytes"),
            "durationSec": item.get("durationSec"),
            "model": item.get("model"),
            "language": item.get("language"),
            "diarize": item.get("diarize"),
            "status": item.get("status"),
            "segmentCount": item.get("segmentCount"),
            "errorMsg": item.get("errorMsg"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }
    )
