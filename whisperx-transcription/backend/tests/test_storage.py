import os
import time
import unittest

from . import _support  # noqa: F401  — must precede any app import

from app import config, storage


class TestSafeName(unittest.TestCase):
    def test_strips_directory_traversal(self):
        self.assertEqual(storage.safe_name("../../etc/passwd"), "passwd")
        self.assertEqual(storage.safe_name("/tmp/evil.wav"), "evil.wav")

    def test_replaces_unsafe_characters(self):
        self.assertEqual(storage.safe_name("my file (1).wav"), "my_file__1_.wav")

    def test_strips_leading_dots(self):
        self.assertEqual(storage.safe_name(".hidden.wav"), "hidden.wav")

    def test_falls_back_when_nothing_survives(self):
        self.assertEqual(storage.safe_name(""), "audio")
        self.assertEqual(storage.safe_name("..."), "audio")

    def test_caps_length(self):
        self.assertEqual(len(storage.safe_name("a" * 300 + ".wav")), 120)


class TestExtensions(unittest.TestCase):
    def test_allowed(self):
        for name in ("a.mp3", "a.WAV", "a.m4a", "a.flac", "a.ogg", "a.mp4", "a.aac"):
            self.assertTrue(storage.is_allowed(name), name)

    def test_rejected(self):
        for name in ("a.txt", "a.exe", "noextension", "", "a.wav.txt"):
            self.assertFalse(storage.is_allowed(name), name)


class TestPlacement(unittest.TestCase):
    def setUp(self):
        _support.reset_data_dir()

    def test_finalize_moves_the_part_file_into_the_job_directory(self):
        tmp = storage.new_tmp_path()
        tmp.write_bytes(b"audio")

        dest = storage.finalize(tmp, "j1", "clip.wav")

        self.assertTrue(dest.exists())
        self.assertFalse(tmp.exists())
        self.assertEqual(dest, config.UPLOADS_DIR / "j1" / "clip.wav")
        self.assertEqual(storage.audio_path("j1", "clip.wav"), dest)

    def test_delete_all_removes_audio_transcript_and_log(self):
        tmp = storage.new_tmp_path()
        tmp.write_bytes(b"audio")
        storage.finalize(tmp, "j1", "clip.wav")
        config.transcript_path("j1").write_text("{}")
        config.log_path("j1").write_text("hi")

        storage.delete_all("j1")

        self.assertFalse(config.audio_dir("j1").exists())
        self.assertFalse(config.transcript_path("j1").exists())
        self.assertFalse(config.log_path("j1").exists())

    def test_delete_is_idempotent(self):
        storage.delete_all("never-existed")  # must not raise


class TestTmpSweep(unittest.TestCase):
    def setUp(self):
        _support.reset_data_dir()

    def test_only_stale_part_files_are_removed(self):
        fresh = storage.new_tmp_path()
        fresh.write_bytes(b"x")
        stale = storage.new_tmp_path()
        stale.write_bytes(b"x")
        old = time.time() - 90000
        os.utime(stale, (old, old))

        self.assertEqual(storage.sweep_tmp(max_age_s=86400), 1)
        self.assertTrue(fresh.exists())
        self.assertFalse(stale.exists())


if __name__ == "__main__":
    unittest.main()
