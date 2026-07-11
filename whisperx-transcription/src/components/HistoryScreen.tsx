import type { TranscriptFile } from '../types';
import { formatBytes, formatDuration } from '../lib/utils';
import { getStatusMeta } from '../lib/statusMeta';

interface HistoryScreenProps {
  history: TranscriptFile[];
  onView: (id: string) => void;
}

export function HistoryScreen({ history, onView }: HistoryScreenProps) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 32, maxWidth: 720, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1F1F1F', margin: '0 0 16px' }}>Job history</h2>
      {history.map((file) => {
        const meta = getStatusMeta(file.status);
        return (
          <div
            key={file.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              border: '1px solid #E4E1D8',
              borderRadius: 9,
              background: '#fff',
              marginBottom: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: '#1F1F1F',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {file.name}
              </div>
              <div style={{ font: "11.5px/1.4 'IBM Plex Mono', monospace", color: '#8A8678', marginTop: 2 }}>
                {file.date} · {formatBytes(file.size)} · {file.duration ? formatDuration(file.duration) : '—'}
              </div>
            </div>
            <div style={{ flex: 'none', textAlign: 'right' }}>
              {file.status === 'done' && (
                <>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: 20,
                      background: meta.bg,
                      color: meta.color,
                      marginRight: 10,
                    }}
                  >
                    Done
                  </span>
                  <button
                    onClick={() => onView(file.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#3A5A9F',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    View
                  </button>
                </>
              )}
              {file.status === 'error' && (
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: 20,
                    background: meta.bg,
                    color: meta.color,
                  }}
                >
                  Failed
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
