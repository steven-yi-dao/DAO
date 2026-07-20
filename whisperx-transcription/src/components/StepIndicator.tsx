import type { FlowStep } from '../types';
import './StepIndicator.css';

interface StepIndicatorProps {
  step: FlowStep;
  onStepClick: (step: FlowStep) => void;
}

const STEP_NAMES: { name: string; step: FlowStep }[] = [
  { name: 'Select files', step: 1 },
  { name: 'Process', step: 2 },
  { name: 'Review', step: 3 },
];

const STATE_TEXT = {
  done: 'completed',
  current: 'current step',
  upcoming: 'not started',
} as const;

export function StepIndicator({ step, onStepClick }: StepIndicatorProps) {
  return (
    <nav className="step-indicator" aria-label="Progress">
      <ol className="step-indicator__list">
        {STEP_NAMES.map(({ name, step: n }) => {
          const state = n < step ? 'done' : n === step ? 'current' : 'upcoming';
          const clickable = n < step;
          const upcoming = state === 'upcoming';
          return (
            <li key={n} className="step-indicator__item">
              <button
                type="button"
                className="step-indicator__btn"
                onClick={clickable ? () => onStepClick(n) : undefined}
                disabled={!clickable}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <span
                  className={`step-indicator__dot${upcoming ? ' step-indicator__dot--upcoming' : ''}`}
                  aria-hidden="true"
                >
                  {state === 'done' ? '✓' : String(n)}
                </span>
                <span
                  className={`step-indicator__label${upcoming ? ' step-indicator__label--upcoming' : ''}`}
                >
                  {name}
                </span>
                <span className="sr-only">{STATE_TEXT[state]}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
