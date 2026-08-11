import unittest

from . import _support  # noqa: F401  — must precede any app import

from app import db


class JobsTestCase(unittest.TestCase):
    def setUp(self):
        _support.reset_data_dir()
        self.conn = db.connect()
        db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def insert(self, job_id, name="a.wav", size=10):
        return db.insert(self.conn, job_id, name, name, size)


class TestInsert(JobsTestCase):
    def test_new_job_starts_queued_on_attempt_one(self):
        row = self.insert("j1")
        self.assertEqual(row["status"], db.QUEUED)
        self.assertEqual(row["attempt"], 1)
        self.assertEqual(row["audio_deleted"], 0)
        self.assertIsNone(row["duration_sec"])

    def test_to_api_shape(self):
        payload = db.to_api(self.insert("j1", "Hello World.wav", 4096))
        self.assertEqual(payload["jobId"], "j1")
        self.assertEqual(payload["fileName"], "Hello World.wav")
        self.assertEqual(payload["sizeBytes"], 4096)
        self.assertEqual(payload["status"], "QUEUED")
        self.assertNotIn("model", payload)
        self.assertNotIn("diarize", payload)


class TestClaim(JobsTestCase):
    def test_claims_oldest_first_then_runs_dry(self):
        self.insert("older")
        self.insert("newer")

        first = db.claim_next(self.conn)
        self.assertEqual(first["id"], "older")
        self.assertEqual(first["status"], db.RUNNING)
        self.assertIsNotNone(first["started_at"])

        second = db.claim_next(self.conn)
        self.assertEqual(second["id"], "newer")

        self.assertIsNone(db.claim_next(self.conn))

    def test_empty_queue_leaves_no_open_transaction(self):
        self.assertIsNone(db.claim_next(self.conn))
        # A rolled-back claim must not hold the write lock.
        self.insert("j1")
        self.assertEqual(db.claim_next(self.conn)["id"], "j1")

    def test_claim_is_exclusive_against_a_concurrent_writer(self):
        self.insert("j1")
        other = db.connect()
        db.init(other)
        try:
            self.assertEqual(db.claim_next(self.conn)["id"], "j1")
            # The row is RUNNING now, so the second worker finds nothing.
            self.assertIsNone(db.claim_next(other))
        finally:
            other.close()


class TestRecovery(JobsTestCase):
    def test_running_rows_are_requeued_and_burn_an_attempt(self):
        self.insert("j1")
        db.claim_next(self.conn)

        self.assertEqual(db.recover_running(self.conn), 1)
        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.QUEUED)
        self.assertEqual(row["attempt"], 2)
        self.assertIsNone(row["started_at"])

    def test_terminal_rows_are_untouched(self):
        self.insert("done")
        db.finish_ok(self.conn, "done", "en", 3, 12.5)
        self.assertEqual(db.recover_running(self.conn), 0)
        self.assertEqual(db.get(self.conn, "done")["status"], db.DONE)


class TestTransitions(JobsTestCase):
    def test_finish_ok_persists_measured_duration(self):
        self.insert("j1")
        db.finish_ok(self.conn, "j1", "en", 42, 137.4)
        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.DONE)
        self.assertEqual(row["language"], "en")
        self.assertEqual(row["segment_count"], 42)
        self.assertAlmostEqual(row["duration_sec"], 137.4)

    def test_finish_error_truncates_long_messages(self):
        self.insert("j1")
        db.finish_error(self.conn, "j1", "x" * 900)
        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.ERROR)
        self.assertEqual(len(row["error_msg"]), 500)


class TestRetry(JobsTestCase):
    def test_error_job_requeues_under_a_new_attempt(self):
        self.insert("j1")
        db.finish_error(self.conn, "j1", "boom")
        self.assertTrue(db.retry(self.conn, "j1"))

        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.QUEUED)
        self.assertEqual(row["attempt"], 2)
        self.assertIsNone(row["error_msg"])

    def test_non_error_jobs_are_not_retryable(self):
        self.insert("j1")
        self.assertFalse(db.retry(self.conn, "j1"))          # QUEUED
        db.finish_ok(self.conn, "j1", "en", 1, 1.0)
        self.assertFalse(db.retry(self.conn, "j1"))          # DONE

    def test_reaped_audio_blocks_retry(self):
        self.insert("j1")
        db.finish_error(self.conn, "j1", "boom")
        db.mark_audio_deleted(self.conn, "j1")
        self.assertFalse(db.retry(self.conn, "j1"))


class TestRetention(JobsTestCase):
    def test_only_old_terminal_jobs_with_audio_are_reapable(self):
        old = "2020-01-01T00:00:00+00:00"
        for job_id in ("old_done", "old_error", "old_queued", "recent_done", "already_reaped"):
            self.insert(job_id)

        db.finish_ok(self.conn, "old_done", "en", 1, 1.0)
        db.finish_error(self.conn, "old_error", "boom")
        db.finish_ok(self.conn, "recent_done", "en", 1, 1.0)
        db.finish_ok(self.conn, "already_reaped", "en", 1, 1.0)
        db.mark_audio_deleted(self.conn, "already_reaped")

        self.conn.execute(
            "UPDATE jobs SET created_at = ? WHERE id IN ('old_done','old_error','old_queued','already_reaped')",
            (old,),
        )

        ids = {r["id"] for r in db.reapable(self.conn, retention_days=7)}
        self.assertEqual(ids, {"old_done", "old_error"})


class TestDelete(JobsTestCase):
    def test_delete_reports_whether_a_row_went(self):
        self.insert("j1")
        self.assertTrue(db.delete(self.conn, "j1"))
        self.assertFalse(db.delete(self.conn, "j1"))
        self.assertIsNone(db.get(self.conn, "j1"))


if __name__ == "__main__":
    unittest.main()
