import type { SessionState } from '../types';
import './SessionBar.css';

interface SessionBarProps {
  session: SessionState;
  onEndSession: () => void;
}

export function SessionBar({ session, onEndSession }: SessionBarProps) {
  const isConnected = session === 'connected';
  const connecting = session === 'connecting';
  const dotState = isConnected ? 'connected' : connecting ? 'connecting' : 'idle';
  const sessionLabel = isConnected ? 'Connected' : connecting ? 'Connecting…' : 'Not connected';

  return (
    <footer className="session-bar">
      <div className="session-bar__status">
        <span className={`session-bar__dot session-bar__dot--${dotState}`} aria-hidden="true" />
        <span className="session-bar__label">{sessionLabel}</span>
      </div>
      <button type="button" className="session-bar__end" onClick={onEndSession}>
        End session
      </button>
    </footer>
  );
}
