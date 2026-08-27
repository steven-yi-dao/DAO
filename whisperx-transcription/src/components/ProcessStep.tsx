import type { RefObject } from 'react';
import type { TranscriptFile } from '../types';
import { formatBytes } from '../lib/utils';
import { PipelineChip } from './PipelineChip';
import { StatusBadge } from './StatusBadge';
import { WaveIcon } from './WaveIcon';
import './ProcessStep.css';

interface ProcessStepProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Everything in flight on the shared server, plus this session's failures. */
  queueFiles: TranscriptFile[];
  /** This session's uploads, which are what the flow waits on. */
  sessionFiles: TranscriptFile[];
  onRetryFile: (id: string) => void;
  onBackToUpload: () => void;
  onContinueToReview: () => void;
}

export function ProcessStep({
  headingRef,
  queueFiles,
  sessionFiles,
  onRetryFile,
  onBackToUpload,
  onContinueToReview,
}: ProcessStepProps) {
  const finishedFiles = sessionFiles.filter((f) => f.status === 'done');
  const allTerminal =
    sessionFiles.length > 0 && sessionFiles.every((f) => f.status === 'done' || f.status === 'error');

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
                    {formatBytes(file.size)} <PipelineChip pipeline={file.pipeline} />
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
                const uploading = file.status === 'uploading';
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
                          {formatBytes(file.size)} <PipelineChip pipeline={file.pipeline} />
                        </div>
                      </div>
                      {uploading && <StatusBadge status="uploading" />}
                      {processing && <StatusBadge status="processing" />}
                      {file.status === 'queued' && <StatusBadge status="queued" label="In queue" />}
                      {file.status === 'error' && (
                        <button type="button" className="process__retry" onClick={() => onRetryFile(file.id)}>
                          Retry
                        </button>
                      )}
                    </div>
                    {/* Upload percentage is measured. Transcription reports only
                        a status, so its bar is indeterminate rather than a
                        number the screen reader would repeat as if it were real. */}
                    {uploading && (
                      <div
                        className="progress-bar"
                        role="progressbar"
                        aria-label={`Uploading ${file.name}`}
                        aria-valuenow={Math.round(file.progress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div className="progress-bar__fill" style={{ width: `${Math.round(file.progress)}%` }} />
                      </div>
                    )}
                    {processing && (
                      <div
                        className="progress-bar progress-bar--indeterminate"
                        role="progressbar"
                        aria-label={`Transcribing ${file.name}`}
                      >
                        <div className="progress-bar__fill" />
                      </div>
                    )}
                    {/* Failures are spoken by the queue announcer, with the file name attached. */}
                    {file.status === 'error' && <div className="process__error">{file.errorMsg}</div>}
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
        {allTerminal ? 'All files finished — transcripts saved to history. Continue when ready.' : ''}
      </p>

      <div className="step-actions">
        <button type="button" className="link-btn" onClick={onBackToUpload}>
          ← Back to upload
        </button>
        <button type="button" className="btn-primary" disabled={!allTerminal} onClick={onContinueToReview}>
          Continue to review
        </button>
      </div>
    </div>
  );
}
