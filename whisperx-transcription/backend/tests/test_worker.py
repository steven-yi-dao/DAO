"""Worker loop tests.

torch and whisperx are stubbed into sys.modules before app.transcribe is
imported, so the queue mechanics are testable without a GPU or a multi-gigabyte
dependency tree. Only the pipeline call itself is faked — the transitions, the
transcript write, and the failure path are the real code.
"""

import json
import sys
import types
import unittest

from . import _support  # noqa: F401  — must precede any app import

_torch = types.ModuleType("torch")
_torch.cuda = types.SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None)
sys.modules.setdefault("torch", _torch)
sys.modules.setdefault("whisperx", types.ModuleType("whisperx"))

from app import config, db, storage, transcribe, worker  # noqa: E402


class WorkerTestCase(unittest.TestCase):
    def setUp(self):
        _support.reset_data_dir()
        self.conn = db.connect()
        db.init(self.conn)
        self._real_run = transcribe.run

    def tearDown(self):
        transcribe.run = self._real_run
        self.conn.close()

    def queue_job(self, job_id="j1", name="clip.wav", with_audio=True, pipeline=db.PIPELINE_STANDARD):
        if with_audio:
            tmp = storage.new_tmp_path()
            tmp.write_bytes(b"audio")
            storage.finalize(tmp, job_id, name)
        return db.insert(self.conn, job_id, name, name, 5, pipeline)


class TestProcess(WorkerTestCase):
    def test_success_writes_the_transcript_and_records_measured_duration(self):
        self.queue_job()
        transcribe.run = lambda job_id, audio, log, pipeline: {
            "jobId": job_id,
            "language": "es",
            "segments": [{"start": 0.0, "end": 1.0, "speaker": None, "text": "hola", "words": []}],
            "durationSec": 137.4,
        }

        worker.process(self.conn, db.claim_next(self.conn))

        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.DONE)
        self.assertEqual(row["language"], "es")
        self.assertEqual(row["segment_count"], 1)
        self.assertAlmostEqual(row["duration_sec"], 137.4)

        written = json.loads(config.transcript_path("j1").read_text())
        self.assertEqual(written["language"], "es")
        self.assertEqual(written["segments"][0]["text"], "hola")
        self.assertNotIn("durationSec", written)  # duration lives on the row

    def test_success_deletes_the_source_audio_but_keeps_the_transcript(self):
        self.queue_job()
        transcribe.run = lambda job_id, audio, log, pipeline: {
            "jobId": job_id,
            "language": "en",
            "segments": [],
            "durationSec": 1.0,
        }

        worker.process(self.conn, db.claim_next(self.conn))

        row = db.get(self.conn, "j1")
        self.assertEqual(row["audio_deleted"], 1)
        self.assertFalse(config.audio_dir("j1").exists())
        self.assertTrue(config.transcript_path("j1").exists())

    def test_error_keeps_the_audio_so_a_retry_has_something_to_run(self):
        self.queue_job()

        def boom(*_args):
            raise RuntimeError("nope")

        transcribe.run = boom
        worker.process(self.conn, db.claim_next(self.conn))

        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.ERROR)
        self.assertEqual(row["audio_deleted"], 0)
        self.assertTrue(config.audio_dir("j1").exists())

    def test_pipeline_failure_marks_error_without_killing_the_loop(self):
        self.queue_job()

        def boom(*_args):
            raise RuntimeError("CUDA out of memory")

        transcribe.run = boom
        worker.process(self.conn, db.claim_next(self.conn))

        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.ERROR)
        self.assertIn("CUDA out of memory", row["error_msg"])
        self.assertFalse(config.transcript_path("j1").exists())

    def test_the_row_decides_which_pipeline_runs(self):
        """BetterTranscribe is a column on the job, not a worker-wide setting, so
        a vad job and a standard job can sit in the same queue."""
        seen = []

        def record(job_id, audio, log, pipeline):
            seen.append(pipeline)
            return {"jobId": job_id, "language": "en", "segments": [], "durationSec": 1.0}

        transcribe.run = record
        self.queue_job("j1", pipeline=db.PIPELINE_VAD)
        self.queue_job("j2", pipeline=db.PIPELINE_STANDARD)
        worker.process(self.conn, db.claim_next(self.conn))
        worker.process(self.conn, db.claim_next(self.conn))

        self.assertEqual(seen, [db.PIPELINE_VAD, db.PIPELINE_STANDARD])

    def test_missing_audio_is_an_error_not_a_crash(self):
        self.queue_job(with_audio=False)
        worker.process(self.conn, db.claim_next(self.conn))

        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.ERROR)
        self.assertIn("missing", row["error_msg"])

    def test_a_failed_job_can_be_retried_and_then_succeed(self):
        self.queue_job()
        transcribe.run = lambda *_a: (_ for _ in ()).throw(RuntimeError("transient"))
        worker.process(self.conn, db.claim_next(self.conn))
        self.assertEqual(db.get(self.conn, "j1")["status"], db.ERROR)

        self.assertTrue(db.retry(self.conn, "j1"))
        transcribe.run = lambda job_id, audio, log, pipeline: {
            "jobId": job_id, "language": "en", "segments": [], "durationSec": 1.0,
        }
        worker.process(self.conn, db.claim_next(self.conn))

        row = db.get(self.conn, "j1")
        self.assertEqual(row["status"], db.DONE)
        self.assertEqual(row["attempt"], 2)
        self.assertIsNone(row["error_msg"])


class TestSweep(WorkerTestCase):
    def test_sweep_deletes_old_audio_but_keeps_row_and_transcript(self):
        self.queue_job()
        db.finish_ok(self.conn, "j1", "en", 1, 1.0)
        config.transcript_path("j1").write_text("{}")
        self.conn.execute("UPDATE jobs SET created_at = '2020-01-01T00:00:00+00:00' WHERE id = 'j1'")

        worker.sweep(self.conn)

        self.assertFalse(config.audio_dir("j1").exists())
        self.assertTrue(config.transcript_path("j1").exists())
        row = db.get(self.conn, "j1")
        self.assertEqual(row["audio_deleted"], 1)
        self.assertEqual(row["status"], db.DONE)

    def test_recent_audio_survives(self):
        self.queue_job()
        db.finish_ok(self.conn, "j1", "en", 1, 1.0)

        worker.sweep(self.conn)

        self.assertTrue(storage.audio_path("j1", "clip.wav").exists())
        self.assertEqual(db.get(self.conn, "j1")["audio_deleted"], 0)


class TestTranscriptWrite(WorkerTestCase):
    def test_write_is_atomic_and_leaves_no_temp_file(self):
        payload = {"jobId": "j1", "language": "en", "segments": [], "durationSec": 2.0}
        path = config.transcript_path("j1")
        transcribe.write_transcript(path, payload)

        self.assertTrue(path.exists())
        self.assertEqual(list(config.TRANSCRIPTS_DIR.glob("*.tmp")), [])
        self.assertEqual(json.loads(path.read_text())["jobId"], "j1")


if __name__ == "__main__":
    unittest.main()
