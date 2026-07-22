"""GET /jobs — the caller's job history, newest first. Polled every ~3s."""

from common import jobs
from common.http import handler, user_id


@handler
def lambda_handler(event: dict) -> tuple[int, dict]:
    user = user_id(event)
    limit = 100
    raw_limit = (event.get("queryStringParameters") or {}).get("limit")
    if raw_limit and raw_limit.isdigit():
        limit = max(1, min(int(raw_limit), 200))

    items = jobs.list_for_user(user, limit=limit)
    return 200, {"jobs": [jobs.to_api(i) for i in items]}
