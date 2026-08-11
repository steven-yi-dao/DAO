"""API tests.

Skipped when FastAPI's test stack isn't installed, so the db/storage suites
still run against a bare interpreter.
"""

import io
import unittest

from . import _support  # noqa: F401  — must precede any app import

try:
    from fastapi.testclient import TestClient

    from app import config, db, main, storage

    HAVE_FASTAPI = True
except ImportError:  # pragma: no cover
    HAVE_FASTAPI = False


@unittest.skipUnless(HAVE_FASTAPI, "fastapi/httpx not installed")
class ApiTestCase(unittest.TestCase):
    def setUp(self):
        _support.reset_data_dir()
        conn = db.connect()
        db.init(conn)
        conn.close()
        self.client = TestClient(main.app)

    def upload(self, name="clip.wav", body=b"fake audio bytes"):
        return self.client.post("/api/jobs", files={"file": (name, io.BytesIO(body), "audio/wav")})

    def conn(self):
        return db.connect()


class TestHealth(ApiTestCase):
    def test_health(self):
        self.assertEqual(self.client.get("/api/health").json(), {"ok": True})


class TestUpload(ApiTestCase):
    def test_upload_queues_a_job_and_stores_the_file(self):
        res = self.upload()
        self.assertEqual(res.status_code, 201)

        body = res.json()
        self.assertEqual(body["status"], "QUEUED")
        self.assertEqual(body["fileName"], "clip.wav")
        self.assertEqual(body["sizeBytes"], len(b"fake audio bytes"))
        self.assertEqual(body["attempt"], 1)

        stored = config.UPLOADS_DIR / body["jobId"] / "clip.wav"
        self.assertTrue(stored.exists())
        self.assertEqual(stored.read_bytes(), b"fake audio bytes")

    def test_filename_is_sanitized_on_disk_but_preserved_for_display(self):
        res = self.upload(name="../my recording.wav")
        body = res.json()
        self.assertEqual(body["fileName"], "../my recording.wav")
        self.assertTrue((config.UPLOADS_DIR / body["jobId"] / "my_recording.wav").exists())

    def test_rejects_unsupported_extension(self):
        res = self.upload(name="notes.txt")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["message"], storage.UNSUPPORTED_FORMAT)

    def test_rejects_empty_file(self):
        res = self.upload(body=b"")
        self.assertEqual(res.status_code, 400)

    def test_oversized_upload_is_rejected_and_leaves_nothing_behind(self):
        res = self.upload(body=b"x" * (config.MAX_UPLOAD_BYTES + 1))
        self.assertEqual(res.status_code, 413)
        self.assertEqual(res.json()["message"], storage.TOO_LARGE)

        self.assertEqual(list(config.TMP_DIR.glob("*.part")), [])
        conn = self.conn()
        self.assertEqual(db.list_recent(conn), [])
        conn.close()

    def test_rejected_upload_creates_no_row(self):
        self.upload(name="notes.txt")
        conn = self.conn()
        self.assertEqual(len(db.list_recent(conn)), 0)
        conn.close()


class TestListAndGet(ApiTestCase):
    def test_list_is_newest_first(self):
        first = self.upload(name="one.wav").json()["jobId"]
        second = self.upload(name="two.wav").json()["jobId"]

        jobs = self.client.get("/api/jobs").json()["jobs"]
        self.assertEqual([j["jobId"] for j in jobs], [second, first])

    def test_limit_is_bounded(self):
        self.assertEqual(self.client.get("/api/jobs?limit=0").status_code, 400)
        self.assertEqual(self.client.get("/api/jobs?limit=500").status_code, 400)

    def test_get_unknown_job_is_404_with_a_message(self):
        res = self.client.get("/api/jobs/nope")
        self.assertEqual(res.status_code, 404)
        self.assertIn("message", res.json())


class TestTranscript(ApiTestCase):
    def test_409_until_the_job_is_done(self):
        job_id = self.upload().json()["jobId"]
        res = self.client.get(f"/api/jobs/{job_id}/transcript")
        self.assertEqual(res.status_code, 409)

    def test_returns_the_file_once_done(self):
        job_id = self.upload().json()["jobId"]
        config.transcript_path(job_id).write_text('{"jobId":"x","language":"en","segments":[]}')
        conn = self.conn()
        db.finish_ok(conn, job_id, "en", 0, 1.0)
        conn.close()

        res = self.client.get(f"/api/jobs/{job_id}/transcript")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["language"], "en")

    def test_404_when_the_row_says_done_but_the_file_is_gone(self):
        job_id = self.upload().json()["jobId"]
        conn = self.conn()
        db.finish_ok(conn, job_id, "en", 0, 1.0)
        conn.close()
        self.assertEqual(self.client.get(f"/api/jobs/{job_id}/transcript").status_code, 404)


class TestRetry(ApiTestCase):
    def test_failed_job_can_be_retried(self):
        job_id = self.upload().json()["jobId"]
        conn = self.conn()
        db.finish_error(conn, job_id, "boom")
        conn.close()

        body = self.client.post(f"/api/jobs/{job_id}/retry").json()
        self.assertEqual(body["status"], "QUEUED")
        self.assertEqual(body["attempt"], 2)
        self.assertIsNone(body["errorMsg"])

    def test_queued_job_cannot_be_retried(self):
        job_id = self.upload().json()["jobId"]
        self.assertEqual(self.client.post(f"/api/jobs/{job_id}/retry").status_code, 409)

    def test_retry_is_blocked_once_audio_is_reaped(self):
        job_id = self.upload().json()["jobId"]
        conn = self.conn()
        db.finish_error(conn, job_id, "boom")
        db.mark_audio_deleted(conn, job_id)
        conn.close()

        res = self.client.post(f"/api/jobs/{job_id}/retry")
        self.assertEqual(res.status_code, 409)
        self.assertIn("upload the file again", res.json()["message"])


class TestDelete(ApiTestCase):
    def test_delete_removes_row_and_files(self):
        job_id = self.upload().json()["jobId"]
        config.log_path(job_id).write_text("log")

        self.assertEqual(self.client.delete(f"/api/jobs/{job_id}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/jobs/{job_id}").status_code, 404)
        self.assertFalse(config.audio_dir(job_id).exists())
        self.assertFalse(config.log_path(job_id).exists())

    def test_running_job_cannot_be_deleted(self):
        self.upload()
        conn = self.conn()
        row = db.claim_next(conn)
        conn.close()
        self.assertEqual(self.client.delete(f"/api/jobs/{row['id']}").status_code, 409)


if __name__ == "__main__":
    unittest.main()
