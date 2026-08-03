import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { FlowStep, TranscriptFile } from '../types';
import { StepIndicator } from './StepIndicator';
import { UploadStep } from './UploadStep';
import { ProcessStep } from './ProcessStep';
import { ReviewStep } from './ReviewStep';
import './FlowScreen.css';

interface FlowScreenProps {
  step: FlowStep;
  onStepClick: (step: FlowStep) => void;
  files: TranscriptFile[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onOpenPicker: () => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (id: string) => void;
  onAddToQueue: () => void;
  onBackToTools: () => void;
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
  fileInputRef,
  onDragOver,
  onDrop,
  onOpenPicker,
  onFileInputChange,
  onRemoveFile,
  onAddToQueue,
  onBackToTools,
  onRetryFile,
  onBackToUpload,
  onContinueToReview,
  onBackToProcess,
  onViewFile,
}: FlowScreenProps) {
  // Each step's h1 is the focus target on step change: the previous step's
  // content (including whatever button was focused) unmounts when `step`
  // changes, so without this the browser drops focus to <body> and screen
  // readers announce whatever's nearest in the DOM (e.g. the header) instead
  // of the new step.
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  return (
    <>
      <StepIndicator step={step} onStepClick={onStepClick} />
      <div className="flow-screen__body">
        {step === 1 && (
          <UploadStep
            headingRef={headingRef}
            files={files}
            fileInputRef={fileInputRef}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onOpenPicker={onOpenPicker}
            onFileInputChange={onFileInputChange}
            onRemoveFile={onRemoveFile}
            onAddToQueue={onAddToQueue}
            onBackToTools={onBackToTools}
          />
        )}
        {step === 2 && (
          <ProcessStep
            headingRef={headingRef}
            files={files}
            onRetryFile={onRetryFile}
            onBackToUpload={onBackToUpload}
            onContinueToReview={onContinueToReview}
          />
        )}
        {step === 3 && (
          <ReviewStep headingRef={headingRef} files={files} onViewFile={onViewFile} onBackToProcess={onBackToProcess} />
        )}
      </div>
    </>
  );
}
