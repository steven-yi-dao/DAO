import { ModalDialog } from './ModalDialog';
import './IdleModal.css';

interface IdleModalProps {
  idleSecondsLeft: number;
  onEndNow: () => void;
  onKeepWorking: () => void;
}

export function IdleModal({ idleSecondsLeft, onEndNow, onKeepWorking }: IdleModalProps) {
  const label = `${String(Math.floor(idleSecondsLeft / 60)).padStart(2, '0')}:${String(idleSecondsLeft % 60).padStart(2, '0')}`;

  return (
    <ModalDialog
      role="alertdialog"
      title="Still working?"
      onDismiss={onKeepWorking}
      dismissOnBackdrop={false}
      actions={
        <>
          <button type="button" className="modal-btn modal-btn--secondary" onClick={onEndNow}>
            End now
          </button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={onKeepWorking}>
            Keep working
          </button>
        </>
      }
    >
      <p className="modal__text">To limit cloud costs, this session ends automatically when idle.</p>
      <div className="idle-modal__countdown">{label}</div>
    </ModalDialog>
  );
}
