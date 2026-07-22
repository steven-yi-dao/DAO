"""Handler logic tests.

boto3 is stubbed at import time so these run anywhere — no AWS, no credentials,
no dependencies beyond the standard library:

    python3 -m unittest discover -s backend/tests
"""

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

os.environ.setdefault("AWS_REGION", "us-east-2")
os.environ.setdefault("DATA_BUCKET", "test-bucket")
os.environ.setdefault("JOBS_TABLE", "test-table")
os.environ.setdefault("MAX_UPLOAD_BYTES", str(500 * 1024 * 1024))
os.environ.setdefault("ENDPOINT_NAME", "whisperx-async")

class ClientError(Exception):
    def __init__(self, response, operation=None):
        super().__init__("client error")
        self.response = response


def stub_module(name, **attrs):
    """A MagicMock isn't a package, so `from boto3.dynamodb.conditions import Key`
    only resolves if each submodule is registered in sys.modules itself."""
    mod = MagicMock()
    for key, value in attrs.items():
        setattr(mod, key, value)
    sys.modules[name] = mod
    return mod


# Must land in sys.modules before any handler imports them.
stub_module("boto3")
stub_module("boto3.dynamodb")
stub_module("boto3.dynamodb.conditions", Key=MagicMock())
stub_module("botocore")
stub_module("botocore.exceptions", ClientError=ClientError)
stub_module("botocore.client", Config=MagicMock())

from common.http import ApiError, handler, user_id  # noqa: E402
from create_job.app import safe_name, validate  # noqa: E402


def event_with_sub(sub="user-123", **extra):
    return {"requestContext": {"authorizer": {"jwt": {"claims": {"sub": sub}}}}, **extra}


class TestValidate(unittest.TestCase):
    def base(self, **over):
        body = {"fileName": "meeting.mp3", "sizeBytes": 1024, "model": "balanced"}
        body.update(over)
        return body

    def test_accepts_a_well_formed_body(self):
        spec = validate(self.base(language="en-US", diarize=True))
        self.assertEqual(spec["model"], "balanced")
        self.assertTrue(spec["diarize"])

    def test_rejects_unsupported_extension(self):
        with self.assertRaises(ApiError) as ctx:
            validate(self.base(fileName="notes.txt"))
        self.assertEqual(ctx.exception.status, 400)

    def test_rejects_oversized_file(self):
        with self.assertRaises(ApiError):
            validate(self.base(sizeBytes=500 * 1024 * 1024 + 1))

    def test_rejects_unknown_model_tier(self):
        with self.assertRaises(ApiError):
            validate(self.base(model="turbo"))

    def test_rejects_bool_masquerading_as_size(self):
        # bool is a subclass of int in Python; True must not pass as a byte count.
        with self.assertRaises(ApiError):
            validate(self.base(sizeBytes=True))

    def test_defaults_diarize_off(self):
        self.assertFalse(validate(self.base())["diarize"])


class TestSafeName(unittest.TestCase):
    def test_strips_path_traversal(self):
        self.assertEqual(safe_name("../../etc/passwd"), "passwd")

    def test_replaces_unsafe_characters(self):
        self.assertEqual(safe_name("my file (1).mp3"), "my_file__1_.mp3")

    def test_never_returns_empty(self):
        self.assertEqual(safe_name("..."), "audio")

    def test_truncates_long_names(self):
        self.assertLessEqual(len(safe_name("a" * 500 + ".mp3")), 120)


class TestHttpPlumbing(unittest.TestCase):
    def test_user_id_reads_the_jwt_claim(self):
        self.assertEqual(user_id(event_with_sub("abc")), "abc")

    def test_user_id_without_claims_is_401(self):
        with self.assertRaises(ApiError) as ctx:
            user_id({"requestContext": {}})
        self.assertEqual(ctx.exception.status, 401)

    def test_handler_maps_api_error_to_its_status(self):
        @handler
        def fn(_event):
            raise ApiError(404, "Job not found")

        res = fn({}, None)
        self.assertEqual(res["statusCode"], 404)
        self.assertEqual(json.loads(res["body"])["message"], "Job not found")

    def test_handler_hides_unexpected_errors(self):
        @handler
        def fn(_event):
            raise RuntimeError("secret internal detail")

        res = fn({}, None)
        self.assertEqual(res["statusCode"], 500)
        self.assertNotIn("secret internal detail", res["body"])


class TestOnComplete(unittest.TestCase):
    def setUp(self):
        import common.jobs as jobs_mod
        import on_complete.app as mod

        self.mod = mod
        self.jobs = jobs_mod
        self.updates = []
        self.job = {"pk": "USER#u1", "sk": "JOB#t#j1", "jobId": "j1", "status": "QUEUED"}

        mod.jobs.find_by_inference_id = lambda _id: self.job
        mod.jobs.update = lambda item, **kw: self.updates.append(kw)
        mod.read_summary = lambda _loc: {"segmentCount": 12, "language": "en", "transcriptKey": "t.json"}

    def test_success_marks_done_with_summary(self):
        self.mod.apply_notification(
            {
                "inferenceId": "j1",
                "invocationStatus": "Completed",
                "responseParameters": {"outputLocation": "s3://b/k"},
            }
        )
        self.assertEqual(self.updates[0]["status"], "DONE")
        self.assertEqual(self.updates[0]["segmentCount"], 12)

    def test_failure_marks_error_without_leaking_the_reason(self):
        self.mod.apply_notification(
            {
                "inferenceId": "j1",
                "invocationStatus": "Failed",
                "failureReason": "CUDA out of memory at line 42",
            }
        )
        self.assertEqual(self.updates[0]["status"], "ERROR")
        self.assertNotIn("CUDA", self.updates[0]["errorMsg"])

    def test_redelivery_of_a_terminal_job_is_ignored(self):
        self.job["status"] = "DONE"
        self.mod.apply_notification({"inferenceId": "j1", "invocationStatus": "Completed"})
        self.assertEqual(self.updates, [])

    def test_one_bad_record_does_not_sink_the_batch(self):
        records = {
            "Records": [
                {"Sns": {"Message": "not json"}},
                {"Sns": {"Message": json.dumps({"inferenceId": "j1", "invocationStatus": "Completed",
                                                "responseParameters": {"outputLocation": "s3://b/k"}})}},
            ]
        }
        self.mod.lambda_handler(records, None)
        self.assertEqual(len(self.updates), 1)


if __name__ == "__main__":
    unittest.main()
