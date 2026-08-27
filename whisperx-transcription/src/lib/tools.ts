import type { Pipeline } from '../types';

export interface Tool {
  /** Also the key into EXPERIMENTS for tools that have a record. */
  id: string;
  name: string;
  desc: string;
  pipeline: Pipeline;
}

/** The one tool employees rely on. */
export const TRANSCRIBE: Tool = {
  id: 'transcribe',
  name: 'Transcribe',
  desc: 'Turn audio into captions.',
  pipeline: 'standard',
};

/** Not finished work. Shown in its own section on the Tools screen, each with a
 *  dated record behind an (i) — see `src/lib/experiments.ts`. */
export const EXPERIMENTAL: Tool[] = [
  {
    id: 'betterTranscribe',
    name: 'BetterTranscribe',
    desc: 'Captions with more accurate cut points.',
    pipeline: 'vad',
  },
];

const BY_PIPELINE = new Map([TRANSCRIBE, ...EXPERIMENTAL].map((t) => [t.pipeline, t]));

/** The tool a session is running, for anything that needs to name it. */
export function toolFor(pipeline: Pipeline): Tool {
  return BY_PIPELINE.get(pipeline) ?? TRANSCRIBE;
}
