import { useEffect, useRef, useState } from 'react';
import type { FileStatus, TranscriptFile } from '../types';

// Wording mirrors the visible status badges in the cloud queue.
const STATUS_TEXT: Partial<Record<FileStatus, string>> = {
  uploading: 'Uploading',
  queued: 'In queue',
  processing: 'Processing',
  done: 'Done',
  error: 'Error',
};

export interface Announcement {
  /** Bumped per announcement so repeated wording still re-announces. */
  id: number;
  text: string;
}

/**
 * Watches the shared cloud queue and produces a message whenever a file changes
 * status, so the transitions the badges show visually are also spoken.
 */
export function useQueueAnnouncements(files: TranscriptFile[]): Announcement {
  const seenRef = useRef<Map<string, FileStatus> | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>({ id: 0, text: '' });

  useEffect(() => {
    const current = new Map(files.map((f) => [f.id, f.status]));
    const previous = seenRef.current;
    seenRef.current = current;
    // The first pass only records a baseline — files already sitting in the
    // queue (and files just staged for upload) aren't a state change.
    if (!previous) return;

    const messages = files
      .filter((f) => previous.has(f.id) && previous.get(f.id) !== f.status && STATUS_TEXT[f.status])
      .map((f) => {
        const detail = f.status === 'error' && f.errorMsg ? ` ${f.errorMsg}` : '';
        return `${f.name}: ${STATUS_TEXT[f.status]}.${detail}`;
      });

    // Files that change together are announced as one message, not a burst.
    if (messages.length) setAnnouncement((prev) => ({ id: prev.id + 1, text: messages.join(' ') }));
  }, [files]);

  return announcement;
}
