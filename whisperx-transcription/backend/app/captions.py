"""Caption formatting to a fixed line budget (BetterTranscribe).

Employees were splitting every caption by hand to reach the house format: at
most two lines, at most 24 characters each. That is mechanical work with a
mechanical answer, and doing it here is the point of this module — the .srt
should arrive already conforming, so nobody has to touch it.

Two things have to happen, and only one of them needs timings:

  splitting     a caption too long for the budget becomes several captions, and
                each new one needs a real start and end. That comes from the
                per-word timings, which is why this runs on the *raw aligned*
                segments, before `transcribe._shape_segments` discards them.
  line-breaking laying a caption's words out across its lines. Pure text.

Where to break, in order (the tiers are the whole judgement):

  1. sentence-final punctuation — a caption that ends a sentence reads best
  2. clause punctuation
  3. a real pause between words — the signal WhisperX alignment gives us and a
     hand-splitter cannot see
  4. whichever break leaves the pieces most even

Like `vad.correct_segments`, this is plain Python over dicts, strings and
floats: no torch, no model, no audio, so the entire judgement is testable on a
bare interpreter.
"""

import logging

from . import config
from .vad import EPSILON_S

log = logging.getLogger("whisperx.worker")

# Ends a caption most cleanly, in descending order of how much we want them.
SENTENCE_END = (".", "!", "?", "…")
CLAUSE_END = (",", ";", ":", "—", "–")

# Appended to the leading pieces of a word too long to fit on one line, so the
# reader can tell the word continues onto the next.
HYPHEN = "-"


def fit_segments(segments: list, emit=None) -> list:
    """Reformat captions to the configured line budget.

    Returns a new list; the input is not mutated. Every returned segment carries
    a `lines` key — the caption exactly as it should be written — alongside the
    usual flat `text`.

    Failure is never fatal. A segment that cannot be placed cleanly comes back
    with its original boundaries and no `lines`, and the SPA falls back to its
    flat text, which is what it did before this pass existed.
    """
    say = emit or (lambda _msg: None)
    if not segments:
        return list(segments)

    max_chars = config.CAPTION_MAX_LINE_CHARS
    max_lines = config.CAPTION_MAX_LINES

    out: list = []
    unplaced = 0
    for seg in segments:
        pieces = _fit_one(seg, max_chars, max_lines, say)
        if pieces is None:
            unplaced += 1
            out.append(dict(seg))
            continue
        out.extend(pieces)

    over = sum(1 for seg in out for line in (seg.get("lines") or []) if len(line) > max_chars)
    say(
        f"caption fit {len(segments)} -> {len(out)} captions at "
        f"{max_lines}x{max_chars}, {unplaced} left unformatted, {over} line(s) over budget"
    )
    return out


def _fit_one(seg: dict, max_chars: int, max_lines: int, say) -> list | None:
    """One segment to one or more conforming captions, or None to leave it be."""
    words = _explode_long_words(list(seg.get("words") or []), max_chars, say)

    # No aligned words to divide — nothing can be split, but the text can still
    # be laid out. This is the shape a segment has when alignment produced
    # nothing for it, not the normal path.
    if not words:
        text = str(seg.get("text", "")).strip()
        return [{**seg, "lines": _hard_lines(text, max_chars)}] if text else None

    groups = _split_to_captions(words, max_chars, max_lines)
    return _place(seg, groups, max_chars, max_lines, say)


# ---- splitting one caption into several -------------------------------------


def _split_to_captions(words: list, max_chars: int, max_lines: int) -> list:
    """Group words into the fewest captions that each fit the budget."""
    groups: list = []
    rest = words
    while rest:
        if _layout(rest, max_chars, max_lines) is not None:
            groups.append(rest)
            break

        # Prefixes that fit are a run from the start: once one is too long,
        # every longer one is too.
        valid = []
        for i in range(1, len(rest)):
            if _layout(rest[:i], max_chars, max_lines) is None:
                break
            valid.append(i)
        if not valid:
            # A single word wider than the whole budget. _explode_long_words
            # should have made this impossible; keep it whole rather than
            # invent a way to divide it.
            groups.append(rest)
            break

        budget = max_chars * max_lines
        remaining = len(_join(rest))
        wanted = max(2, -(-remaining // budget))  # ceil, to spread rather than pack
        cut = _choose_cut(rest, valid, remaining / wanted)
        groups.append(rest[:cut])
        rest = rest[cut:]
    return groups


def _place(seg: dict, groups: list, max_chars: int, max_lines: int, say) -> list | None:
    """Give each group its bounds and its lines.

    The segment's own start and end are kept for the first and last piece. They
    are what `vad.correct_segments` snapped onto speech edges, and recomputing
    them from word timings would throw that correction away; only the interior
    boundaries are new.
    """
    seg_start, seg_end = _bounds(seg)

    bounds = []
    for group in groups:
        # Both bounds, not either: a word with only one of them cannot anchor a
        # piece, and float(None) here would cost the whole pass for the file.
        timed = [w for w in group if None not in _bounds(w)]
        if timed:
            bounds.append((float(_bounds(timed[0])[0]), float(_bounds(timed[-1])[1])))
        elif len(groups) == 1 and seg_start is not None and seg_end is not None:
            # Nothing was split, so the segment's own bounds still describe it
            # even with no word alignment to read them off.
            bounds.append((float(seg_start), float(seg_end)))
        else:
            # No anchor to place this piece, so it is not a piece — abandon the
            # split rather than invent a timestamp for it.
            say("caption piece has no aligned word to place it - segment left unformatted")
            return None

    if seg_start is not None:
        bounds[0] = (float(seg_start), bounds[0][1])
    if seg_end is not None:
        bounds[-1] = (bounds[-1][0], float(seg_end))

    pieces = []
    prev_end = None
    for group, (start, end) in zip(groups, bounds):
        if prev_end is not None and start <= prev_end:
            start = prev_end + EPSILON_S
        if end <= start:
            say(f"caption split at {start:.3f} would invert - segment left unformatted")
            return None
        # float() before round(): whisperx word bounds come off a pandas Series
        # as numpy floats, and round() on one returns another numpy float that
        # json.dumps refuses.
        start, end = round(float(start), 3), round(float(end), 3)
        text = _join(group)
        lines = _layout(group, max_chars, max_lines) or _hard_lines(text, max_chars)
        pieces.append({**seg, "start": start, "end": end, "text": text, "words": group, "lines": lines})
        prev_end = end

    if len(pieces) > 1:
        say(
            f"caption split into {len(pieces)} at "
            + ", ".join(f"{p['start']:.3f}" for p in pieces[1:])
        )
    return pieces


# ---- laying one caption out across its lines --------------------------------


def _layout(words: list, max_chars: int, max_lines: int) -> list | None:
    """The caption's lines, or None when these words cannot fit in this budget."""
    text = _join(words)
    if len(text) <= max_chars:
        return [text]
    if max_lines <= 1 or len(words) < 2:
        return None

    valid = []
    for i in range(1, len(words)):
        if len(_join(words[:i])) > max_chars:
            break
        if _layout(words[i:], max_chars, max_lines - 1) is not None:
            valid.append(i)
    if not valid:
        return None

    cut = _choose_cut(words, valid, len(text) / max_lines)
    return [_join(words[:cut])] + _layout(words[cut:], max_chars, max_lines - 1)


def _choose_cut(words: list, candidates: list, target_chars: float) -> int:
    """Pick where to break, by the tiers in the module docstring.

    Ranked as a tuple so the order is the preference: punctuation decides first,
    a real pause breaks ties within a tier, and evenness settles the rest.
    """

    def rank(i: int):
        prev = _bare(words[i - 1])
        if prev.endswith(SENTENCE_END):
            tier = 2
        elif prev.endswith(CLAUSE_END):
            tier = 1
        else:
            tier = 0
        gap = _gap(words, i)
        paused = gap >= config.CAPTION_MIN_PAUSE_S
        return (tier, paused, gap if paused else 0.0, -abs(len(_join(words[:i])) - target_chars))

    return max(candidates, key=rank)


def _hard_lines(text: str, max_chars: int) -> list:
    """Last resort for text no word boundary can divide. Never fails, and never
    silently drops characters — an over-budget line is reported by the caller."""
    if len(text) <= max_chars:
        return [text] if text else []
    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]


# ---- words ------------------------------------------------------------------


def _explode_long_words(words: list, max_chars: int, say) -> list:
    """Hyphen-break any word too wide for a line into pieces that fit.

    The pieces divide the original word's span proportionally by character
    count. That is the only interpolated timing in this module, and it stays
    strictly inside one word, so no piece can be attributed to a moment where
    that word was not being spoken.
    """
    out: list = []
    for word in words:
        text = _bare(word)
        if not text:
            continue
        if len(text) <= max_chars:
            out.append(word)
            continue

        # One character of every piece but the last is spent on the hyphen.
        width = max(1, max_chars - len(HYPHEN))
        chunks = [text[i : i + width] for i in range(0, len(text), width)]
        say(f"caption hard-broke {text!r} across {len(chunks)} lines")

        start, end = _bounds(word)
        span = None if start is None or end is None else float(end) - float(start)
        cursor = 0
        for idx, chunk in enumerate(chunks):
            last = idx == len(chunks) - 1
            piece = dict(word)
            piece["word"] = chunk if last else chunk + HYPHEN
            # Marks a piece that continues the word before it, so _join does not
            # put a space inside a word it only broke for width.
            piece["_broken"] = idx > 0
            if span is not None:
                piece["start"] = float(start) + span * (cursor / len(text))
                piece["end"] = float(start) + span * ((cursor + len(chunk)) / len(text))
            cursor += len(chunk)
            out.append(piece)
    return out


def _join(words: list) -> str:
    """The flat text of these words, as it would be written on one line."""
    parts: list = []
    for word in words:
        text = _bare(word)
        if not text:
            continue
        if parts and not word.get("_broken"):
            parts.append(" ")
        parts.append(text)
    return "".join(parts)


def _bare(word) -> str:
    return str(word.get("word", "")).strip()


def _bounds(item) -> tuple:
    """(start, end) with whatever is missing left as None.

    whisperx omits the keys entirely on a word alignment could not place, so
    this cannot assume they are present and set to None.
    """
    start, end = item.get("start"), item.get("end")
    return (None if start is None else start, None if end is None else end)


def _gap(words: list, i: int) -> float:
    """Silence between the word before the cut and the word after it."""
    _, prev_end = _bounds(words[i - 1])
    next_start, _ = _bounds(words[i])
    if prev_end is None or next_start is None:
        return 0.0
    return max(0.0, float(next_start) - float(prev_end))
