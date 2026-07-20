import type { FileStatus } from '../types';
import { getStatusMeta } from '../lib/statusMeta';
import './StatusBadge.css';

interface StatusBadgeProps {
  status: FileStatus;
  /** Override the canonical label (e.g. "In queue" instead of "Queued"). */
  label?: string;
  /** Rounded pill style for the history list. */
  pill?: boolean;
}

export function StatusBadge({ status, label, pill = false }: StatusBadgeProps) {
  const meta = getStatusMeta(status);
  return (
    <span className={`status-badge ${meta.className}${pill ? ' status-badge--pill' : ''}`}>
      {label ?? meta.label}
    </span>
  );
}
