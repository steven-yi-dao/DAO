import './ConnectGate.css';

interface ConnectGateProps {
  connecting: boolean;
  connectError: string | null;
  onStart: () => void;
}

export function ConnectGate({ connecting, connectError, onStart }: ConnectGateProps) {
  return (
    <div className="connect-gate">
      <div className="connect-gate__inner">
        <h1 className="connect-gate__heading">Tools</h1>

        <div className="connect-gate__card">
          {/* Transcribe — the one active tool */}
          <button
            type="button"
            className="tool"
            onClick={connecting ? undefined : onStart}
            disabled={connecting}
            aria-busy={connecting}
          >
            <span className="tool__icon" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>

            <span className="tool__body">
              <span className="tool__name">Transcribe</span>
              <span className="tool__desc">Turn audio into captions.</span>
            </span>

            <span className="tool__aside">
              {connecting ? (
                <span className="tool__spinner" />
              ) : (
                <svg
                  className="tool__arrow"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          </button>
        </div>

        {!connecting && connectError && (
          <div className="connect-error" role="alert">
            <div className="connect-error__title">Connection failed</div>
            <div className="connect-error__detail">{connectError}</div>
            <button type="button" className="connect-error__retry" onClick={onStart}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
