import type { Instance, SessionState } from '../types';
import { IDLE_LIMIT_S, formatDuration } from '../lib/utils';
import './SessionBar.css';

interface SessionBarProps {
  session: SessionState;
  instance: Instance | null;
  idleSecondsRemaining: number;
  onEndSession: () => void;
}

export function SessionBar({ session, instance, idleSecondsRemaining, onEndSession }: SessionBarProps) {
  const isConnected = session === 'connected';
  const connecting = session === 'connecting';
  const dotState = isConnected ? 'connected' : connecting ? 'connecting' : 'idle';
  const sessionLabel = isConnected ? 'Connected' : connecting ? 'Connecting…' : 'Not connected';
  const instanceLabel = instance ? `${instance.type} · ${instance.region}` : '';
  const idleUrgent = idleSecondsRemaining <= IDLE_LIMIT_S;

  return (
    <footer className="session-bar">
      <div className="session-bar__status">
        <span className={`session-bar__dot session-bar__dot--${dotState}`} aria-hidden="true" />
        <span className="session-bar__label">{sessionLabel}</span>
        {instanceLabel && <span className="session-bar__instance">{instanceLabel}</span>}
        <span className={`session-bar__idle${idleUrgent ? ' session-bar__idle--urgent' : ''}`}>
          · auto-ends in {formatDuration(idleSecondsRemaining)}
        </span>
      </div>
      <button type="button" className="session-bar__end" onClick={onEndSession}>
        End session
      </button>
    </footer>
  );
}
