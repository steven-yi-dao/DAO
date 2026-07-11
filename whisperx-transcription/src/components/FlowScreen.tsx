import type { RefObject } from 'react';
import type { FlowStep, TranscriptFile, TranscriptionSettings } from '../types';
import { StepIndicator } from './StepIndicator';
import { UploadStep } from './UploadStep';
import { ProcessStep } from './ProcessStep';
import { ReviewStep } from './ReviewStep';

interface FlowScreenProps {
  step: FlowStep;
  onStepClick: (step: FlowStep) => void;
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
  onRetryFile: (id: string) => void;
  onBackToUpload: () => void;
  onContinueToReview: () => void;
  onBackToProcess: () => void;
  onViewFile: (id: string) => void;
}

export function FlowScreen({
  step,
  onStepClick,
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
  onRetryFile,
  onBackToUpload,
  onContinueToReview,
  onBackToProcess,
  onViewFile,
}: FlowScreenProps) {
  return (
    <>
      <StepIndicator step={step} onStepClick={onStepClick} />
      <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px', maxWidth: 720, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {step === 1 && (
          <UploadStep
            files={files}
            settingsOpen={settingsOpen}
            settings={settings}
            fileInputRef={fileInputRef}
            onToggleSettings={onToggleSettings}
            onUpdateSetting={onUpdateSetting}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onOpenPicker={onOpenPicker}
            onFileInputChange={onFileInputChange}
            onRemoveFile={onRemoveFile}
            onStartTranscription={onStartTranscription}
          />
        )}
        {step === 2 && (
          <ProcessStep
            files={files}
            onRetryFile={onRetryFile}
            onBackToUpload={onBackToUpload}
            onContinueToReview={onContinueToReview}
          />
        )}
        {step === 3 && <ReviewStep files={files} onViewFile={onViewFile} onBackToProcess={onBackToProcess} />}
      </div>
    </>
  );
}
