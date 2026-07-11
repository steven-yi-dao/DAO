interface IdleModalProps {
  idleSecondsLeft: number;
  onEndNow: () => void;
  onKeepWorking: () => void;
}

export function IdleModal({ idleSecondsLeft, onEndNow, onKeepWorking }: IdleModalProps) {
  const label = `${String(Math.floor(idleSecondsLeft / 60)).padStart(2, '0')}:${String(idleSecondsLeft % 60).padStart(2, '0')}`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20,18,14,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
        animation: 'fadeIn .2s ease',
      }}
    >
      <div style={{ background: '#fff', borderRadius: 13, padding: 28, width: 310, textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.25)' }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: '#1F1F1F', marginBottom: 7 }}>Still working?</div>
        <p style={{ fontSize: 13, color: '#6E6B62', lineHeight: 1.5, margin: 0 }}>
          To limit cloud costs, this session ends automatically when idle.
        </p>
        <div style={{ font: "25px/1 'IBM Plex Mono', monospace", fontWeight: 600, color: '#B3432E', margin: '15px 0' }}>
          {label}
        </div>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'center' }}>
          <button
            onClick={onEndNow}
            style={{ background: '#fff', border: '1px solid #D5D1C6', color: '#1F1F1F', fontSize: 13, fontWeight: 600, padding: '9px 15px', borderRadius: 6, cursor: 'pointer' }}
          >
            End now
          </button>
          <button
            onClick={onKeepWorking}
            style={{ background: '#3A5A9F', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 15px', borderRadius: 6, cursor: 'pointer' }}
          >
            Keep working
          </button>
        </div>
      </div>
    </div>
  );
}
