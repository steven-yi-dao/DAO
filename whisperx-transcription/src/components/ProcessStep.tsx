import type { RefObject } from 'react';
import type { TranscriptFile } from '../types';
import { formatBytes } from '../lib/utils';
import { StatusBadge } from './StatusBadge';
import { WaveIcon } from './WaveIcon';
import './ProcessStep.css';

interface ProcessStepProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  files: TranscriptFile[];
  onRetryFile: (id: string) => void;
  onBackToUpload: () => void;
  onContinueToReview: () => void;
}

export function ProcessStep({ headingRef, files, onRetryFile, onBackToUpload, onContinueToReview }: ProcessStepProps) {
  // Every file stays in the shared cloud queue while it uploads or processes.
  // Once one of the current user's own files finishes, it is lifted out of the
  // queue and promoted to the "Completed" list above. Other users' (external)
  // files remain in the queue regardless of their status.
  const isFinished = (f: TranscriptFile) => !f.external && f.status === 'done';
  const finishedFiles = files.filter(isFinished);
  const queueFiles = files.filter((f) => !isFinished(f));

  const ownFiles = files.filter((f) => !f.external);
  const allTerminal = ownFiles.length > 0 && ownFiles.every((f) => f.status === 'done' || f.status === 'error');
  const continueDisabled = !allTerminal;

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="step-heading">
        <span className="sr-only">Step 2 of 3: </span>Processing
      </h1>

      {finishedFiles.length > 0 && (
        <section className="process__completed">
          <h2 className="process__completed-heading">Completed · {finishedFiles.length}</h2>
          <ul className="process__done-list">
            {finishedFiles.map((file) => (
              <li key={file.id} className="process__done-row">
                <div className="process__row-main">
                  <div className="file-name">{file.name}</div>
                  <div className="file-meta">
                    {formatBytes(file.size)}
                    {file.uploader && ` · ${file.uploader}`}
                  </div>
                </div>
                <StatusBadge status="done" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="queue-card">
        <div className="queue-card__header">
          <WaveIcon />
          <div className="queue-card__title">
            Cloud queue · {queueFiles.length} {queueFiles.length === 1 ? 'file' : 'files'}
          </div>
        </div>

        <div className="queue-card__body">
          {queueFiles.length > 0 ? (
            <ul className="process__queue-list">
              {queueFiles.map((file, i) => {
                const processing = file.status === 'processing';
                return (
                  <li key={file.id} className="process__queue-row">
                    <div className="process__queue-row-top">
                      <div className="queue-index" aria-hidden="true">
                        {i + 1}
                      </div>
                      <div className="process__row-main">
                        <div className="file-name">{file.name}</div>
                        <div className="file-meta">
                          {formatBytes(file.size)}
                          {file.uploader && ` · ${file.uploader}`}
                        </div>
                      </div>
                      {file.status === 'uploading' && <StatusBadge status="uploading" />}
                      {processing && <StatusBadge status="processing" />}
                      {file.status === 'done' && <StatusBadge status="done" />}
                      {file.status === 'queued' && <StatusBadge status="queued" label="In queue" />}
                      {file.status === 'error' && (
                        <button type="button" className="process__retry" onClick={() => onRetryFile(file.id)}>
                          Retry
                        </button>
                      )}
                    </div>
                    {processing && (
                      <div
                        className="progress-bar"
                        role="progressbar"
                        aria-label={`Transcribing ${file.name}`}
                        aria-valuenow={Math.round(file.progress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div className="progress-bar__fill" style={{ width: `${Math.round(file.progress)}%` }} />
                      </div>
                    )}
                    {file.status === 'error' && (
                      <div className="process__error" role="alert">
                        {file.errorMsg}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="queue-empty">Queue is empty</div>
          )}
        </div>
      </div>

      <p className="process__finished" role="status" aria-live="polite">
        {allTerminal && queueFiles.length === 0
          ? 'All files finished — transcripts saved to history. Continue when ready.'
          : ''}
      </p>

      <div className="step-actions">
        <button type="button" className="link-btn" onClick={onBackToUpload}>
          ← Back to upload
        </button>
        <button type="button" className="btn-primary" disabled={continueDisabled} onClick={onContinueToReview}>
          Continue to review
        </button>
      </div>
    </div>
  );
}
