/** Typed client for the WhisperX backend (see backend/template.yaml).
 *
 *  Nothing here touches React state — App.tsx still drives its mocks. Phase 5
 *  swaps the mock drivers for these calls.
 */

import type { FileStatus, Segment, TranscriptionSettings } from '../types';
import { idToken } from './auth';
import { backendConfig } from './config';

export type JobStatus = 'CREATED' | 'UPLOADED' | 'QUEUED' | 'PROCESSING' | 'DONE' | 'ERROR';

export interface Job {
  jobId: string;
  fileName: string;
  sizeBytes: number;
  durationSec: number | null;
  model: string;
  language: string;
  diarize: boolean;
  status: JobStatus;
  segmentCount: number | null;
  errorMsg: string | null;
  createdAt: string;
  updatedAt: string;
  transcriptUrl?: string;
  logUrl?: string;
}

export interface Transcript {
  jobId: string;
  language: string;
  segments: Segment[];
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Backend status → the UI's FileStatus. Both CREATED and UPLOADED read as
 *  'uploading' because from the user's side the file isn't in the queue until
 *  submit succeeds. */
const STATUS_MAP: Record<JobStatus, FileStatus> = {
  CREATED: 'uploading',
  UPLOADED: 'uploading',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
};

export function toFileStatus(status: JobStatus): FileStatus {
  return STATUS_MAP[status] ?? 'error';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await idToken();
  if (!token) throw new ApiError(401, 'Your session expired — please sign in again.');

  const res = await fetch(`${backendConfig().apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
      authorization: token,
    },
  });

  if (!res.ok) {
    const message = await res
      .json()
      .then((b: { message?: string }) => b.message)
      .catch(() => null);
    throw new ApiError(res.status, message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

interface CreateJobResponse {
  jobId: string;
  uploadUrl: string;
  expiresIn: number;
}

export function createJob(
  file: File,
  settings: TranscriptionSettings,
  durationSec?: number,
): Promise<CreateJobResponse> {
  return request<CreateJobResponse>('/jobs', {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      sizeBytes: file.size,
      model: settings.model,
      language: settings.language,
      diarize: settings.diarization,
      durationSec: durationSec ?? null,
    }),
  });
}

/** Presigned PUT straight to S3 — the file never passes through the API.
 *  Uses XHR rather than fetch because only XHR reports upload progress. */
export function uploadFile(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.((e.loaded / e.total) * 100);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new ApiError(xhr.status, `Upload failed (${xhr.status})`));
      }
    });
    xhr.addEventListener('error', () => reject(new ApiError(0, 'Upload failed — check your connection.')));
    xhr.addEventListener('abort', () => reject(new ApiError(0, 'Upload cancelled.')));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

export function submitJob(jobId: string): Promise<{ jobId: string; status: JobStatus }> {
  return request(`/jobs/${encodeURIComponent(jobId)}/submit`, { method: 'POST' });
}

export function listJobs(): Promise<Job[]> {
  return request<{ jobs: Job[] }>('/jobs').then((r) => r.jobs);
}

export function getJob(jobId: string): Promise<Job> {
  return request(`/jobs/${encodeURIComponent(jobId)}`);
}

/** Fetches the transcript body from the presigned URL on a DONE job. The URL is
 *  already authenticated, so this one call deliberately skips the JWT header. */
export async function fetchTranscript(job: Job): Promise<Transcript> {
  if (!job.transcriptUrl) throw new ApiError(409, 'Transcript is not ready yet.');
  const res = await fetch(job.transcriptUrl);
  if (!res.ok) throw new ApiError(res.status, 'Could not download the transcript.');
  return res.json() as Promise<Transcript>;
}

/** Full create → upload → submit sequence for one file. */
export async function startTranscription(
  file: File,
  settings: TranscriptionSettings,
  opts: { onProgress?: (percent: number) => void; durationSec?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { jobId, uploadUrl } = await createJob(file, settings, opts.durationSec);
  await uploadFile(uploadUrl, file, opts.onProgress, opts.signal);
  await submitJob(jobId);
  return jobId;
}
