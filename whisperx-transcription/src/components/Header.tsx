import type { NavTab } from '../types';

interface HeaderProps {
  isConnected: boolean;
  nav: NavTab;
  onToggleHistory: () => void;
}

export function Header({ isConnected, nav, onToggleHistory }: HeaderProps) {
  return (
    <div
      style={{
        flex: 'none',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        borderBottom: '1px solid #E4E1D8',
      }}
    >
      <div style={{ fontSize: 15.5, fontWeight: 700, color: '#1F1F1F' }}>
        Transcribe <span style={{ fontWeight: 400, color: '#8A8678', fontSize: 13 }}>· Accessibility Office</span>
      </div>
      {isConnected && (
        <button
          onClick={onToggleHistory}
          style={{
            background: 'none',
            border: 'none',
            color: '#3A5A9F',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {nav === 'history' ? 'New transcript' : 'History'}
        </button>
      )}
    </div>
  );
}
