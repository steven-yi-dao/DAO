"""WhisperX pipeline: transcribe, then word-align.

One fixed model tier and automatic language detection. Diarization is not
supported, which is what removes pyannote, the Hugging Face token, Secrets
Manager, and a large chunk of GPU memory pressure.

Weights load once into module state and stay warm for the life of the worker,
so back-to-back jobs skip the reload. The caches are deliberately bounded to
the *active* language: an unbounded per-language cache is what exhausts a T4's
16 GiB over a mixed workload.
"""

import gc
import json
import logging
import os
import time
from pathlib import Path

import torch
import whisperx

from . import config

log = logging.getLogger("whisperx.worker")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE = "float16" if DEVICE == "cuda" else "int8"
BATCH_SIZE = 16
SAMPLE_RATE = 16000  # whisperx.load_audio always resamples to this

# Words scoring below this are flagged for review in the editor UI.
LOW_CONFIDENCE = 0.5

_asr = None
_align: dict = {"lang": None, "model": None, "meta": None}


class JobLog:
    """Appends to the per-job log as the job runs, so `tail -f` works and a
    crash still leaves the timings that led up to it on disk."""

    def __init__(self, path: Path, job_id: str):
        self.path = path
        self.job_id = job_id
        self._fh = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = self.path.open("a", encoding="utf-8")
        return self

    def __exit__(self, *exc):
        if self._fh:
            self._fh.close()
        return False

    def __call__(self, msg: str) -> None:
        line = f"[{self.job_id}] {msg}"
        log.info(line)
        if self._fh:
            self._fh.write(line + "\n")
            self._fh.flush()


def _free_gpu() -> None:
    gc.collect()
    if DEVICE == "cuda":
        torch.cuda.empty_cache()


def load_model():
    """Called once at worker startup so the first real job doesn't pay for the
    weights. language=None leaves detection to Whisper per job."""
    global _asr
    if _asr is None:
        log.info("loading ASR model %s on %s (compute=%s)", config.MODEL_NAME, DEVICE, COMPUTE)
        os.environ.setdefault("HF_HOME", str(config.MODELS_DIR))
        _asr = whisperx.load_model(
            config.MODEL_NAME,
            DEVICE,
            compute_type=COMPUTE,
            language=None,
            download_root=str(config.MODELS_DIR),
        )
    return _asr


def _align_for(lang: str):
    """Hold the alignment model for exactly one language. Switching languages
    drops the previous model and hands the memory back before loading the next,
    rather than accumulating one per language until the GPU is full."""
    if _align["lang"] != lang:
        _align["model"] = None
        _align["meta"] = None
        _free_gpu()
        model, meta = whisperx.load_align_model(language_code=lang, device=DEVICE)
        _align.update({"lang": lang, "model": model, "meta": meta})
    return _align["model"], _align["meta"]


def _shape_words(words: list) -> list:
    """Match the SPA's Word type: display keeps trailing spacing, low drives the
    review highlight."""
    shaped = []
    for i, word in enumerate(words):
        text = str(word.get("word", "")).strip()
        if not text:
            continue
        score = word.get("score")
        shaped.append(
            {
                "display": text + (" " if i < len(words) - 1 else ""),
                # bool() is load-bearing: whisperx hands back numpy floats, so the
                # comparison yields np.bool_ and `and` returns that object rather
                # than a Python bool. json.dumps refuses it.
                "low": bool(score is not None and score < LOW_CONFIDENCE),
            }
        )
    return shaped


def _shape_segments(segments: list) -> list:
    return [
        {
            "start": round(float(seg.get("start", 0.0)), 3),
            "end": round(float(seg.get("end", 0.0)), 3),
            "speaker": seg.get("speaker"),
            "text": str(seg.get("text", "")).strip(),
            "words": _shape_words(seg.get("words") or []),
        }
        for seg in segments
    ]


def run(job_id: str, audio_file: Path, log_file: Path) -> dict:
    """Transcribe one file. Returns the transcript payload; raises on failure
    after recording why in the job log."""
    t0 = time.time()
    with JobLog(log_file, job_id) as emit:
        try:
            emit(f"start file={audio_file.name} model={config.MODEL_NAME} device={DEVICE}")
            asr = load_model()

            audio = whisperx.load_audio(str(audio_file))
            duration = round(len(audio) / SAMPLE_RATE, 1)
            emit(f"loaded {duration}s audio")

            t = time.time()
            result = asr.transcribe(audio, batch_size=BATCH_SIZE)
            lang = result["language"]
            emit(f"transcribe {time.time() - t:.1f}s (lang={lang})")

            t = time.time()
            align_model, meta = _align_for(lang)
            result = whisperx.align(
                result["segments"], align_model, meta, audio, DEVICE,
                return_char_alignments=False,
            )
            emit(f"align {time.time() - t:.1f}s")

            segments = _shape_segments(result["segments"])
            emit(f"DONE {len(segments)} segments, {duration}s audio, {time.time() - t0:.1f}s total")

            return {
                "jobId": job_id,
                "language": lang,
                "segments": segments,
                "durationSec": duration,
            }
        except Exception as exc:
            emit(f"FAILED after {time.time() - t0:.1f}s: {type(exc).__name__}: {exc}")
            _free_gpu()
            raise


def write_transcript(path: Path, payload: dict) -> None:
    """Write via a temp file so a reader never sees a partial transcript."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    body = {"jobId": payload["jobId"], "language": payload["language"], "segments": payload["segments"]}
    tmp.write_text(json.dumps(body), encoding="utf-8")
    os.replace(tmp, path)
