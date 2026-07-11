interface ConnectGateProps {
  connecting: boolean;
  connectError: string | null;
  onStart: () => void;
}

export function ConnectGate({ connecting, connectError, onStart }: ConnectGateProps) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 13,
            background: '#E8EDF6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            margin: '0 auto 20px',
          }}
        >
          <span style={{ width: 4, height: 16, background: '#3A5A9F', borderRadius: 2 }} />
          <span style={{ width: 4, height: 27, background: '#3A5A9F', borderRadius: 2 }} />
          <span style={{ width: 4, height: 11, background: '#3A5A9F', borderRadius: 2 }} />
          <span style={{ width: 4, height: 22, background: '#3A5A9F', borderRadius: 2 }} />
        </div>
        <h2 style={{ fontSize: 21, fontWeight: 700, color: '#1F1F1F', margin: '0 0 9px' }}>
          Connect to start transcribing
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: '#6E6B62', margin: '0 0 22px' }}>
          We'll spin up a temporary SageMaker instance running WhisperX. It shuts down automatically when
          you're done, or if it sits idle.
        </p>
        {connecting && (
          <>
            <div
              style={{
                width: 30,
                height: 30,
                border: '3px solid #E4E1D8',
                borderTopColor: '#3A5A9F',
                borderRadius: '50%',
                margin: '0 auto 14px',
                animation: 'spin .8s linear infinite',
              }}
            />
            <div style={{ fontSize: 13.5, color: '#6E6B62' }}>Starting instance…</div>
          </>
        )}
        {!connecting && connectError && (
          <>
            <div
              style={{
                background: '#F7E4DE',
                border: '1px solid #E9C4B8',
                borderRadius: 8,
                padding: '13px 15px',
                marginBottom: 16,
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#B3432E', marginBottom: 2 }}>
                Connection failed
              </div>
              <div style={{ fontSize: 13, color: '#8A4636', lineHeight: 1.4 }}>{connectError}</div>
            </div>
            <button
              onClick={onStart}
              style={{
                background: '#3A5A9F',
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                padding: '11px 22px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </>
        )}
        {!connecting && !connectError && (
          <button
            onClick={onStart}
            style={{
              background: '#3A5A9F',
              color: '#fff',
              border: 'none',
              borderRadius: 7,
              padding: '11px 24px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Start session
          </button>
        )}
      </div>
    </div>
  );
}
