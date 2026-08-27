"""The BetterTranscribe boundary correction.

Only `correct_segments` is exercised, which is the point of splitting vad.py in
two: everything worth testing is plain dicts and floats, so this runs on a bare
interpreter with no torch, no silero model and no GPU.
"""

import json
import unittest

from . import _support  # noqa: F401  — must precede any app import

from app import config, vad


def word(text, start, end, score=0.9):
    return {"word": text, "start": start, "end": end, "score": score}


def segment(start, end, words, text=None):
    return {
        "start": start,
        "end": end,
        "speaker": None,
        "text": text if text is not None else " ".join(w["word"] for w in words),
        "words": words,
    }


class SnapTest(unittest.TestCase):
    def test_pulls_both_bounds_onto_nearby_speech_edges(self):
        seg = segment(3.88, 8.20, [word("hello", 3.88, 4.40), word("there", 7.60, 8.20)])
        out = vad.correct_segments([seg], [(4.12, 7.86)])
        self.assertEqual((out[0]["start"], out[0]["end"]), (4.12, 7.86))

    def test_leaves_a_bound_alone_when_the_nearest_edge_is_out_of_reach(self):
        # 1.5s away, far outside the 0.35s tolerance: whisperx was probably
        # right and VAD probably missed.
        seg = segment(10.0, 12.0, [word("hello", 10.0, 11.0), word("there", 11.2, 12.0)])
        out = vad.correct_segments([seg], [(8.5, 13.5)])
        self.assertEqual((out[0]["start"], out[0]["end"]), (10.0, 12.0))

    def test_does_not_mutate_the_input(self):
        seg = segment(3.88, 8.20, [word("hello", 3.88, 4.40), word("there", 7.60, 8.20)])
        vad.correct_segments([seg], [(4.12, 7.86)])
        self.assertEqual((seg["start"], seg["end"]), (3.88, 8.20))

    def test_carries_untouched_fields_through(self):
        seg = segment(3.88, 8.20, [word("hi", 3.88, 4.40), word("there", 7.60, 8.20)])
        seg["speaker"] = "SPEAKER_01"
        out = vad.correct_segments([seg], [(4.12, 7.86)])
        self.assertEqual(out[0]["speaker"], "SPEAKER_01")
        self.assertEqual(out[0]["text"], "hi there")


class SplitTest(unittest.TestCase):
    def test_splits_across_a_silence_vad_agrees_is_silent(self):
        seg = segment(
            4.12,
            12.16,
            [
                word("one", 4.12, 5.00),
                word("two", 5.10, 6.90),
                word("three", 9.30, 10.40),
                word("four", 11.00, 12.16),
            ],
        )
        out = vad.correct_segments([seg], [(4.12, 6.90), (9.30, 12.16)])
        self.assertEqual(len(out), 2)
        self.assertEqual((out[0]["start"], out[0]["end"]), (4.12, 6.90))
        self.assertEqual((out[1]["start"], out[1]["end"]), (9.30, 12.16))
        self.assertEqual(out[0]["text"], "one two")
        self.assertEqual(out[1]["text"], "three four")

    def test_does_not_split_when_vad_hears_speech_through_the_gap(self):
        # A gap alignment could not label but VAD says is speech is a lost quiet
        # word, not a pause. Splitting there would cut a sentence in half.
        seg = segment(
            4.12,
            12.16,
            [
                word("one", 4.12, 5.00),
                word("two", 5.10, 6.90),
                word("three", 9.30, 10.40),
                word("four", 11.00, 12.16),
            ],
        )
        out = vad.correct_segments([seg], [(4.12, 12.16)])
        self.assertEqual(len(out), 1)

    def test_does_not_split_on_a_pause_below_the_threshold(self):
        seg = segment(
            4.12,
            9.00,
            [
                word("one", 4.12, 5.00),
                word("two", 5.40, 6.00),  # 0.40s gap, under the 0.70s threshold
                word("three", 6.10, 9.00),
            ],
        )
        out = vad.correct_segments([seg], [(4.12, 5.00), (5.40, 9.00)])
        self.assertEqual(len(out), 1)

    def test_a_word_missing_timings_rides_along_and_never_splits(self):
        seg = segment(
            4.12,
            12.16,
            [
                word("one", 4.12, 5.00),
                {"word": "um", "score": 0.1},
                word("two", 5.10, 6.90),
                word("three", 9.30, 12.16),
            ],
        )
        out = vad.correct_segments([seg], [(4.12, 6.90), (9.30, 12.16)])
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["text"], "one um two")

    def test_a_segment_with_one_word_is_never_split(self):
        seg = segment(4.12, 6.90, [word("one", 4.12, 6.90)])
        out = vad.correct_segments([seg], [(4.12, 6.90)])
        self.assertEqual(len(out), 1)


class GuardTest(unittest.TestCase):
    def test_never_produces_a_caption_that_overlaps_the_one_before(self):
        # Both segments try to snap onto the same pair of edges.
        first = segment(4.00, 6.00, [word("a", 4.00, 5.00), word("b", 5.10, 6.00)])
        second = segment(6.10, 8.00, [word("c", 6.10, 7.00), word("d", 7.10, 8.00)])
        out = vad.correct_segments([first, second], [(4.05, 6.20), (6.05, 8.05)])
        self.assertGreater(out[1]["start"], out[0]["end"])

    def test_never_inverts_a_caption(self):
        # The nearest region start (5.25) is after the nearest region end
        # (5.05), so snapping both bounds would put start past end.
        seg = segment(5.10, 5.20, [word("a", 5.10, 5.15), word("b", 5.16, 5.20)])
        out = vad.correct_segments([seg], [(4.90, 5.05), (5.25, 6.00)])
        self.assertLess(out[0]["start"], out[0]["end"])

    def test_abandons_a_correction_that_would_leave_the_caption_too_short(self):
        # Snapping start forward and end backward would collapse this below
        # VAD_MIN_SEGMENT_S, so the original bounds are kept instead.
        seg = segment(5.00, 5.50, [word("a", 5.00, 5.20), word("b", 5.30, 5.50)])
        out = vad.correct_segments([seg], [(5.30, 5.35)])
        self.assertEqual((out[0]["start"], out[0]["end"]), (5.00, 5.50))

    def test_nothing_is_ever_dropped(self):
        segs = [
            segment(1.00, 2.00, [word("a", 1.00, 1.40), word("b", 1.60, 2.00)]),
            segment(2.05, 2.15, [word("c", 2.05, 2.10), word("d", 2.12, 2.15)]),
            segment(3.00, 4.00, [word("e", 3.00, 3.40), word("f", 3.60, 4.00)]),
        ]
        out = vad.correct_segments(segs, [(1.05, 2.02), (2.06, 2.14), (3.02, 3.98)])
        self.assertGreaterEqual(len(out), len(segs))

    def test_bounds_are_rounded_to_the_precision_the_transcript_is_written_at(self):
        seg = segment(3.88, 8.20, [word("a", 3.88, 4.40), word("b", 7.60, 8.20)])
        out = vad.correct_segments([seg], [(4.1234567, 7.8654321)])
        self.assertEqual((out[0]["start"], out[0]["end"]), (4.123, 7.865))


class WhisperxShapeTest(unittest.TestCase):
    """Matches what whisperx 3.8.6 actually emits from align(): word bounds come
    off a pandas Series, so they are numpy floats, and a word alignment could not
    place has its start/end keys *absent* rather than set to None."""

    class Numpyish(float):
        """Stands in for numpy.float64 without making numpy a test dependency:
        arithmetic and round() return the subclass, not a plain float."""

        def __round__(self, n=None):
            return WhisperxShapeTest.Numpyish(float.__round__(self, n))

    def test_output_bounds_are_plain_floats_json_can_serialise(self):
        n = self.Numpyish
        seg = {
            "start": n(3.88),
            "end": n(8.20),
            "speaker": None,
            "text": "hello there",
            "words": [
                {"word": "hello", "start": n(3.88), "end": n(4.40), "score": n(0.9)},
                {"word": "there", "start": n(7.60), "end": n(8.20), "score": n(0.9)},
            ],
        }
        out = vad.correct_segments([seg], [(4.12, 7.86)])
        for key in ("start", "end"):
            self.assertIs(type(out[0][key]), float, f"{key} is {type(out[0][key])}")
        json.dumps([{k: v for k, v in out[0].items() if k != "words"}])


class PassthroughTest(unittest.TestCase):
    def test_no_regions_leaves_everything_untouched(self):
        seg = segment(3.88, 8.20, [word("a", 3.88, 4.40), word("b", 7.60, 8.20)])
        out = vad.correct_segments([seg], [])
        self.assertEqual((out[0]["start"], out[0]["end"]), (3.88, 8.20))

    def test_no_segments_is_not_an_error(self):
        self.assertEqual(vad.correct_segments([], [(1.0, 2.0)]), [])

    def test_reports_what_it_did_through_the_job_log(self):
        lines = []
        seg = segment(
            4.12,
            12.16,
            [
                word("one", 4.00, 5.00),
                word("two", 5.10, 6.90),
                word("three", 9.30, 10.40),
                word("four", 11.00, 12.30),
            ],
        )
        vad.correct_segments([seg], [(4.12, 6.90), (9.30, 12.16)], lines.append)
        joined = "\n".join(lines)
        self.assertIn("vad split at", joined)
        self.assertIn("vad seg 0 start", joined)
        self.assertIn("regions", lines[-1])


class SpeechWithinTest(unittest.TestCase):
    def test_sums_only_the_overlap(self):
        regions = [(0.0, 1.0), (2.0, 3.0), (5.0, 6.0)]
        self.assertAlmostEqual(vad._speech_within(regions, 0.5, 2.5), 1.0)
        self.assertAlmostEqual(vad._speech_within(regions, 3.0, 5.0), 0.0)
        self.assertAlmostEqual(vad._speech_within(regions, 2.0, 2.0), 0.0)


class TunableTest(unittest.TestCase):
    def test_the_snap_tolerance_is_what_decides_whether_a_bound_moves(self):
        seg = segment(5.00, 9.00, [word("a", 5.00, 6.00), word("b", 8.00, 9.00)])
        edge_away = config.VAD_SNAP_TOLERANCE_S + 0.05
        out = vad.correct_segments([seg], [(5.00 + edge_away, 9.00)])
        self.assertEqual(out[0]["start"], 5.00)


if __name__ == "__main__":
    unittest.main()
