"""Request/response plumbing shared by the HTTP API handlers."""

import json
import logging
from typing import Any, Callable

log = logging.getLogger()
log.setLevel(logging.INFO)


class ApiError(Exception):
    """Raised by handlers to short-circuit with a specific status code."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def response(status: int, body: Any) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def user_id(event: dict) -> str:
    """Cognito `sub` from the JWT authorizer. API Gateway rejects unauthenticated
    requests before we ever run, so a missing claim means a misconfigured stage."""
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except KeyError as exc:
        raise ApiError(401, "Unauthenticated") from exc


def body_of(event: dict) -> dict:
    raw = event.get("body")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(400, "Body must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ApiError(400, "Body must be a JSON object")
    return parsed


def path_param(event: dict, name: str) -> str:
    value = (event.get("pathParameters") or {}).get(name)
    if not value:
        raise ApiError(400, f"Missing path parameter: {name}")
    return value


def handler(fn: Callable[[dict], tuple[int, Any]]) -> Callable[[dict, Any], dict]:
    """Wraps a handler so ApiError becomes its status code and anything else
    becomes a 500 without leaking the traceback to the client."""

    def wrapped(event: dict, _context: Any) -> dict:
        try:
            status, body = fn(event)
            return response(status, body)
        except ApiError as exc:
            log.warning("api error %s: %s", exc.status, exc.message)
            return response(exc.status, {"message": exc.message})
        except Exception:
            log.exception("unhandled error")
            return response(500, {"message": "Internal server error"})

    return wrapped
