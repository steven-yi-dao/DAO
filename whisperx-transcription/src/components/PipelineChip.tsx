import type { Pipeline } from '../types';
import './PipelineChip.css';

interface PipelineChipProps {
  pipeline: Pipeline;
}

/**
 * Marks a file as having gone through an experimental tool. Renders nothing for
 * `standard`: the point is to flag the unusual case, and a chip on every row
 * would just be noise.
 */
export function PipelineChip({ pipeline }: PipelineChipProps) {
  if (pipeline !== 'vad') return null;
  return <span className="pipeline-chip">BetterTranscribe</span>;
}
