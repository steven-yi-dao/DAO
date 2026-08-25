import { useRef, type SyntheticEvent } from 'react';
import type { FileSource, TranscriptFile } from '../types';
import { formatBytes, formatClock, formatDuration } from '../lib/utils';
import './TranscriptEditor.css';

interface TranscriptEditorProps {
  file: TranscriptFile;
  source: FileSource;
  /** Object URL for the recording, or null when it is not in this browser session. */
  mediaUrl: string | null;
  playhead: number;
  onBack: () => void;
  onScrub: (seconds: number) => void;
  onSegmentEdit: (idx: number, text: string) => void;
  onDownload: (format: 'txt' | 'srt' | 'json') => void;
}

const DOWNLOAD_FORMATS: { format: 'txt' | 'srt' | 'json'; label: string; desc: string }[] = [
  { format: 'txt', label: 'TXT', desc: 'plain text' },
  { format: 'srt', label: 'SRT', desc: 'SRT subtitles' },
  { format: 'json', label: 'JSON', desc: 'JSON' },
];

export function TranscriptEditor({
  file,
  mediaUrl,
  playhead,
  onBack,
  onScrub,
  onSegmentEdit,
  onDownload,
}: TranscriptEditorProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // timeupdate fires several times a second; only whole-second moves are worth
  // reporting upward, which is all the active-segment marker needs.
  const lastReportedRef = useRef(-1);

  function handleTimeUpdate(e: SyntheticEvent<HTMLAudioElement>) {
    const seconds = Math.floor(e.currentTarget.currentTime);
    if (seconds === lastReportedRef.current) return;
    lastReportedRef.current = seconds;
    onScrub(seconds);
  }

  function jumpTo(seconds: number) {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = seconds;
      // Clicking a timestamp is a user gesture, so playback may start from here.
      void audio.play().catch(() => undefined);
    }
    lastReportedRef.current = Math.floor(seconds);
    onScrub(seconds);
  }

  return (
    <article className="editor">
      <div className="editor__topbar">
        <button type="button" className="editor__back" onClick={onBack}>
          ← Back
        </button>
        <div className="editor__downloads">
          <span className="editor__downloads-label">Download as</span>
          <div className="editor__download-group">
            {DOWNLOAD_FORMATS.map(({ format, label, desc }) => (
              <button
                key={format}
                type="button"
                className="editor__download-btn"
                onClick={() => onDownload(format)}
                aria-label={`Download as ${desc}`}
              >
                <span aria-hidden="true">↓</span> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <h1 className="editor__title">{file.name}</h1>
      <div className="editor__meta">
        {file.duration ? formatDuration(file.duration) : '—'} · {formatBytes(file.size)}
      </div>

      {file.segments && (
        <>
          <p className="editor__legend">
            <span className="editor__legend-swatch" aria-hidden="true" /> Red text marks words with a low confidence
            score — worth double-checking against the recording
          </p>

          {mediaUrl ? (
            <audio
              ref={audioRef}
              className="editor__audio"
              src={mediaUrl}
              controls
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              aria-label={`Recording of ${file.name}`}
            />
          ) : (
            <p className="editor__no-audio">
              The recording is not available to play here — it stays in the browser session it was uploaded from.
            </p>
          )}
        </>
      )}

      {file.status === 'error' && (
        <div className="editor__error" role="alert">
          <div className="editor__error-title">Transcription failed</div>
          <div className="editor__error-detail">{file.errorMsg}</div>
        </div>
      )}

      {file.segments &&
        file.segments.map((seg, idx) => {
          const lowWords = seg.words.filter((w) => w.low).map((w) => w.display.trim()).filter(Boolean);
          const active = playhead >= seg.start && playhead < seg.end;
          return (
            <div key={idx} className={active ? 'segment segment--active' : 'segment'}>
              {mediaUrl ? (
                <button
                  type="button"
                  className="segment__time"
                  onClick={() => jumpTo(seg.start)}
                  aria-label={`Play from ${formatClock(seg.start)}`}
                >
                  {formatClock(seg.start)}
                </button>
              ) : (
                <span className="segment__time segment__time--static">{formatClock(seg.start)}</span>
              )}
              <div className="segment__body">
                {seg.speaker && <div className="segment__speaker">{seg.speaker}</div>}
                <div
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  aria-label={`Edit transcript at ${formatClock(seg.start)}`}
                  className="segment__text"
                  onBlur={(e) => onSegmentEdit(idx, e.currentTarget.innerText)}
                >
                  {seg.words.map((w, wi) => (
                    <span key={wi} className={w.low ? 'word--low' : undefined}>
                      {w.display}
                    </span>
                  ))}
                </div>
                {lowWords.length > 0 && (
                  <span className="sr-only">Low-confidence words to verify: {lowWords.join(', ')}.</span>
                )}
              </div>
            </div>
          );
        })}
    </article>
  );
}
