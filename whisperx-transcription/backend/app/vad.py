"""Voice-activity correction of caption boundaries (BetterTranscribe).

WhisperX's segment boundaries come from wav2vec2 forced alignment, so they mark
the first and last *word*, not the edge of the *utterance*. Breaths, hesitation
and trailing consonants drag those edges around, which is what makes employees
hand-nudge every .srt. WhisperX also merges two utterances into one caption when
the pause between them is too short to trigger a chunk break.

A second silero-vad pass fixes both. It is not redundant with the VAD whisperx
runs internally: that one is tuned to chunk audio for the ASR, this one is tuned
for caption cut points, with its own snap tolerance and split threshold.

The module is deliberately split in two:

  speech_regions()   touches torch and the model. One line of real work.
  correct_segments() is pure Python over dicts and floats.

All the judgement lives in the second one, so the test suite can exercise it on
a bare interpreter with no torch, no model and no GPU.
"""

import logging

from . import config

log = logging.getLogger("whisperx.worker")

# Guard band used when pushing a boundary off a neighbour, and the rounding the
# transcript is written at. One millisecond is below SRT's resolution, so this
# can never produce two captions that appear to overlap.
EPSILON_S = 0.001

_model = None


# ---- the torch half ---------------------------------------------------------


def speech_regions(audio, sample_rate: int = 16000) -> list[tuple[float, float]]:
    """Speech intervals in seconds, as [(start, end), ...] sorted by start.

    `audio` is the float32 mono array `whisperx.load_audio` already produced at
    16 kHz, so there is no second decode and no second file read.

    Runs on CPU on purpose. The model is ~2 MB and the pass is a rounding error
    next to transcription; leaving the T4 alone is worth more than the speed.
    Weights load once and stay warm for the life of the worker, the same way the
    ASR and alignment models do.
    """
    global _model

    import torch
    from silero_vad import get_speech_timestamps, load_silero_vad

    if _model is None:
        log.info("loading silero-vad model on cpu")
        _model = load_silero_vad()

    wav = torch.from_numpy(audio) if not isinstance(audio, torch.Tensor) else audio
    stamps = get_speech_timestamps(
        wav, _model, sampling_rate=sample_rate, return_seconds=True
    )
    return [(float(s["start"]), float(s["end"])) for s in stamps]


# ---- the pure half ----------------------------------------------------------


def correct_segments(segments: list, regions: list, emit=None) -> list:
    """Split and snap caption boundaries against VAD speech regions.

    Runs on the *raw aligned* segments, before `transcribe._shape_segments`,
    because splitting needs the per-word timings that shaping discards.

    Returns a new list; the input is not mutated. Failure is never fatal — with
    no regions to work from the segments come back untouched and the job still
    succeeds as plain WhisperX output.
    """
    say = emit or (lambda _msg: None)
    if not segments:
        return list(segments)
    if not regions:
        say("vad no speech regions detected - boundaries left untouched")
        return list(segments)

    regions = sorted((float(a), float(b)) for a, b in regions)
    pieces, splits = _split_all(segments, regions, say)

    # Propose every boundary first, so the overlap guards below can see where
    # the *next* caption intends to start rather than where it used to.
    proposed = [
        (
            _snap(seg["start"], [r[0] for r in regions]),
            _snap(seg["end"], [r[1] for r in regions]),
        )
        for seg in pieces
    ]

    out: list = []
    snapped = 0
    prev_end = None
    for i, seg in enumerate(pieces):
        was = (float(seg["start"]), float(seg["end"]))
        start, end = proposed[i]

        # Never run into the caption before or the caption after.
        if prev_end is not None and start < prev_end:
            start = prev_end + EPSILON_S
        next_start = proposed[i + 1][0] if i + 1 < len(proposed) else None
        if next_start is not None and end > next_start:
            end = next_start - EPSILON_S

        # Anything the guards made nonsensical falls back to what WhisperX said,
        # which is the whole safety story: a correction that cannot be applied
        # cleanly is abandoned rather than forced.
        if end - start < config.VAD_MIN_SEGMENT_S:
            start, end = was
            if prev_end is not None and start < prev_end:
                start = prev_end

        # float() before round(), not after: whisperx hands back numpy floats
        # (word bounds come off a pandas Series), and round() on one returns
        # another numpy float that json.dumps refuses. _shape_segments would
        # coerce these later anyway, but this function should not depend on a
        # downstream stage to make its own output serialisable.
        start, end = round(float(start), 3), round(float(end), 3)
        for label, before, after in (("start", was[0], start), ("end", was[1], end)):
            if abs(after - before) >= EPSILON_S:
                snapped += 1
                say(f"vad seg {i} {label} {before:.3f} -> {after:.3f} ({after - before:+.3f})")

        out.append({**seg, "start": start, "end": end})
        prev_end = end

    say(f"vad {len(regions)} regions, {splits} split(s), {snapped}/{2 * len(out)} bounds snapped")
    return out


def _snap(value, edges: list) -> float:
    """Move `value` to the nearest VAD edge within the snap tolerance.

    Outside the tolerance the value is left alone: WhisperX was probably right
    and VAD probably missed, and moving a boundary a long way is how you land it
    on a *neighbouring* utterance.
    """
    value = float(value)
    if not edges:
        return value
    nearest = min(edges, key=lambda e: abs(e - value))
    return nearest if abs(nearest - value) <= config.VAD_SNAP_TOLERANCE_S else value


def _split_all(segments: list, regions: list, say) -> tuple[list, int]:
    pieces: list = []
    splits = 0
    for seg in segments:
        parts = _split_one(seg, regions)
        if len(parts) > 1:
            splits += len(parts) - 1
            for part in parts[1:]:
                say(f"vad split at {part['start']:.3f}")
        pieces.extend(parts)
    return pieces, splits


def _split_one(seg: dict, regions: list) -> list:
    """Break one segment wherever it spans a silence VAD agrees is silent."""
    words = list(seg.get("words") or [])
    if len(words) < 2:
        return [seg]

    groups: list[list] = [[]]
    last_end = None
    for word in words:
        start, end = word.get("start"), word.get("end")
        # Alignment drops timings on some words. They ride along with whatever
        # group is open and can never themselves be a split point.
        if start is None or end is None:
            groups[-1].append(word)
            continue
        if (
            last_end is not None
            and groups[-1]
            and float(start) - last_end >= config.VAD_MIN_SPLIT_SILENCE_S
            and _speech_within(regions, last_end, float(start)) < config.VAD_GAP_SPEECH_TOLERANCE_S
        ):
            groups.append([])
        groups[-1].append(word)
        last_end = float(end)

    groups = [g for g in groups if g]
    if len(groups) < 2:
        return [seg]

    parts = []
    for group in groups:
        timed = [w for w in group if w.get("start") is not None and w.get("end") is not None]
        if not timed:
            # No anchor to place this piece, so it is not a piece — fold it back
            # rather than invent a timestamp for it.
            return [seg]
        text = " ".join(str(w.get("word", "")).strip() for w in group).strip()
        parts.append(
            {
                **seg,
                "start": float(timed[0]["start"]),
                "end": float(timed[-1]["end"]),
                "text": text,
                "words": group,
            }
        )
    return parts


def _speech_within(regions: list, start: float, end: float) -> float:
    """Seconds of VAD-detected speech inside [start, end).

    A gap that VAD says still contains speech is alignment having lost a quiet
    word, not a pause — splitting there would cut a sentence in half.
    """
    if end <= start:
        return 0.0
    total = 0.0
    for a, b in regions:
        if b <= start:
            continue
        if a >= end:
            break
        total += min(b, end) - max(a, start)
    return total
