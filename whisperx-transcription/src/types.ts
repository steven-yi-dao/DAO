export type FileStatus = 'uploading' | 'queued' | 'processing' | 'done' | 'error';

export interface Word {
  display: string;
  color: string;
  weight: string;
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
  segments?: Segment[] | null;
}

export type NavTab = 'new' | 'history';
export type FlowStep = 1 | 2 | 3;
export type SessionState = 'disconnected' | 'connecting' | 'connected';
export type FileSource = 'queue' | 'history';

export interface TranscriptionSettings {
  language: string;
  model: string;
  diarization: boolean;
}

export interface Instance {
  type: string;
  region: string;
  id: string;
}
