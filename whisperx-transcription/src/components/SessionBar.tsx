import type { Instance, SessionState } from '../types';

interface SessionBarProps {
  session: SessionState;
  instance: Instance | null;
  idleTimeoutLabel: string;
  onEndSession: () => void;
}

export function SessionBar({ session, instance, idleTimeoutLabel, onEndSession }: SessionBarProps) {
  const isConnected = session === 'connected';
  const connecting = session === 'connecting';
  const dotColor = isConnected ? '#3F7A54' : connecting ? '#B8862E' : '#8A8678';
  const sessionLabel = isConnected ? 'Connected' : connecting ? 'Connecting…' : 'Not connected';
  const instanceLabel = instance ? `${instance.type} · ${instance.region}` : '';

  return (
    <div style={{ flex: 'none', padding: '8px 32px', borderTop: '1px solid #E4E1D8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flex: 'none' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#1F1F1F' }}>{sessionLabel}</span>
        <span style={{ font: "11.5px 'IBM Plex Mono', monospace", color: '#8A8678' }}>{instanceLabel}</span>
        <span style={{ fontSize: 11, color: '#8A8678' }}>· auto-ends after {idleTimeoutLabel} idle</span>
      </div>
      <button
        onClick={onEndSession}
        style={{ background: 'none', border: 'none', color: '#8A8678', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
      >
        End session
      </button>
    </div>
  );
}
