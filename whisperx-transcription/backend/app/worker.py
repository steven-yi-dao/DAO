"""The queue loop: one job at a time, forever.

Durability comes from the SQLite row, not from process memory. If this process
dies mid-job the row is left RUNNING, and the next startup requeues it — that
is the whole recovery story, and it is why no external queue is needed.
"""

import logging
import signal
import time

from . import config, db, storage, transcribe

log = logging.getLogger("whisperx.worker")

_stop = False


def _handle_signal(signum, _frame):
    """Finish the job in flight, then exit. Compose sends SIGTERM on restart and
    deploy; killing mid-transcribe would just cost a full rerun."""
    global _stop
    log.info("signal %s received — will exit after the current job", signum)
    _stop = True


def process(conn, row) -> None:
    job_id = row["id"]
    audio = storage.audio_path(job_id, row["stored_name"])
    log_file = config.log_path(job_id)

    if not audio.exists():
        db.finish_error(conn, job_id, "Source audio is missing.")
        log.error("job %s has no audio at %s", job_id, audio)
        return

    try:
        payload = transcribe.run(job_id, audio, log_file)
    except Exception as exc:
        db.finish_error(conn, job_id, f"{type(exc).__name__}: {exc}")
        log.exception("job %s failed", job_id)
        return

    transcribe.write_transcript(config.transcript_path(job_id), payload)
    db.finish_ok(
        conn,
        job_id,
        language=payload["language"],
        segment_count=len(payload["segments"]),
        duration_sec=payload["durationSec"],
    )
    log.info("job %s done (%d segments)", job_id, len(payload["segments"]))


def sweep(conn) -> None:
    """Seven-day deletion of source audio. Rows and transcripts are kept."""
    for row in db.reapable(conn, config.RETENTION_DAYS):
        storage.delete_audio(row["id"])
        db.mark_audio_deleted(conn, row["id"])
        log.info("reaped audio for %s", row["id"])
    orphans = storage.sweep_tmp()
    if orphans:
        log.info("removed %d orphaned upload part files", orphans)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    config.ensure_dirs()
    conn = db.connect()
    db.init(conn)

    requeued = db.recover_running(conn)
    if requeued:
        log.warning("requeued %d job(s) left RUNNING by a previous process", requeued)

    transcribe.load_model()
    log.info("worker ready")

    last_sweep = 0.0
    while not _stop:
        row = db.claim_next(conn)
        if row is not None:
            process(conn, row)
            continue

        now = time.time()
        if now - last_sweep > config.RETENTION_SWEEP_INTERVAL_S:
            try:
                sweep(conn)
            except Exception:
                log.exception("retention sweep failed")
            last_sweep = now
        time.sleep(config.POLL_INTERVAL_S)

    log.info("worker stopped")
    conn.close()


if __name__ == "__main__":
    main()
