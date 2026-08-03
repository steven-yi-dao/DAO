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
  id: string;
  name: string;
  size: number;
  duration: number;
  status: FileStatus;
  progress: number;
  errorMsg: string | null;
  date?: string;
  uploader?: string;
  /** True for jobs owned by another user in the shared cloud queue (e.g. seeded demo files). */
  external?: boolean;
  segments?: Segment[] | null;
}

export type NavTab = 'new' | 'history';
export type FlowStep = 1 | 2 | 3;
export type SessionState = 'disconnected' | 'connecting' | 'connected';
export type FileSource = 'queue' | 'history';

export interface Instance {
  type: string;
  region: string;
  id: string;
}
