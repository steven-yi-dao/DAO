import type { FileStatus } from '../types';

export interface StatusMeta {
  label: string;
  /** BEM modifier applied alongside `.status-badge`; colors live in StatusBadge.css. */
  className: string;
}

const STATUS_META: Record<FileStatus, StatusMeta> = {
  selected: { label: 'Ready', className: 'status-badge--queued' },
  uploading: { label: 'Uploading', className: 'status-badge--uploading' },
  queued: { label: 'Queued', className: 'status-badge--queued' },
  processing: { label: 'Processing', className: 'status-badge--processing' },
  done: { label: 'Done', className: 'status-badge--done' },
  error: { label: 'Error', className: 'status-badge--error' },
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
