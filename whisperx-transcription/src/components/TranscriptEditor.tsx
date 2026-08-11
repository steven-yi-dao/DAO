import type { TranscriptFile } from '../types';
import { formatBytes, formatClock, formatDuration } from '../lib/utils';
import './TranscriptEditor.css';

interface TranscriptEditorProps {
  file: TranscriptFile;
  playhead: number;
  /** The transcript lives in a separate file on the server and is fetched on open. */
  transcriptPending: boolean;
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
  playhead,
  transcriptPending,
  onBack,
  onScrub,
  onSegmentEdit,
  onDownload,
}: TranscriptEditorProps) {
  const playheadPercent = file.duration ? Math.min(100, (playhead / file.duration) * 100) : 0;

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

          <div className="editor__video" aria-hidden="true">
            <div className="editor__video-stage">
              <div className="editor__video-center">
                <div className="editor__play">
                  <div className="editor__play-triangle" />
                </div>
                <div className="editor__video-caption">video preview — source recording drops in here</div>
              </div>
            </div>
            <div className="editor__video-bar">
              <span className="editor__video-time">{formatClock(playhead)}</span>
              <div className="editor__scrubber">
                <div className="editor__scrubber-fill" style={{ width: `${playheadPercent}%` }} />
              </div>
              <span className="editor__video-time">{formatDuration(file.duration)}</span>
            </div>
          </div>
        </>
      )}

      {transcriptPending && (
        <p className="editor__pending" role="status">
          Loading transcript…
        </p>
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
          return (
            <div key={idx} className="segment">
              <button
                type="button"
                className="segment__time"
                onClick={() => onScrub(seg.start)}
                aria-label={`Jump to ${formatClock(seg.start)}`}
              >
                {formatClock(seg.start)}
              </button>
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
