import type { Segment, TranscriptFile, Word } from '../types';

export const ALLOWED_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'aac'];
export const MAX_BYTES = 500 * 1024 * 1024;
export const IDLE_WARN_MS = 14 * 60 * 1000;
export const IDLE_LIMIT_S = 60;
export const IDLE_TOTAL_S = IDLE_WARN_MS / 1000 + IDLE_LIMIT_S; // 900

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

export function estimateDuration(bytes: number): number {
  return Math.min(3600, Math.max(20, Math.round(bytes / (1024 * 28))));
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

interface ScriptLine {
  t: number;
  text: string;
  low: string[];
}

function scriptLines(): ScriptLine[] {
  return [
    {
      t: 0,
      text: "Thanks for coming in. I know exam week is coming up, so I want to make sure your accommodations are locked in before then.",
      low: ['accommodations'],
    },
    {
      t: 7,
      text: 'I appreciate that. The main thing I need is extended time and a quiet testing room.',
      low: ['extended', 'quiet'],
    },
    {
      t: 14,
      text: "That's already on file from last semester. Do you want the same fifty percent extension, or has anything changed?",
      low: ['fifty'],
    },
    {
      t: 22,
      text: 'Fifty percent still works. I might also need the exam read aloud for the statistics final.',
      low: ['percent', 'statistics'],
    },
    {
      t: 30,
      text: "We can arrange a reader or a text-to-speech version, whichever you're more comfortable with.",
      low: ['reader', 'text-to-speech'],
    },
    {
      t: 38,
      text: "Text-to-speech is fine — I've used it before in the testing center.",
      low: ['text-to-speech'],
    },
    {
      t: 44,
      text: "Great, I'll email the professor today and get the testing center notified.",
      low: [],
    },
    {
      t: 52,
      text: 'Thank you. Can you also loop in my advisor about the housing accommodation renewal?',
      low: ['advisor', 'renewal'],
    },
    {
      t: 59,
      text: "Yes, I'll send that request this afternoon and follow up with both of you by Friday.",
      low: [],
    },
  ];
}

function genWords(text: string, lowList: string[]): Word[] {
  const lowSet = new Set((lowList || []).map((w) => w.toLowerCase()));
  const tokens = text.split(' ');
  return tokens.map((tok, i) => {
    const clean = tok.replace(/[.,!?;:—]/g, '').toLowerCase();
    const isLow = lowSet.has(clean);
    return {
      display: tok + (i < tokens.length - 1 ? ' ' : ''),
      low: isLow,
    };
  });
}

export function genSegments(diarization: boolean): Segment[] {
  const lines = scriptLines();
  return lines.map((line, i) => {
    const end = i < lines.length - 1 ? lines[i + 1].t : line.t + 8;
    return {
      start: line.t,
      end,
      speaker: diarization ? (i % 2 === 0 ? 'Speaker 1' : 'Speaker 2') : null,
      text: line.text,
      words: genWords(line.text, line.low),
    };
  });
}

export function seedQueue(): TranscriptFile[] {
  return [
    {
      id: 'q1',
      name: 'Hello-world.wav',
      size: 2202010, // 2.1 MB
      duration: estimateDuration(2202010),
      status: 'uploading',
      progress: 0,
      errorMsg: null,
      uploader: 'Steven Yi',
      external: true,
      segments: null,
    },
  ];
}

export function seedHistory(): TranscriptFile[] {
  return [
    {
      id: 'h1',
      name: 'Intro_Psych_Lecture_Captions.mp3',
      size: 41200000,
      duration: 2538,
      status: 'done',
      progress: 100,
      errorMsg: null,
      date: 'Jul 3, 2026',
      segments: genSegments(false),
    },
    {
      id: 'h2',
      name: 'Advising_Appointment_04-02.wav',
      size: 18400000,
      duration: 1122,
      status: 'error',
      progress: 100,
      errorMsg: 'Audio file appears corrupted — the header could not be read.',
      date: 'Jun 29, 2026',
      segments: null,
    },
  ];
}
