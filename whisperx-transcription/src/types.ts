/**
 * `selected` and `uploading` are client-only: they describe a file that exists
 * in the browser and has no row on the server yet. The other four map 1:1 onto
 * the backend's QUEUED / RUNNING / DONE / ERROR.
 */
export type FileStatus = 'selected' | 'uploading' | 'queued' | 'processing' | 'done' | 'error';

/**
 * Which post-alignment treatment produced (or will produce) a transcript.
 * `standard` is WhisperX on its own; `vad` is BetterTranscribe, the
 * experimental silero-vad boundary correction. Mirrors `db.PIPELINES`.
 */
export type Pipeline = 'standard' | 'vad';

export interface Word {
  display: string;
  low: boolean;
}

export interface Segment {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
  words: Word[];
}

export interface TranscriptFile {
  /** Stable for the file's whole lifetime, so React keys and the queue
   *  announcer don't see a row vanish and reappear when the server id lands. */
  id: string;
  /** The server's job id, or null while the file is only staged in the browser. */
  jobId: string | null;
  name: string;
  size: number;
  duration: number;
  status: FileStatus;
  /** Which tool this file was sent to. Staged rows carry the tool the session
   *  was opened with, so the queue can label a file before it has a job id. */
  pipeline: Pipeline;
  /** Upload percentage only. Once the server has the file there is nothing
   *  finer than the status to report, so this stays at 100. */
  progress: number;
  errorMsg: string | null;
  date?: string;
  segments?: Segment[] | null;
}

export type NavTab = 'new' | 'history';
export type FlowStep = 1 | 2 | 3;
export type SessionState = 'disconnected' | 'connecting' | 'connected';
export type FileSource = 'queue' | 'history';
