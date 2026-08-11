import { useState } from 'react';
import type { RefObject } from 'react';
import type { TranscriptFile } from '../types';
import { formatBytes } from '../lib/utils';
import { StatusBadge } from './StatusBadge';
import { WaveIcon } from './WaveIcon';
import { ModalDialog } from './ModalDialog';
import './UploadStep.css';

interface UploadStepProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Picked in this browser, not sent yet — including the two client-side
   *  rejections, which never made it out and stay here to be removed. */
  stagedFiles: TranscriptFile[];
  queueFiles: TranscriptFile[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onOpenPicker: () => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (id: string) => void;
  onAddToQueue: () => void;
  onBackToTools: () => void;
}

export function UploadStep({
  headingRef,
  stagedFiles,
  queueFiles,
  fileInputRef,
  onDragOver,
  onDrop,
  onOpenPicker,
  onFileInputChange,
  onRemoveFile,
  onAddToQueue,
  onBackToTools,
}: UploadStepProps) {
  const [confirmBack, setConfirmBack] = useState(false);
  const readyCount = stagedFiles.filter((f) => f.status === 'selected').length;
  const addDisabled = readyCount === 0;

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1} className="step-heading">
        <span className="sr-only">Step 1 of 3: </span>Upload audio
      </h1>

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload audio files — drag and drop, or activate to browse"
        className="upload-dropzone"
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={onOpenPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenPicker();
          }
        }}
      >
        <div className="upload-dropzone__title">Drag and drop audio files here</div>
        <div className="upload-dropzone__hint">or click to browse · MP3, MP4, WAV, M4A, FLAC, OGG</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          aria-label="Choose audio files"
          hidden
          onChange={onFileInputChange}
        />
      </div>

      {stagedFiles.length > 0 && (
        <section className="upload-section">
          <h2 className="upload-section__heading">Selected files</h2>
          <ul className="queue-list">
            {stagedFiles.map((file) => (
              <li key={file.id} className="queue-row">
                <div className="queue-row__main">
                  <div className="file-name">{file.name}</div>
                  <div className="file-meta">{formatBytes(file.size)}</div>
                </div>
                {file.status === 'error' ? (
                  <div className="upload__error-text">{file.errorMsg}</div>
                ) : (
                  <StatusBadge status="selected" />
                )}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => onRemoveFile(file.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="queue-card upload-section">
        <div className="queue-card__header">
          <WaveIcon />
          <div className="queue-card__title">
            Cloud queue · {queueFiles.length} {queueFiles.length === 1 ? 'file' : 'files'}
          </div>
        </div>

        <div className="queue-card__body">
          {queueFiles.length > 0 ? (
            <ul className="queue-list">
              {queueFiles.map((file, i) => (
                <li key={file.id} className="queue-row">
                  <div className="queue-index" aria-hidden="true">
                    {i + 1}
                  </div>
                  <div className="queue-row__main">
                    <div className="file-name">{file.name}</div>
                    {file.status === 'uploading' && (
                      <div className="upload__row-badge">
                        <StatusBadge status="uploading" />
                      </div>
                    )}
                    {file.status === 'processing' && (
                      <div className="upload__row-badge">
                        <StatusBadge status="processing" />
                      </div>
                    )}
                    {file.status === 'done' && (
                      <div className="upload__row-badge">
                        <StatusBadge status="done" />
                      </div>
                    )}
                    <div className="file-meta">{formatBytes(file.size)}</div>
                  </div>
                  {file.status === 'error' && <div className="upload__error-text">{file.errorMsg}</div>}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => onRemoveFile(file.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="queue-empty">Queue is empty</div>
          )}
        </div>
      </div>

      <div className="step-actions">
        <button type="button" className="link-btn" onClick={() => setConfirmBack(true)}>
          ← Back to Tools
        </button>
        <button type="button" className="btn-primary" disabled={addDisabled} onClick={onAddToQueue}>
          Add files to cloud queue{readyCount > 0 ? ` (${readyCount})` : ''}
        </button>
      </div>

      {confirmBack && (
        <ModalDialog
          title="Leave transcription?"
          onDismiss={() => setConfirmBack(false)}
          actions={
            <>
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={() => setConfirmBack(false)}
              >
                Stay here
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={() => {
                  setConfirmBack(false);
                  onBackToTools();
                }}
              >
                Back to Tools
              </button>
            </>
          }
        >
          <p className="modal__text">
            Going back to Tools ends this cloud session and clears the current queue. Finished transcripts stay in your
            history.
          </p>
        </ModalDialog>
      )}
    </div>
  );
}
