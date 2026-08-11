import type { RefObject } from 'react';
import type { TranscriptFile } from '../types';
import { formatDuration } from '../lib/utils';
import './ReviewStep.css';

interface ReviewStepProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  files: TranscriptFile[];
  onViewFile: (id: string) => void;
  onBackToProcess: () => void;
}

export function ReviewStep({ headingRef, files, onViewFile, onBackToProcess }: ReviewStepProps) {
  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="step-heading">
        <span className="sr-only">Step 3 of 3: </span>Review &amp; download
      </h1>
      <ul className="review__list">
        {files.map((file) => (
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
