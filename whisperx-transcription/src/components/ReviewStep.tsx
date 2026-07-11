import type { TranscriptFile } from '../types';
import { formatDuration } from '../lib/utils';

interface ReviewStepProps {
  files: TranscriptFile[];
  onViewFile: (id: string) => void;
  onBackToProcess: () => void;
}

export function ReviewStep({ files, onViewFile, onBackToProcess }: ReviewStepProps) {
  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1F1F1F', margin: '0 0 16px' }}>Review &amp; download</h2>
      {files.map((file) => (
        <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', border: '1px solid #E4E1D8', borderRadius: 9, background: '#fff', marginBottom: 9 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1F1F1F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {file.name}
            </div>
            <div style={{ font: "11.5px/1.4 'IBM Plex Mono', monospace", color: '#8A8678', marginTop: 2 }}>
              {file.duration ? formatDuration(file.duration) : '—'}
            </div>
          </div>
          {file.status === 'done' && (
            <button
              onClick={() => onViewFile(file.id)}
              style={{ background: '#3A5A9F', border: 'none', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '8px 15px', borderRadius: 6 }}
            >
              View transcript
            </button>
          )}
          {file.status === 'error' && <span style={{ fontSize: 12, fontWeight: 600, color: '#B3432E' }}>Failed</span>}
        </div>
      ))}
      <button
        onClick={onBackToProcess}
        style={{ marginTop: 16, background: 'none', border: 'none', color: '#3A5A9F', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
      >
        ← Back to processing
      </button>
    </div>
  );
}
