import type { Instance, SessionState } from '../types';
import './SessionBar.css';

interface SessionBarProps {
  session: SessionState;
  instance: Instance | null;
  onEndSession: () => void;
}

export function SessionBar({ session, instance, onEndSession }: SessionBarProps) {
  const isConnected = session === 'connected';
  const connecting = session === 'connecting';
  const dotState = isConnected ? 'connected' : connecting ? 'connecting' : 'idle';
  const sessionLabel = isConnected ? 'Connected' : connecting ? 'Connecting…' : 'Not connected';
  const instanceLabel = instance ? `${instance.type} · ${instance.region}` : '';

  return (
    <footer className="session-bar">
      <div className="session-bar__status">
        <span className={`session-bar__dot session-bar__dot--${dotState}`} aria-hidden="true" />
        <span className="session-bar__label">{sessionLabel}</span>
        {instanceLabel && <span className="session-bar__instance">{instanceLabel}</span>}
      </div>
      <button type="button" className="session-bar__end" onClick={onEndSession}>
        End session
      </button>
    </footer>
  );
}
