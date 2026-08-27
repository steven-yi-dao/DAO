import { EXPERIMENTS } from '../lib/experiments';
import { ModalDialog } from './ModalDialog';
import './ExperimentInfoModal.css';

interface ExperimentInfoModalProps {
  /** Key into EXPERIMENTS. */
  toolId: string;
  toolName: string;
  onDismiss: () => void;
}

/** Formats an ISO date without going through Date(), which would shift a
 *  date-only string into the previous day for anyone west of UTC. */
function formatEntryDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * The dated Motivation / Steps / Result record behind an experimental tool's
 * (i). Reads straight from `src/lib/experiments.ts`, newest entry first, so
 * logging a new iteration is a matter of prepending to that file.
 */
export function ExperimentInfoModal({ toolId, toolName, onDismiss }: ExperimentInfoModalProps) {
  const entries = EXPERIMENTS[toolId] ?? [];

  return (
    <ModalDialog
      title={toolName}
      onDismiss={onDismiss}
      wide
      actions={
        <button type="button" className="modal-btn modal-btn--primary" onClick={onDismiss}>
          Close
        </button>
      }
    >
      {entries.length === 0 ? (
        <p className="modal__text">Nothing recorded for this tool yet.</p>
      ) : (
        <ol className="experiment-log">
          {entries.map((entry) => (
            <li key={entry.date} className="experiment-log__entry">
              <h3 className="experiment-log__date">
                <time dateTime={entry.date}>{formatEntryDate(entry.date)}</time>
              </h3>

              <h4 className="experiment-log__label">Motivation</h4>
              <p className="experiment-log__body">{entry.motivation}</p>

              <h4 className="experiment-log__label">Steps taken</h4>
              <ul className="experiment-log__steps">
                {entry.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>

              <h4 className="experiment-log__label">Result</h4>
              <p className="experiment-log__body">{entry.result}</p>
            </li>
          ))}
        </ol>
      )}
    </ModalDialog>
  );
}
