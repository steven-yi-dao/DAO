import type { TranscriptFile } from '../types';

export const ALLOWED_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'aac'];
export const MAX_BYTES = 500 * 1024 * 1024;
export const IDLE_WARN_MS = 14 * 60 * 1000;
export const IDLE_LIMIT_S = 60;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}

export function formatSrtTime(seconds: number): string {
  const ms = Math.round((seconds % 1) * 1000);
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(r).padStart(2, '0') +
    ',' +
    String(ms).padStart(3, '0')
  );
}

export function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function buildTxt(file: TranscriptFile): string {
  return (file.segments ?? [])
    .map((s) => (s.speaker ? s.speaker + ': ' : '') + s.text)
    .join('\n\n');
}

export function buildSrt(file: TranscriptFile): string {
  return (file.segments ?? [])
    .map((s, i) => {
      return (
        i +
        1 +
        '\n' +
        formatSrtTime(s.start) +
        ' --> ' +
        formatSrtTime(s.end) +
        '\n' +
        (s.speaker ? '[' + s.speaker + '] ' : '') +
        s.text +
        '\n'
      );
    })
    .join('\n');
}

export function buildJson(file: TranscriptFile): string {
  return JSON.stringify(
    {
      file: file.name,
      segments: (file.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        speaker: s.speaker,
        text: s.text,
      })),
    },
    null,
    2,
  );
}
