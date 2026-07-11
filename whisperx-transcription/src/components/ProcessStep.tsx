import type { TranscriptFile } from '../types';

interface ProcessStepProps {
  files: TranscriptFile[];
  onRetryFile: (id: string) => void;
  onBackToUpload: () => void;
  onContinueToReview: () => void;
}

export function ProcessStep({ files, onRetryFile, onBackToUpload, onContinueToReview }: ProcessStepProps) {
  const processFiles = files.filter((f) => f.status === 'queued' || f.status === 'processing');
  const allTerminal = files.length > 0 && files.every((f) => f.status === 'done' || f.status === 'error');
  const continueDisabled = !allTerminal;

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1F1F1F', margin: '0 0 16px' }}>Processing</h2>
      {processFiles.map((file) => (
        <div key={file.id} style={{ padding: '13px 15px', border: '1px solid #E4E1D8', borderRadius: 9, background: '#fff', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1F1F1F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>
              {file.name}
            </div>
            {file.status === 'queued' && <span style={{ fontSize: 12, fontWeight: 600, color: '#6E6B62' }}>Queued</span>}
            {file.status === 'error' && (
              <button
                onClick={() => onRetryFile(file.id)}
                style={{ background: 'none', border: 'none', color: '#3A5A9F', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                Retry
              </button>
            )}
          </div>
          {file.status === 'processing' && (
            <div style={{ width: '100%', height: 7, borderRadius: 4, background: '#E4E1D8', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#3A5A9F', borderRadius: 4, width: `${Math.round(file.progress)}%` }} />
            </div>
          )}
          {file.status === 'error' && <div style={{ fontSize: 12, color: '#B3432E' }}>{file.errorMsg}</div>}
        </div>
      ))}
      {allTerminal && (
        <div style={{ textAlign: 'center', padding: '22px 10px', color: '#6E6B62', fontSize: 13 }}>
          All files finished — sent to history. Continue when ready.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
        <button
          onClick={onBackToUpload}
          style={{ background: 'none', border: 'none', color: '#3A5A9F', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
        >
          ← Back to upload
        </button>
        <button
          disabled={continueDisabled}
          onClick={onContinueToReview}
          style={{ background: continueDisabled ? '#C9C5B8' : '#3A5A9F', color: '#fff', border: 'none', borderRadius: 7, padding: '12px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          Continue to review
        </button>
      </div>
    </div>
  );
}
