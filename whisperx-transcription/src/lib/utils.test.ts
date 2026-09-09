import { describe, expect, it } from 'vitest';
import type { Segment, TranscriptFile } from '../types';
import { buildSrt, formatSrtTime } from './utils';

function file(segments: Segment[]): TranscriptFile {
  return {
    id: 'f1',
    jobId: 'j1',
    name: 'clip.wav',
    size: 1024,
    duration: 10,
    status: 'done',
    pipeline: 'vad',
    progress: 100,
    errorMsg: null,
    segments,
  };
}

function segment(text: string, lines?: string[] | null): Segment {
  return {
    start: 0,
    end: 3.5,
    speaker: null,
    text,
    words: text.split(' ').map((w) => ({ display: w + ' ', low: false })),
    lines,
  };
}

describe('buildSrt', () => {
  it('writes a formatted caption one line per line', () => {
    const srt = buildSrt(
      file([segment('Your accommodations are already on file.', ['Your accommodations', 'are already on file.'])]),
    );
    expect(srt).toContain('Your accommodations\nare already on file.');
  });

  it('falls back to the flat text when the pipeline did no formatting', () => {
    // The standard pipeline leaves `lines` unset, and its captions still have
    // to come out of the download intact.
    const srt = buildSrt(file([segment('Thanks for coming in.', null)]));
    expect(srt).toContain('Thanks for coming in.');
  });

  it('treats an empty lines array as no formatting rather than an empty caption', () => {
    const srt = buildSrt(file([segment('Thanks for coming in.', [])]));
    expect(srt).toContain('Thanks for coming in.');
  });

  it('numbers cues from one and keeps the timestamp arrow', () => {
    const srt = buildSrt(file([segment('one', ['one']), segment('two', ['two'])]));
    expect(srt.startsWith('1\n00:00:00,000 --> 00:00:03,500\none\n')).toBe(true);
    expect(srt).toContain('\n2\n');
  });

  it('never lets a caption body run into the next cue number', () => {
    const srt = buildSrt(file([segment('a b', ['a', 'b']), segment('c', ['c'])]));
    expect(srt).toContain('a\nb\n\n2\n');
  });
});

describe('formatSrtTime', () => {
  it('writes hours, minutes, seconds and milliseconds', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(3661.5)).toBe('01:01:01,500');
  });
});
