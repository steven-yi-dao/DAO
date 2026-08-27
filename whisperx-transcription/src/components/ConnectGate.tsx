import { useCallback, useState } from 'react';
import type { Pipeline } from '../types';
import type { Tool } from '../lib/tools';
import { EXPERIMENTAL, TRANSCRIBE } from '../lib/tools';
import { EXPERIMENTS } from '../lib/experiments';
import { ExperimentInfoModal } from './ExperimentInfoModal';
import './ConnectGate.css';

interface ConnectGateProps {
  connecting: boolean;
  connectError: string | null;
  onStart: (pipeline: Pipeline) => void;
}

export function ConnectGate({ connecting, connectError, onStart }: ConnectGateProps) {
  const [infoTool, setInfoTool] = useState<Tool | null>(null);
  // Stable, because useFocusTrap keys its effect on the dismiss handler — an
  // inline arrow would re-run the trap on every render and yank focus back to
  // the top of the dialog mid-read.
  const closeInfo = useCallback(() => setInfoTool(null), []);

  const row = (tool: Tool) => (
    <ToolRow
      key={tool.id}
      tool={tool}
      connecting={connecting}
      onStart={() => onStart(tool.pipeline)}
      onShowInfo={EXPERIMENTS[tool.id]?.length ? () => setInfoTool(tool) : undefined}
    />
  );

  return (
    <div className="connect-gate">
      <div className="connect-gate__inner">
        <h1 className="connect-gate__heading">Tools</h1>
        <div className="connect-gate__card">{row(TRANSCRIBE)}</div>

        {/* Not finished work. Kept visibly apart from the tool employees rely
            on, so trying one is a choice rather than something they land in. */}
        <h2 className="connect-gate__heading connect-gate__heading--section">Experimental</h2>
        <div className="connect-gate__card">{EXPERIMENTAL.map(row)}</div>

        {!connecting && connectError && (
          <div className="connect-error" role="alert">
            <div className="connect-error__title">Connection failed</div>
            <div className="connect-error__detail">{connectError}</div>
            <button
              type="button"
              className="connect-error__retry"
              onClick={() => onStart(TRANSCRIBE.pipeline)}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {infoTool && (
        <ExperimentInfoModal toolId={infoTool.id} toolName={infoTool.name} onDismiss={closeInfo} />
      )}
    </div>
  );
}

interface ToolRowProps {
  tool: Tool;
  connecting: boolean;
  onStart: () => void;
  /** Omitted for tools with no record to show, which is what hides the (i). */
  onShowInfo?: () => void;
}

/**
 * The row is a div wrapping two sibling buttons rather than one big button:
 * the (i) has to be independently clickable, and a button inside a button is
 * invalid HTML that browsers resolve however they like.
 */
function ToolRow({ tool, connecting, onStart, onShowInfo }: ToolRowProps) {
  return (
    <div className="tool">
      <button
        type="button"
        className="tool__launch"
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
          <span className="tool__name">{tool.name}</span>
          <span className="tool__desc">{tool.desc}</span>
        </span>

        <span className="tool__aside">
          {connecting ? (
            <span className="tool__spinner" />
          ) : (
            <svg className="tool__arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

      {onShowInfo && (
        <button
          type="button"
          className="tool__info"
          onClick={onShowInfo}
          aria-label={`About ${tool.name}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 11v5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="7.75" r="1.05" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  );
}
