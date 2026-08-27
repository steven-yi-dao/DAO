/**
 * Drives the real `src/lib/api.ts` against a real FastAPI process, so a change
 * on either side of the contract fails here instead of at runtime in a browser.
 *
 * Two things it deliberately does not cover:
 *  - the XMLHttpRequest upload path, since Node has no XMLHttpRequest. The
 *    fetch fallback is exercised instead; the XHR branch is unit-tested.
 *  - WhisperX itself. No GPU is involved, so the DONE job is finished by
 *    calling the backend's own `write_transcript` / `finish_ok` — the shape is
 *    real, the audio content is not.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ApiJob } from '../../src/lib/api';
import {
  ApiError,
  createJob,
  deleteJob,
  getJob,
  getTranscript,
  health,
  listJobs,
  mapJob,
  retryJob,
  toFileStatus,
} from '../../src/lib/api';
import { BACKEND_DIR, DATA_DIR, MAX_UPLOAD_BYTES, REPO_DIR, resolvePython } from './config';

/** Every key `db.to_api` returns. Kept in lockstep with ApiJob by the two
 *  type assertions below, so this list can't drift from the interface. */
const JOB_KEYS = [
  'jobId',
  'fileName',
  'sizeBytes',
  'durationSec',
  'status',
  'pipeline',
  'attempt',
  'language',
  'segmentCount',
  'errorMsg',
  'audioDeleted',
  'createdAt',
  'updatedAt',
] as const;

type Exhaustive<T extends never> = T;
export type NoFieldMissingFromList = Exhaustive<Exclude<keyof ApiJob, (typeof JOB_KEYS)[number]>>;
export type NoExtraFieldInList = Exhaustive<Exclude<(typeof JOB_KEYS)[number], keyof ApiJob>>;

const STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'ERROR'];

function audio(name = 'clip.wav', bytes = 2048): File {
  return new File([new Uint8Array(bytes)], name, { type: 'audio/wav' });
}

async function expectApiError(promise: Promise<unknown>, status: number, message?: string) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err, `expected a ${status}, got a success`).toBeInstanceOf(ApiError);
  expect(err.status).toBe(status);
  if (message !== undefined) expect(err.message).toBe(message);
  return err as ApiError;
}

describe('health', () => {
  it('answers the check the connect gate makes', async () => {
    await expect(health()).resolves.toEqual({ ok: true });
  });
});

describe('POST /api/jobs', () => {
  let job: ApiJob;

  beforeAll(async () => {
    job = await createJob(audio('contract-upload.wav'));
  });

  it('returns exactly the fields the client declares — no more, no fewer', () => {
    expect(Object.keys(job).sort()).toEqual([...JOB_KEYS].sort());
  });

  it('returns a queued job whose status the client knows how to map', () => {
    expect(STATUSES).toContain(job.status);
    expect(job.status).toBe('QUEUED');
    expect(toFileStatus(job.status)).toBe('queued');
  });

  it('echoes the file metadata the queue renders', () => {
    expect(job.fileName).toBe('contract-upload.wav');
    expect(job.sizeBytes).toBe(2048);
    expect(job.attempt).toBe(1);
    expect(job.audioDeleted).toBe(false);
    // Measured by the worker on success, so it is absent until then.
    expect(job.durationSec).toBeNull();
    expect(job.errorMsg).toBeNull();
  });

  it('produces a job the UI can render without an undefined field', () => {
    const file = mapJob(job);
    expect(file.name).toBe('contract-upload.wav');
    expect(file.status).toBe('queued');
    expect(file.duration).toBe(0);
    expect(file.date).not.toBe('');
  });

  it('defaults to the standard pipeline when the client does not ask for one', () => {
    expect(job.pipeline).toBe('standard');
  });

  it('records BetterTranscribe on the row the worker will claim', async () => {
    const vad = await createJob(audio('contract-vad.wav'), { pipeline: 'vad' });
    expect(vad.pipeline).toBe('vad');
    expect((await getJob(vad.jobId)).pipeline).toBe('vad');
  });

  it('rejects a pipeline it does not implement rather than silently running standard', async () => {
    await expectApiError(
      createJob(audio('contract-bogus.wav'), { pipeline: 'quantum' as never }),
      400,
      'Unknown pipeline.',
    );
  });

  it('rejects an unsupported format with the message the upload step shows', async () => {
    await expectApiError(
      createJob(audio('notes.txt')),
      400,
      'Unsupported format — try MP3, WAV, M4A, FLAC, or OGG.',
    );
  });

  it('rejects an oversize file with the message the upload step shows', async () => {
    await expectApiError(createJob(audio('huge.wav', MAX_UPLOAD_BYTES + 1)), 413, 'File too large — 500MB max.');
  });

  it('rejects an empty file', async () => {
    await expectApiError(createJob(audio('empty.wav', 0)), 400, 'File is empty.');
  });
});

describe('GET /api/jobs', () => {
  it('lists an uploaded job', async () => {
    const job = await createJob(audio('contract-list.wav'));
    const jobs = await listJobs();
    expect(jobs.map((j) => j.jobId)).toContain(job.jobId);
    expect(Object.keys(jobs[0]).sort()).toEqual([...JOB_KEYS].sort());
  });

  it('rejects a limit outside the allowed range as a 400, not a 422', async () => {
    await expectApiError(listJobs(0), 400);
    await expectApiError(listJobs(500), 400);
  });

  it('404s an unknown job with a message worth showing', async () => {
    await expectApiError(getJob('11111111-2222-3333-4444-555555555555'), 404, 'Job not found.');
  });
});

describe('GET /api/jobs/{id}/transcript', () => {
  it('answers 409, not 404, while the job is still queued', async () => {
    const job = await createJob(audio('contract-pending.wav'));
    await expectApiError(getTranscript(job.jobId), 409, 'Transcript is not ready yet.');
  });

  it('returns segments shaped the way the editor renders them once the job is done', async () => {
    const job = await createJob(audio('contract-done.wav'));
    finishJob(job.jobId);

    const transcript = await getTranscript(job.jobId);
    expect(transcript.jobId).toBe(job.jobId);
    expect(transcript.language).toBe('en');
    expect(transcript.segments.length).toBeGreaterThan(0);

    const segment = transcript.segments[0];
    expect(Object.keys(segment).sort()).toEqual(['end', 'speaker', 'start', 'text', 'words']);
    expect(typeof segment.start).toBe('number');
    expect(typeof segment.end).toBe('number');
    expect(typeof segment.text).toBe('string');
    // Diarization is off, so the editor's speaker label never renders.
    expect(segment.speaker).toBeNull();
    expect(segment.words.length).toBeGreaterThan(0);
    expect(typeof segment.words[0].display).toBe('string');
    expect(typeof segment.words[0].low).toBe('boolean');
    expect(segment.words.some((w) => w.low)).toBe(true);

    // The row picked up what the transcript file deliberately leaves out.
    const finished = await getJob(job.jobId);
    expect(finished.status).toBe('DONE');
    expect(finished.durationSec).toBe(7.25);
    expect(finished.language).toBe('en');
    expect(finished.segmentCount).toBe(transcript.segments.length);
    expect(mapJob(finished)).toMatchObject({ status: 'done', duration: 7.25 });
  });
});

describe('POST /api/jobs/{id}/retry', () => {
  it('refuses to retry a job that has not failed', async () => {
    const job = await createJob(audio('contract-retry.wav'));
    await expectApiError(retryJob(job.jobId), 409, 'Only failed jobs can be retried.');
  });
});

describe('DELETE /api/jobs/{id}', () => {
  it('removes the job and then reports it gone', async () => {
    const job = await createJob(audio('contract-delete.wav'));
    await expect(deleteJob(job.jobId)).resolves.toBeUndefined();
    await expectApiError(getJob(job.jobId), 404, 'Job not found.');
  });

  it('404s a job that never existed', async () => {
    await expectApiError(deleteJob('99999999-8888-7777-6666-555555555555'), 404, 'Job not found.');
  });
});

/** Runs the shipped DONE transition against the same /data the API is using. */
function finishJob(jobId: string): void {
  const python = resolvePython();
  if (!python) throw new Error('no python — global setup should have caught this');
  execFileSync(python, [join(REPO_DIR, 'tests', 'contract', 'finish_job.py'), jobId], {
    cwd: BACKEND_DIR,
    // Python puts the *script's* directory on sys.path, not the cwd, so the
    // backend package has to be named explicitly.
    env: { ...process.env, DATA_DIR, PYTHONPATH: BACKEND_DIR },
    stdio: 'inherit',
  });
}
