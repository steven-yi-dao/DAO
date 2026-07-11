import type { FileStatus } from '../types';

export interface StatusMeta {
  label: string;
  color: string;
  bg: string;
}

const STATUS_META: Record<FileStatus, StatusMeta> = {
  uploading: { label: 'Uploading', color: '#8A6A1E', bg: '#F7EDDD' },
  queued: { label: 'Queued', color: '#6E6B62', bg: '#EDEAE2' },
  processing: { label: 'Processing', color: '#8A6A1E', bg: '#F7EDDD' },
  done: { label: 'Done', color: '#2E6B45', bg: '#E4F0E8' },
  error: { label: 'Error', color: '#B3432E', bg: '#F7E4DE' },
};

export function getStatusMeta(status: FileStatus): StatusMeta {
  return STATUS_META[status];
}

export const LANGUAGE_LABELS: Record<string, string> = {
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  es: 'Spanish',
  fr: 'French',
  auto: 'Auto-detect',
};

export const MODEL_LABELS: Record<string, string> = {
  fast: 'Fast',
  balanced: 'Balanced',
  accurate: 'Most accurate',
};
