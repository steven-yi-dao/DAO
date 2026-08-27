import type { TranscriptFile } from '../types';
import { formatBytes, formatDuration } from '../lib/utils';
import { PipelineChip } from './PipelineChip';
import { StatusBadge } from './StatusBadge';
import './HistoryScreen.css';

interface HistoryScreenProps {
  history: TranscriptFile[];
  onView: (id: string) => void;
}

export function HistoryScreen({ history, onView }: HistoryScreenProps) {
  return (
    <div className="history">
      <h1 className="history__heading">Job history</h1>
      <ul className="history__list">
        {history.map((file) => (
          <li key={file.id} className="history__row">
            <div className="history__row-main">
              <div className="file-name">{file.name}</div>
              <div className="file-meta">
                {file.date} · {formatBytes(file.size)} · {file.duration ? formatDuration(file.duration) : '—'}{' '}
                <PipelineChip pipeline={file.pipeline} />
              </div>
            </div>
            <div className="history__aside">
              {file.status === 'done' && (
                <>
                  <StatusBadge status="done" pill />
                  <button type="button" className="history__view" onClick={() => onView(file.id)}>
                    View
                  </button>
                </>
              )}
              {file.status === 'error' && <StatusBadge status="error" label="Failed" pill />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
