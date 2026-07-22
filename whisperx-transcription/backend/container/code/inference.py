"""WhisperX inference for a SageMaker async endpoint.

The async InputLocation points at a small manifest JSON, not the audio itself,
so a 500 MB upload never travels through the request body — the container pulls
it straight from S3.

Model weights load lazily and stay cached on the module, so a warm instance
handling back-to-back jobs skips the reload entirely.
"""

import io
import json
import logging
import os
import tempfile
import time

import boto3
import torch
import whisperx

log = logging.getLogger("whisperx")
logging.basicConfig(level=logging.INFO)

s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE = "float16" if DEVICE == "cuda" else "int8"
TIER_TO_MODEL = {"fast": "small", "balanced": "medium", "accurate": "large-v3"}
BATCH_SIZE = 16

# Words scoring below this are flagged for review in the editor UI.
LOW_CONFIDENCE = 0.5

_asr_cache: dict = {}
_align_cache: dict = {}
_diarize: dict = {"pipe": None}


def _hf_token() -> str:
    """The secret may hold a bare token or a JSON blob; accept either."""
    raw = secrets.get_secret_value(SecretId=os.environ["HF_TOKEN_SECRET_ARN"])["SecretString"]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip()
    if isinstance(parsed, dict):
        return str(parsed.get("token") or parsed.get("HF_TOKEN") or "").strip()
    return str(parsed).strip()


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
                "low": score is not None and score < LOW_CONFIDENCE,
            }
        )
    return shaped


def _shape_segments(segments: list) -> list:
    shaped = []
    for seg in segments:
        shaped.append(
            {
                "start": round(float(seg.get("start", 0.0)), 3),
                "end": round(float(seg.get("end", 0.0)), 3),
                "speaker": seg.get("speaker"),
                "text": str(seg.get("text", "")).strip(),
                "words": _shape_words(seg.get("words", []) or []),
            }
        )
    return shaped


# ---- SageMaker contract -----------------------------------------------------


def model_fn(model_dir):
    """Runs once at container start. Nothing heavy is loaded eagerly — the first
    job pays for the weights it actually needs."""
    log.info("container ready on %s (compute=%s)", DEVICE, COMPUTE)
    return {"device": DEVICE}


def input_fn(request_body, content_type="application/json"):
    if isinstance(request_body, bytes):
        request_body = request_body.decode("utf-8")
    return json.loads(request_body)


def predict_fn(manifest, ctx):
    """manifest = {jobId, userId, bucket, audioKey, model, language, diarize,
                   transcriptKey, logKey}"""
    job = manifest["jobId"]
    bucket = manifest["bucket"]
    logbuf = io.StringIO()
    t0 = time.time()

    def emit(msg):
        line = f"[{job}] {msg}"
        log.info(line)
        logbuf.write(line + "\n")

    def flush_log():
        try:
            s3.put_object(
                Bucket=bucket,
                Key=manifest["logKey"],
                Body=logbuf.getvalue().encode(),
                ContentType="text/plain",
            )
        except Exception:
            log.exception("could not write log for %s", job)

    try:
        emit(
            f"start file={manifest['audioKey']} model={manifest['model']} "
            f"lang={manifest.get('language') or 'auto'} diarize={manifest['diarize']}"
        )

        with tempfile.TemporaryDirectory() as tmp:
            local = os.path.join(tmp, "audio")
            t = time.time()
            s3.download_file(bucket, manifest["audioKey"], local)
            emit(f"download {time.time() - t:.1f}s")
            audio = whisperx.load_audio(local)

            # 1) transcribe
            model_name = TIER_TO_MODEL[manifest["model"]]
            requested_lang = manifest.get("language") or None
            cache_key = (model_name, requested_lang)
            if cache_key not in _asr_cache:
                emit(f"loading ASR model {model_name}")
                _asr_cache[cache_key] = whisperx.load_model(
                    model_name, DEVICE, compute_type=COMPUTE, language=requested_lang
                )
            t = time.time()
            result = _asr_cache[cache_key].transcribe(audio, batch_size=BATCH_SIZE)
            lang = result["language"]
            emit(f"transcribe {time.time() - t:.1f}s (lang={lang})")

            # 2) word-level alignment
            if lang not in _align_cache:
                emit(f"loading align model for {lang}")
                _align_cache[lang] = whisperx.load_align_model(lang, DEVICE)
            align_model, meta = _align_cache[lang]
            t = time.time()
            result = whisperx.align(
                result["segments"], align_model, meta, audio, DEVICE,
                return_char_alignments=False,
            )
            emit(f"align {time.time() - t:.1f}s")

            # 3) diarization
            if manifest["diarize"]:
                if _diarize["pipe"] is None:
                    emit("loading diarization pipeline")
                    _diarize["pipe"] = whisperx.DiarizationPipeline(
                        use_auth_token=_hf_token(), device=DEVICE
                    )
                t = time.time()
                result = whisperx.assign_word_speakers(_diarize["pipe"](audio), result)
                emit(f"diarize {time.time() - t:.1f}s")

            segments = _shape_segments(result["segments"])
            duration = round(len(audio) / 16000.0, 1)  # whisperx loads at 16 kHz
            emit(f"DONE {len(segments)} segments, {duration}s audio, {time.time() - t0:.1f}s total")

        s3.put_object(
            Bucket=bucket,
            Key=manifest["transcriptKey"],
            Body=json.dumps({"jobId": job, "language": lang, "segments": segments}).encode(),
            ContentType="application/json",
        )
        flush_log()

        # Becomes the async OutputLocation object that on_complete reads.
        return {
            "jobId": job,
            "status": "DONE",
            "language": lang,
            "segmentCount": len(segments),
            "durationSec": duration,
            "transcriptKey": manifest["transcriptKey"],
            "logKey": manifest["logKey"],
        }

    except Exception as exc:
        # Flush what we have so the per-job log explains the failure, then let
        # SageMaker route this to the error topic.
        emit(f"FAILED after {time.time() - t0:.1f}s: {type(exc).__name__}: {exc}")
        flush_log()
        raise


def output_fn(prediction, accept="application/json"):
    return json.dumps(prediction), "application/json"
