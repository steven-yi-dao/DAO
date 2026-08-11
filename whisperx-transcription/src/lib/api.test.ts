import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiJob } from './api';
import {
  ApiError,
  NETWORK_MESSAGE,
  createJob,
  deleteJob,
  errorMessage,
  formatJobDate,
  getTranscript,
  health,
  listJobs,
  mapJob,
  retryJob,
  toFileStatus,
} from './api';

const JOB: ApiJob = {
  jobId: '11111111-2222-3333-4444-555555555555',
  fileName: 'clip.wav',
  sizeBytes: 2048,
  durationSec: 137.4,
  status: 'DONE',
  attempt: 1,
  language: 'en',
  segmentCount: 42,
  errorMsg: null,
  audioDeleted: false,
  createdAt: '2026-08-03T18:22:41.123456+00:00',
  updatedAt: '2026-08-03T18:23:01.000000+00:00',
};

/** Minimal stand-in for the parts of Response that `request` touches. */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((res) => fetchMock.mockResolvedValueOnce(res));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('toFileStatus', () => {
  it('maps every status the backend can return', () => {
    expect(toFileStatus('QUEUED')).toBe('queued');
    expect(toFileStatus('RUNNING')).toBe('processing');
    expect(toFileStatus('DONE')).toBe('done');
    expect(toFileStatus('ERROR')).toBe('error');
  });

  it('treats an unrecognised status as still in flight rather than claiming an outcome', () => {
    expect(toFileStatus('CANCELLED')).toBe('processing');
    expect(toFileStatus('')).toBe('processing');
  });
});

describe('mapJob', () => {
  it('carries every field the UI renders', () => {
    const file = mapJob(JOB);
    expect(file).toEqual({
      id: JOB.jobId,
      jobId: JOB.jobId,
      name: 'clip.wav',
      size: 2048,
      duration: 137.4,
      status: 'done',
      progress: 100,
      errorMsg: null,
      date: formatJobDate(JOB.createdAt),
      segments: null,
    });
  });

  it('falls back to zero duration, which the server only sets on success', () => {
    expect(mapJob({ ...JOB, durationSec: null, status: 'QUEUED' }).duration).toBe(0);
  });

  it('keeps the failure message', () => {
    const file = mapJob({ ...JOB, status: 'ERROR', errorMsg: 'RuntimeError: CUDA out of memory' });
    expect(file.status).toBe('error');
    expect(file.errorMsg).toBe('RuntimeError: CUDA out of memory');
  });

  it('renders createdAt as a display date', () => {
    expect(mapJob(JOB).date).toBe('Aug 3, 2026');
  });

  it('does not crash on an unparseable timestamp', () => {
    expect(formatJobDate('not a date')).toBe('');
  });
});

describe('error handling', () => {
  it('surfaces the message from the API error envelope', async () => {
    stubFetch(jsonResponse(409, { message: 'Job is running — wait for it to finish.' }));
    const err = await deleteJob('abc').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('Job is running — wait for it to finish.');
  });

  it('falls back to a generic message when the body is not JSON', async () => {
    stubFetch(jsonResponse(502, '<html>Bad Gateway</html>'));
    const err = await health().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toBe('The transcription server returned an unexpected response.');
  });

  it('reports an unreachable server as status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const err = await health().catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toBe(NETWORK_MESSAGE);
  });

  it('errorMessage handles anything thrown', () => {
    expect(errorMessage(new ApiError(404, 'Job not found.'))).toBe('Job not found.');
    expect(errorMessage(new Error('boom'))).toBe(NETWORK_MESSAGE);
  });
});

describe('routes', () => {
  it('unwraps the jobs array and sends the limit', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { jobs: [JOB] }));
    await expect(listJobs(50)).resolves.toEqual([JOB]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/jobs?limit=50');
  });

  it('returns without parsing a body on 204', async () => {
    stubFetch({ ok: true, status: 204, text: async () => '' } as Response);
    await expect(deleteJob(JOB.jobId)).resolves.toBeUndefined();
  });

  it('distinguishes a transcript that is not ready from a job that does not exist', async () => {
    stubFetch(jsonResponse(409, { message: 'Transcript is not ready yet.' }));
    await expect(getTranscript(JOB.jobId)).rejects.toMatchObject({ status: 409 });

    stubFetch(jsonResponse(404, { message: 'Job not found.' }));
    await expect(getTranscript(JOB.jobId)).rejects.toMatchObject({ status: 404 });
  });

  it('posts a retry with no body', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { ...JOB, status: 'QUEUED', attempt: 2 }));
    await expect(retryJob(JOB.jobId)).resolves.toMatchObject({ status: 'QUEUED', attempt: 2 });
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'POST' });
  });

  it('escapes the job id into the path', async () => {
    const fetchMock = stubFetch(jsonResponse(200, JOB));
    await getTranscript('a b/c');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/jobs/a%20b%2Fc/transcript');
  });
});

/** Enough of XMLHttpRequest for the upload path; each instance is driven by hand. */
class FakeXhr {
  static last: FakeXhr | null = null;

  status = 0;
  responseText = '';
  method = '';
  url = '';
  sent: unknown = null;
  aborted = false;
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body: unknown) {
    this.sent = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }

  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

function useFakeXhr() {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return () => {
    if (!FakeXhr.last) throw new Error('no XMLHttpRequest was constructed');
    return FakeXhr.last;
  };
}

describe('createJob', () => {
  const file = new File(['fake audio bytes'], 'clip.wav', { type: 'audio/wav' });

  it('posts multipart to /api/jobs with the field name the API expects', async () => {
    const xhr = useFakeXhr();
    const promise = createJob(file);
    xhr().respond(201, JSON.stringify(JOB));
    await expect(promise).resolves.toEqual(JOB);

    expect(xhr().method).toBe('POST');
    expect(xhr().url).toBe('/api/jobs');
    const form = xhr().sent as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get('file') as File).name).toBe('clip.wav');
  });

  it('reports upload progress, ending at 100', async () => {
    const xhr = useFakeXhr();
    const seen: number[] = [];
    const promise = createJob(file, { onProgress: (p) => seen.push(p) });
    xhr().progress(0, 200);
    xhr().progress(50, 200);
    xhr().progress(200, 200);
    xhr().respond(201, JSON.stringify(JOB));
    await promise;

    expect(seen).toEqual([0, 25, 100, 100]);
    expect(Math.max(...seen)).toBe(100);
  });

  it('surfaces the size rejection the API sends', async () => {
    const xhr = useFakeXhr();
    const promise = createJob(file);
    xhr().respond(413, JSON.stringify({ message: 'File too large — 500MB max.' }));
    await expect(promise).rejects.toMatchObject({ status: 413, message: 'File too large — 500MB max.' });
  });

  it('surfaces the format rejection the API sends', async () => {
    const xhr = useFakeXhr();
    const promise = createJob(file);
    xhr().respond(400, JSON.stringify({ message: 'Unsupported format — try MP3, WAV, M4A, FLAC, or OGG.' }));
    await expect(promise).rejects.toMatchObject({
      status: 400,
      message: 'Unsupported format — try MP3, WAV, M4A, FLAC, or OGG.',
    });
  });

  it('rejects rather than hanging when the transport fails', async () => {
    const xhr = useFakeXhr();
    const promise = createJob(file);
    xhr().onerror?.();
    await expect(promise).rejects.toMatchObject({ status: 0, message: NETWORK_MESSAGE });
  });

  it('rejects on a 2xx whose body is not a job', async () => {
    const xhr = useFakeXhr();
    const promise = createJob(file);
    xhr().respond(201, 'not json');
    await expect(promise).rejects.toMatchObject({ status: 201 });
  });

  it('aborts when the signal fires', async () => {
    const xhr = useFakeXhr();
    const controller = new AbortController();
    const promise = createJob(file, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ message: 'Upload cancelled.' });
    expect(xhr().aborted).toBe(true);
  });

  it('falls back to fetch where there is no XMLHttpRequest', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined);
    const fetchMock = stubFetch(jsonResponse(201, JOB));
    await expect(createJob(file)).resolves.toEqual(JOB);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/jobs');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });
});
