import type { FlowStep } from '../types';

interface StepIndicatorProps {
  step: FlowStep;
  onStepClick: (step: FlowStep) => void;
}

const STEP_NAMES: { name: string; step: FlowStep }[] = [
  { name: 'Upload', step: 1 },
  { name: 'Process', step: 2 },
  { name: 'Review', step: 3 },
];

export function StepIndicator({ step, onStepClick }: StepIndicatorProps) {
  return (
    <div style={{ flex: 'none', padding: '26px 32px 0', maxWidth: 720, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative', padding: '0 16px' }}>
        <div style={{ position: 'absolute', top: 12, left: 44, right: 44, height: 2, background: '#E4E1D8', zIndex: 0 }} />
        {STEP_NAMES.map(({ name, step: n }) => {
          const stepState = n < step ? 'done' : n === step ? 'current' : 'upcoming';
          const clickable = n < step;
          const upcoming = stepState === 'upcoming';
          return (
            <button
              key={n}
              onClick={clickable ? () => onStepClick(n) : undefined}
              disabled={!clickable}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                position: 'relative',
                zIndex: 1,
                background: 'none',
                border: 'none',
                padding: 0,
                fontFamily: 'inherit',
                cursor: clickable ? 'pointer' : 'default',
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  font: "11.5px/1 'IBM Plex Mono', monospace",
                  fontWeight: 700,
                  background: upcoming ? '#F5F4F1' : '#3A5A9F',
                  color: upcoming ? '#8A8678' : '#FFFFFF',
                  border: `2px solid ${upcoming ? '#D5D1C6' : '#3A5A9F'}`,
                  boxSizing: 'border-box',
                }}
              >
                {stepState === 'done' ? '✓' : String(n)}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: upcoming ? '#8A8678' : '#1F1F1F', marginTop: 7 }}>
                {name}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
