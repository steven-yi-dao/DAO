/**
 * `selected` and `uploading` are client-only: they describe a file that exists
 * in the browser and has no row on the server yet. The other four map 1:1 onto
 * the backend's QUEUED / RUNNING / DONE / ERROR.
 */
export type FileStatus = 'selected' | 'uploading' | 'queued' | 'processing' | 'done' | 'error';

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
