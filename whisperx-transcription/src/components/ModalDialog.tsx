import { useId } from 'react';
import type { ReactNode } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './ModalDialog.css';

interface ModalDialogProps {
  title: string;
  onDismiss: () => void;
  actions: ReactNode;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
  dismissOnBackdrop?: boolean;
  /** Roomier and left-aligned, for reading rather than confirming. The default
   *  320px centred box is sized for a two-button question. */
  wide?: boolean;
}

export function ModalDialog({
  title,
  onDismiss,
  actions,
  children,
  role = 'dialog',
  dismissOnBackdrop = true,
  wide = false,
}: ModalDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const ref = useFocusTrap<HTMLDivElement>(onDismiss);

  return (
    <div className="modal-overlay" onClick={dismissOnBackdrop ? onDismiss : undefined}>
      <div
        ref={ref}
        className={wide ? 'modal modal--wide' : 'modal'}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        <div id={bodyId} className="modal__body">
          {children}
        </div>
        <div className="modal__actions">{actions}</div>
      </div>
    </div>
  );
}
