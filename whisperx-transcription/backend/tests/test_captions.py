"""The BetterTranscribe caption formatting.

Like test_vad, this exercises only the pure half: `fit_segments` is dicts,
strings and floats, so the whole judgement runs on a bare interpreter with no
torch, no model and no GPU.
"""

import json
import unittest

from . import _support  # noqa: F401  — must precede any app import

from app import captions, config

MAX_CHARS = config.CAPTION_MAX_LINE_CHARS
MAX_LINES = config.CAPTION_MAX_LINES


def word(text, start, end, score=0.9):
    return {"word": text, "start": start, "end": end, "score": score}


def evenly(text, start=0.0, per_word=0.5, gap=0.0):
    """One word per token, laid end to end, so a test can talk about text and
    ignore timings."""
    words = []
    t = start
    for token in text.split():
        words.append(word(token, round(t, 3), round(t + per_word, 3)))
        t += per_word + gap
    return words


def segment(words, start=None, end=None, text=None):
    return {
        "start": start if start is not None else words[0]["start"],
        "end": end if end is not None else words[-1]["end"],
        "speaker": None,
        "text": text if text is not None else " ".join(w["word"] for w in words),
        "words": words,
    }


class BudgetTest(unittest.TestCase):
    """The format is the requirement: at most MAX_LINES lines, each at most
    MAX_CHARS characters."""

    def assertWithinBudget(self, out):
        for i, seg in enumerate(out):
            self.assertIsNotNone(seg.get("lines"), f"caption {i} was left unformatted")
            self.assertLessEqual(len(seg["lines"]), MAX_LINES, f"caption {i}: {seg['lines']}")
            for line in seg["lines"]:
                self.assertLessEqual(len(line), MAX_CHARS, f"caption {i}: {line!r}")

    def test_a_short_caption_is_left_as_one_line(self):
        out = captions.fit_segments([segment(evenly("hello there"))])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["lines"], ["hello there"])

    def test_a_caption_over_one_line_is_broken_into_two(self):
        out = captions.fit_segments([segment(evenly("the quick brown fox jumps"))])
        self.assertEqual(len(out), 1)
        self.assertEqual(len(out[0]["lines"]), 2)
        self.assertWithinBudget(out)

    def test_a_caption_over_the_whole_budget_becomes_several_captions(self):
        text = (
            "the quick brown fox jumps over the lazy dog and then it turns "
            "around and does the entire thing over again backwards"
        )
        out = captions.fit_segments([segment(evenly(text))])
        self.assertGreater(len(out), 1)
        self.assertWithinBudget(out)

    def test_every_word_survives_in_order(self):
        text = "one two three four five six seven eight nine ten eleven twelve thirteen"
        out = captions.fit_segments([segment(evenly(text))])
        self.assertEqual(" ".join(" ".join(seg["lines"]) for seg in out), text)

    def test_a_long_run_of_captions_all_stay_within_budget(self):
        text = (
            "we were talking about the quarterly numbers yesterday and nobody "
            "could agree on whether the forecast was optimistic or simply wrong, "
            "so we agreed to revisit it once the regional figures land."
        )
        out = captions.fit_segments([segment(evenly(text))])
        self.assertWithinBudget(out)


class CutPointTest(unittest.TestCase):
    """Punctuation first, then a real pause, then evenness."""

    def test_breaks_at_a_sentence_end_in_preference_to_the_balance_point(self):
        # "over. and" is the sentence end; the even split would fall later.
        out = captions.fit_segments([segment(evenly("it was over. and we all went home"))])
        self.assertEqual(out[0]["lines"][0], "it was over.")

    def test_breaks_at_a_clause_end_when_there_is_no_sentence_end(self):
        out = captions.fit_segments([segment(evenly("if it rains, we will all stay inside"))])
        self.assertEqual(out[0]["lines"][0], "if it rains,")

    def test_breaks_at_a_pause_when_there_is_no_punctuation(self):
        # A clear pause after "said" that the even split would not choose.
        words = (
            evenly("well he said", start=0.0, per_word=0.3)
            + evenly("we should go now", start=3.0, per_word=0.3)
        )
        out = captions.fit_segments([segment(words)])
        self.assertEqual(out[0]["lines"][0], "well he said")

    def test_falls_back_to_the_most_even_break(self):
        # No punctuation and no pause worth the name: split near the middle
        # rather than packing the first line full.
        out = captions.fit_segments([segment(evenly("aaa bbb ccc ddd eee fff ggg hhh"))])
        first, second = out[0]["lines"]
        self.assertLessEqual(abs(len(first) - len(second)), 4)

    def test_a_sentence_end_wins_even_when_it_leaves_a_very_short_line(self):
        # This is how a human splits it too: the sentence ends, so the caption
        # ends. Evenness never overrides punctuation.
        out = captions.fit_segments([segment(evenly("no. that is not what he said"))])
        self.assertEqual(out[0]["lines"][0], "no.")


class TimingTest(unittest.TestCase):
    def test_a_split_caption_takes_its_interior_bounds_from_word_timings(self):
        words = evenly(
            "one two three four five six seven eight nine ten eleven twelve",
            start=0.0,
            per_word=1.0,
        )
        out = captions.fit_segments([segment(words)])
        self.assertGreater(len(out), 1)
        for piece in out:
            spoken = [w for w in piece["words"] if w.get("start") is not None]
            self.assertLessEqual(piece["start"], spoken[0]["start"] + captions.EPSILON_S)
            self.assertGreaterEqual(piece["end"], spoken[-1]["end"])

    def test_keeps_the_segments_own_outer_bounds(self):
        # Those are what vad.correct_segments snapped onto speech edges;
        # recomputing them from word timings would throw the correction away.
        words = evenly("one two three four five six seven eight nine ten", per_word=1.0)
        seg = segment(words, start=0.123, end=99.5)
        out = captions.fit_segments([seg])
        self.assertEqual(out[0]["start"], 0.123)
        self.assertEqual(out[-1]["end"], 99.5)

    def test_captions_never_overlap_or_invert(self):
        words = evenly(
            "one two three four five six seven eight nine ten eleven twelve thirteen",
            per_word=0.4,
        )
        out = captions.fit_segments([segment(words)])
        for piece in out:
            self.assertLess(piece["start"], piece["end"])
        for before, after in zip(out, out[1:]):
            self.assertGreater(after["start"], before["end"])

    def test_bounds_are_rounded_to_the_precision_the_transcript_is_written_at(self):
        words = evenly("one two three four five six seven eight", per_word=0.3333333)
        out = captions.fit_segments([segment(words)])
        for piece in out:
            self.assertEqual(piece["start"], round(piece["start"], 3))
            self.assertEqual(piece["end"], round(piece["end"], 3))

    def test_does_not_mutate_the_input(self):
        seg = segment(evenly("one two three four five six seven eight nine ten"))
        before = json.dumps(seg, sort_keys=True)
        captions.fit_segments([seg])
        self.assertEqual(json.dumps(seg, sort_keys=True), before)


class LongWordTest(unittest.TestCase):
    def test_hard_breaks_a_word_too_wide_for_a_line(self):
        long = "a" * (MAX_CHARS + 10)
        out = captions.fit_segments([segment([word(long, 0.0, 2.0)])])
        flat = "".join(line for seg in out for line in seg["lines"])
        self.assertIn(captions.HYPHEN, flat)
        for seg in out:
            for line in seg["lines"]:
                self.assertLessEqual(len(line), MAX_CHARS)

    def test_the_broken_pieces_still_spell_the_original_word(self):
        long = "supercalifragilisticexpialidocious"
        out = captions.fit_segments([segment([word(long, 0.0, 2.0)])])
        flat = "".join(line for seg in out for line in seg["lines"])
        self.assertEqual(flat.replace(captions.HYPHEN, ""), long)

    def test_the_pieces_divide_the_words_own_span_and_never_leave_it(self):
        out = captions.fit_segments([segment([word("b" * 40, 4.0, 6.0)])])
        for piece in out:
            self.assertGreaterEqual(piece["start"], 4.0)
            self.assertLessEqual(piece["end"], 6.0)

    def test_a_long_word_does_not_disturb_the_words_around_it(self):
        words = [word("before", 0.0, 0.5), word("c" * 30, 0.6, 2.0), word("after", 2.1, 2.6)]
        out = captions.fit_segments([segment(words)])
        flat = " ".join(" ".join(seg["lines"]) for seg in out)
        self.assertTrue(flat.startswith("before"))
        self.assertTrue(flat.endswith("after"))


class WhisperxShapeTest(unittest.TestCase):
    """Matches what whisperx 3.8.6 emits: numpy floats for bounds, and the
    start/end keys *absent* on a word alignment could not place."""

    class Numpyish(float):
        def __round__(self, n=None):
            return WhisperxShapeTest.Numpyish(float.__round__(self, n))

    def test_a_word_missing_timings_rides_along(self):
        words = [
            word("one", 0.0, 0.5),
            {"word": "um", "score": 0.1},
            word("two", 0.6, 1.0),
            word("three", 1.1, 1.6),
        ]
        out = captions.fit_segments([segment(words)])
        self.assertEqual(" ".join(" ".join(s["lines"]) for s in out), "one um two three")

    def test_a_word_with_only_one_bound_never_anchors_a_caption(self):
        # A half-timed word is not an anchor. Treating it as one used to reach
        # float(None) and cost the whole pass for the file.
        words = evenly("one two three four five six", per_word=1.0)
        words[3].pop("end")
        out = captions.fit_segments([segment(words)])
        for piece in out:
            self.assertIsInstance(piece["start"], float)
            self.assertIsInstance(piece["end"], float)
        self.assertEqual(
            " ".join(" ".join(s["lines"]) for s in out), "one two three four five six"
        )

    def test_output_bounds_are_plain_floats_json_can_serialise(self):
        n = self.Numpyish
        words = [
            {"word": token, "start": n(i * 1.0), "end": n(i * 1.0 + 0.9), "score": n(0.9)}
            for i, token in enumerate("one two three four five six seven eight nine ten".split())
        ]
        out = captions.fit_segments([segment(words, start=n(0.0), end=n(9.9))])
        for piece in out:
            for key in ("start", "end"):
                self.assertIs(type(piece[key]), float, f"{key} is {type(piece[key])}")
        json.dumps([{k: v for k, v in p.items() if k != "words"} for p in out])


class PassthroughTest(unittest.TestCase):
    def test_no_segments_is_not_an_error(self):
        self.assertEqual(captions.fit_segments([]), [])

    def test_carries_untouched_fields_through(self):
        seg = segment(evenly("hello there friend"))
        seg["speaker"] = "SPEAKER_01"
        out = captions.fit_segments([seg])
        self.assertEqual(out[0]["speaker"], "SPEAKER_01")

    def test_a_segment_with_no_words_still_gets_its_text_laid_out(self):
        seg = {"start": 1.0, "end": 2.0, "speaker": None, "text": "no alignment here", "words": []}
        out = captions.fit_segments([seg])
        self.assertEqual(len(out), 1)
        self.assertEqual(" ".join(out[0]["lines"]), "no alignment here")

    def test_reports_what_it_did_through_the_job_log(self):
        lines = []
        text = "one two three four five six seven eight nine ten eleven twelve"
        captions.fit_segments([segment(evenly(text))], lines.append)
        joined = "\n".join(lines)
        self.assertIn("caption split into", joined)
        self.assertIn("caption fit", lines[-1])


class TunableTest(unittest.TestCase):
    def test_the_line_width_is_what_decides_where_a_line_breaks(self):
        words = evenly("one two three four five six seven eight")
        wide = captions._layout(words, 80, 2)
        narrow = captions._layout(words, 20, 2)
        self.assertEqual(len(wide), 1)
        self.assertEqual(len(narrow), 2)

    def test_a_pause_below_the_threshold_does_not_beat_evenness(self):
        under = config.CAPTION_MIN_PAUSE_S / 2
        words = evenly("aaa bbb", per_word=0.3) + evenly(
            "ccc ddd eee fff ggg", start=0.6 + under, per_word=0.3
        )
        out = captions.fit_segments([segment(words)])
        first, second = out[0]["lines"]
        self.assertLessEqual(abs(len(first) - len(second)), 4)


if __name__ == "__main__":
    unittest.main()
