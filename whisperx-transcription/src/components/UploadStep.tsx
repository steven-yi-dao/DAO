import type { RefObject } from 'react';
import type { TranscriptFile, TranscriptionSettings } from '../types';
import { formatBytes } from '../lib/utils';
import { LANGUAGE_LABELS, MODEL_LABELS } from '../lib/statusMeta';

interface UploadStepProps {
  files: TranscriptFile[];
  settingsOpen: boolean;
  settings: TranscriptionSettings;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onToggleSettings: () => void;
  onUpdateSetting: <K extends keyof TranscriptionSettings>(key: K, value: TranscriptionSettings[K]) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onOpenPicker: () => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (id: string) => void;
  onStartTranscription: () => void;
}

export function UploadStep({
  files,
  settingsOpen,
  settings,
  fileInputRef,
  onToggleSettings,
  onUpdateSetting,
  onDragOver,
  onDrop,
  onOpenPicker,
  onFileInputChange,
  onRemoveFile,
  onStartTranscription,
}: UploadStepProps) {
  const hasFiles = files.length > 0;
  const hasQueued = files.some((f) => f.status === 'queued');
  const anyUploading = files.some((f) => f.status === 'uploading');
  const isProcessing = files.some((f) => f.status === 'processing');
  const startDisabled = !hasQueued || isProcessing || anyUploading;
  const queuedCount = files.filter((f) => f.status === 'queued').length;

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1F1F1F', margin: '0 0 16px' }}>Upload audio</h2>
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={onOpenPicker}
        style={{ border: '2px dashed #C9C5B8', borderRadius: 11, padding: 36, textAlign: 'center', cursor: 'pointer', background: '#FBFAF7' }}
      >
        <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1F1F1F', marginBottom: 5 }}>Drop audio files here</div>
        <div style={{ fontSize: 13, color: '#6E6B62' }}>
          or click to browse · MP3, WAV, M4A, FLAC, OGG · up to 500MB each
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          style={{ display: 'none' }}
          onChange={onFileInputChange}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <button
          onClick={onToggleSettings}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 600, color: '#3A5A9F', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
        >
          Transcription settings {settingsOpen ? '▴' : '▾'}
        </button>
        {settingsOpen && (
          <div style={{ display: 'flex', gap: 26, marginTop: 13, padding: 18, background: '#FBFAF7', border: '1px solid #E4E1D8', borderRadius: 9, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: '#6E6B62' }}>
              Language
              <select
                value={settings.language}
                onChange={(e) => onUpdateSetting('language', e.target.value)}
                style={{ fontSize: 13.5, padding: '8px 9px', borderRadius: 6, border: '1px solid #D5D1C6', background: '#fff', color: '#1F1F1F' }}
              >
                {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: '#6E6B62' }}>
              Model
              <select
                value={settings.model}
                onChange={(e) => onUpdateSetting('model', e.target.value)}
                style={{ fontSize: 13.5, padding: '8px 9px', borderRadius: 6, border: '1px solid #D5D1C6', background: '#fff', color: '#1F1F1F' }}
              >
                {Object.entries(MODEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: '#6E6B62' }}>
              Label speakers (beta)
              <button
                onClick={() => onUpdateSetting('diarization', !settings.diarization)}
                style={{
                  position: 'relative',
                  width: 40,
                  height: 22,
                  borderRadius: 11,
                  border: 'none',
                  background: settings.diarization ? '#3A5A9F' : '#D9D5C9',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: settings.diarization ? 20 : 2,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,.3)',
                    transition: 'left .15s ease',
                  }}
                />
              </button>
            </label>
          </div>
        )}
      </div>

      <div style={{ marginTop: 26, border: '1px solid #E4E1D8', borderRadius: 11, background: '#fff', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: '#F0EEE7', borderBottom: '1px solid #E4E1D8' }}>
          <div style={{ flex: 'none', width: 24, height: 16, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0, bottom: 0, width: 24, height: 10, background: '#6E8AB8', borderRadius: 5 }} />
            <span style={{ position: 'absolute', left: 1, bottom: 4, width: 10, height: 10, background: '#6E8AB8', borderRadius: '50%' }} />
            <span style={{ position: 'absolute', left: 8, bottom: 6, width: 12, height: 12, background: '#6E8AB8', borderRadius: '50%' }} />
            <span style={{ position: 'absolute', left: 16, bottom: 4, width: 9, height: 9, background: '#6E8AB8', borderRadius: '50%' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F' }}>
              Cloud queue · {files.length} {files.length === 1 ? 'file' : 'files'}
            </div>
            <div style={{ fontSize: 11.5, color: '#6E6B62', marginTop: 1 }}>
              Uploaded to your SageMaker instance — not stored on this device
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 16px' }}>
          {hasFiles &&
            files.map((file, i) => (
              <div
                key={file.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', border: '1px solid #E4E1D8', borderRadius: 8, background: '#FBFAF7', marginBottom: 9 }}
              >
                <div
                  style={{
                    flex: 'none',
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    background: '#F0EEE7',
                    color: '#8A8678',
                    font: "11px/20px 'IBM Plex Mono', monospace",
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1F1F1F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {file.name}
                  </div>
                  {file.status === 'uploading' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
                      <div style={{ flex: 1, maxWidth: 160, height: 5, borderRadius: 3, background: '#E4E1D8', overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#B8862E', borderRadius: 3, width: `${Math.round(file.progress)}%` }} />
                      </div>
                      <div style={{ font: "11px 'IBM Plex Mono', monospace", color: '#8A6A1E' }}>
                        Uploading… {Math.round(file.progress)}%
                      </div>
                    </div>
                  )}
                  <div style={{ font: "11.5px/1.4 'IBM Plex Mono', monospace", color: '#8A8678', marginTop: 2 }}>
                    {formatBytes(file.size)}
                  </div>
                </div>
                {file.status === 'error' && (
                  <div style={{ fontSize: 11.5, color: '#B3432E', textAlign: 'right', maxWidth: 220 }}>{file.errorMsg}</div>
                )}
                <button
                  onClick={() => onRemoveFile(file.id)}
                  title="Remove"
                  style={{ flex: 'none', background: 'none', border: 'none', color: '#9C9890', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: 4 }}
                >
                  ×
                </button>
              </div>
            ))}
          {hasFiles && (
            <button
              onClick={onOpenPicker}
              style={{ background: 'none', border: '1px dashed #C9C5B8', color: '#3A5A9F', fontSize: 12.5, fontWeight: 600, padding: '9px 14px', borderRadius: 7, cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}
            >
              + Add more files
            </button>
          )}
          {!hasFiles && (
            <div style={{ textAlign: 'center', padding: '18px 10px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#6E6B62', marginBottom: 3 }}>Queue is empty</div>
              <div style={{ fontSize: 12, color: '#8A8678' }}>
                Drop files above or click to browse — add as many as you like, they'll upload to the cloud instance
                and queue here.
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        disabled={startDisabled}
        onClick={onStartTranscription}
        style={{ marginTop: 20, background: startDisabled ? '#C9C5B8' : '#3A5A9F', color: '#fff', border: 'none', borderRadius: 7, padding: '12px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
      >
        Start transcription ({queuedCount})
      </button>
    </div>
  );
}
