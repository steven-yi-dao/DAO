import type { FileStatus, Segment, TranscriptFile } from '../types';

/**
 * Client for the FastAPI service in `backend/`. Every route lives under /api;
 * Caddy proxies it same-origin in production, so the relative default is right
 * and no CORS is involved.
 */
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export type ApiStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'ERROR';

/** Mirrors `db.to_api` in the backend, field for field. */
export interface ApiJob {
  jobId: string;
  fileName: string;
  sizeBytes: number;
  durationSec: number | null;
  status: ApiStatus;
  attempt: number;
  language: string | null;
  segmentCount: number | null;
  errorMsg: string | null;
  audioDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTranscript {
  jobId: string;
  language: string | null;
  segments: Segment[];
}

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const NETWORK_MESSAGE = "Couldn't reach the transcription server. This is usually temporary.";
const GENERIC_MESSAGE = 'The transcription server returned an unexpected response.';

/**
 * The API normalises FastAPI's `detail` into `{"message": "..."}`, but a
 * failure upstream of it — Caddy rejecting an oversize body, a proxy 502 —
 * arrives as plain text or HTML, so parsing has to be allowed to fail.
 */
function messageFrom(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch {
    /* not JSON */
  }
  return GENERIC_MESSAGE;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }
  if (!res.ok) throw new ApiError(res.status, messageFrom(await res.text()));
  if (res.status === 204) return undefined as T;
  return JSON.parse(await res.text()) as T;
}

export function health(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/health');
}

export async function listJobs(limit = 200): Promise<ApiJob[]> {
  const body = await request<{ jobs: ApiJob[] }>(`/jobs?limit=${limit}`);
  return body.jobs;
}

export function getJob(jobId: string): Promise<ApiJob> {
  return request<ApiJob>(`/jobs/${encodeURIComponent(jobId)}`);
}

/** 409 until the job is DONE — distinct from the 404 of an unknown job. */
export function getTranscript(jobId: string): Promise<ApiTranscript> {
  return request<ApiTranscript>(`/jobs/${encodeURIComponent(jobId)}/transcript`);
}

export function retryJob(jobId: string): Promise<ApiJob> {
  return request<ApiJob>(`/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
}

export function deleteJob(jobId: string): Promise<void> {
  return request<void>(`/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Uploads one file as multipart with the field name `file`, which is what
 * `create_job` expects. Uses XMLHttpRequest where it exists because `fetch`
 * has no upload-progress event; the `fetch` fallback keeps the client usable
 * from Node, where the contract test runs it.
 */
export function createJob(file: File, options: UploadOptions = {}): Promise<ApiJob> {
  const form = new FormData();
  form.append('file', file, file.name);

  if (typeof XMLHttpRequest === 'undefined') {
    return request<ApiJob>('/jobs', { method: 'POST', body: form, signal: options.signal }).then((job) => {
      options.onProgress?.(100);
      return job;
    });
  }
  return uploadWithProgress(form, options);
}

function uploadWithProgress(form: FormData, { onProgress, signal }: UploadOptions): Promise<ApiJob> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError(0, 'Upload cancelled.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/jobs');

    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable || !e.total) return;
      onProgress(Math.min(100, (e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let job: ApiJob;
        try {
          job = JSON.parse(xhr.responseText) as ApiJob;
        } catch {
          reject(new ApiError(xhr.status, GENERIC_MESSAGE));
          return;
        }
        onProgress?.(100);
        resolve(job);
        return;
      }
      reject(new ApiError(xhr.status, messageFrom(xhr.responseText)));
    };

    xhr.onerror = () => reject(new ApiError(0, NETWORK_MESSAGE));
    xhr.ontimeout = () => reject(new ApiError(0, NETWORK_MESSAGE));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled.'));

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

const STATUS_MAP: Record<ApiStatus, FileStatus> = {
  QUEUED: 'queued',
  RUNNING: 'processing',
  DONE: 'done',
  ERROR: 'error',
};

/**
 * An unrecognised status means this client is older than the server. Treating
 * it as still in flight stalls the flow honestly, where claiming `done` or
 * `error` would assert an outcome we don't know.
 */
export function toFileStatus(status: string): FileStatus {
  return STATUS_MAP[status as ApiStatus] ?? 'processing';
}

export function formatJobDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Server job to the shape the UI renders. Segments are fetched separately. */
export function mapJob(job: ApiJob): TranscriptFile {
  return {
    id: job.jobId,
    jobId: job.jobId,
    name: job.fileName,
    size: job.sizeBytes,
    duration: job.durationSec ?? 0,
    status: toFileStatus(job.status),
    progress: 100,
    errorMsg: job.errorMsg,
    date: formatJobDate(job.createdAt),
    segments: null,
  };
}

/** Error text fit to show a user, whatever was thrown. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : NETWORK_MESSAGE;
}
