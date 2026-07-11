import type { FileSource, TranscriptFile } from '../types';
import { formatBytes, formatClock, formatDuration } from '../lib/utils';

interface TranscriptEditorProps {
  file: TranscriptFile;
  source: FileSource;
  playhead: number;
  onBack: () => void;
  onScrub: (seconds: number) => void;
  onSegmentEdit: (idx: number, text: string) => void;
  onDownload: (format: 'txt' | 'srt' | 'json') => void;
}

const downloadButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: '#fff',
  border: '1px solid #D5D1C6',
  color: '#1F1F1F',
  fontSize: 12.5,
  fontWeight: 600,
  padding: '7px 13px',
  borderRadius: 6,
  cursor: 'pointer',
};

export function TranscriptEditor({ file, playhead, onBack, onScrub, onSegmentEdit, onDownload }: TranscriptEditorProps) {
  const playheadPercent = file.duration ? Math.min(100, (playhead / file.duration) * 100) : 0;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 32, maxWidth: 720, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#3A5A9F', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}
        >
          ← Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8A8678' }}>Download as</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onDownload('txt')} title="Download as plain text" style={downloadButtonStyle}>
              <span style={{ color: '#3A5A9F', fontSize: 12 }}>↓</span> TXT
            </button>
            <button onClick={() => onDownload('srt')} title="Download as SRT subtitles" style={downloadButtonStyle}>
              <span style={{ color: '#3A5A9F', fontSize: 12 }}>↓</span> SRT
            </button>
            <button onClick={() => onDownload('json')} title="Download as JSON" style={downloadButtonStyle}>
              <span style={{ color: '#3A5A9F', fontSize: 12 }}>↓</span> JSON
            </button>
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1F1F1F', margin: '0 0 4px' }}>{file.name}</h2>
      <div style={{ font: "12.5px 'IBM Plex Mono', monospace", color: '#8A8678', marginBottom: 20 }}>
        {file.duration ? formatDuration(file.duration) : '—'} · {formatBytes(file.size)}
      </div>

      {file.segments && (
        <>
          <div style={{ fontSize: 12, color: '#8A8678', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#B3432E', flex: 'none' }} /> Red text
            marks words with a low confidence score — worth double-checking against the recording
          </div>
          <div style={{ marginBottom: 24, borderRadius: 11, overflow: 'hidden', background: '#1B1E24', border: '1px solid #E4E1D8' }}>
            <div
              style={{
                position: 'relative',
                aspectRatio: '16/9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundImage:
                  'repeating-linear-gradient(135deg,#262A32,#262A32 12px,#20232A 12px,#20232A 24px)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 0,
                      height: 0,
                      borderStyle: 'solid',
                      borderWidth: '9px 0 9px 15px',
                      borderColor: 'transparent transparent transparent #fff',
                      marginLeft: 3,
                    }}
                  />
                </div>
                <div style={{ font: "11.5px 'IBM Plex Mono', monospace", color: 'rgba(255,255,255,.55)' }}>
                  video preview — source recording drops in here
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#20232A' }}>
              <span style={{ font: "11px 'IBM Plex Mono', monospace", color: 'rgba(255,255,255,.5)' }}>
                {formatClock(playhead)}
              </span>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.18)', overflow: 'hidden' }}>
                <div style={{ width: `${playheadPercent}%`, height: '100%', background: '#7C9CD9' }} />
              </div>
              <span style={{ font: "11px 'IBM Plex Mono', monospace", color: 'rgba(255,255,255,.5)' }}>
                {formatDuration(file.duration)}
              </span>
            </div>
          </div>
        </>
      )}

      {file.status === 'error' && (
        <div style={{ background: '#F7E4DE', border: '1px solid #E9C4B8', borderRadius: 8, padding: '15px 17px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#B3432E', marginBottom: 3 }}>Transcription failed</div>
          <div style={{ fontSize: 13, color: '#8A4636' }}>{file.errorMsg}</div>
        </div>
      )}

      {file.segments &&
        file.segments.map((seg, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px solid #EDEAE2' }}>
            <button
              onClick={() => onScrub(seg.start)}
              title="Scrub video here"
              style={{
                width: 58,
                flex: 'none',
                font: "12px 'IBM Plex Mono', monospace",
                color: '#3A5A9F',
                padding: '2px 0 0',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {formatClock(seg.start)}
            </button>
            <div style={{ flex: 1 }}>
              {seg.speaker && (
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3A5A9F', marginBottom: 2 }}>{seg.speaker}</div>
              )}
              <div
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => onSegmentEdit(idx, e.currentTarget.innerText)}
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.65,
                  color: '#232323',
                  outline: 'none',
                  borderRadius: 4,
                  padding: '2px 5px',
                  margin: '-2px -5px',
                }}
              >
                {seg.words.map((w, wi) => (
                  <span key={wi} style={{ color: w.color, fontWeight: w.weight as React.CSSProperties['fontWeight'] }}>
                    {w.display}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}
