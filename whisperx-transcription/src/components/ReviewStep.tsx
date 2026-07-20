import type { TranscriptFile } from '../types';
import { formatDuration } from '../lib/utils';
import './ReviewStep.css';

interface ReviewStepProps {
  files: TranscriptFile[];
  onViewFile: (id: string) => void;
  onBackToProcess: () => void;
}

export function ReviewStep({ files, onViewFile, onBackToProcess }: ReviewStepProps) {
  const own = files.filter((f) => !f.external);
  return (
    <div>
      <h1 className="step-heading">Review &amp; download</h1>
      <ul className="review__list">
        {own.map((file) => (
          <li key={file.id} className="review__row">
            <div className="review__row-main">
              <div className="file-name">{file.name}</div>
              <div className="file-meta">{file.duration ? formatDuration(file.duration) : '—'}</div>
            </div>
            {file.status === 'done' && (
              <button type="button" className="review__view" onClick={() => onViewFile(file.id)}>
                View transcript
              </button>
            )}
            {file.status === 'error' && <span className="review__failed">Failed</span>}
          </li>
        ))}
      </ul>
      <button type="button" className="review__back" onClick={onBackToProcess}>
        ← Back to processing
      </button>
    </div>
  );
}
