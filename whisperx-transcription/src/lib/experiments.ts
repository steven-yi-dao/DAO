/**
 * The record behind the (i) on every tool in the Experimental section.
 *
 * This file is the log. Iterating on an experimental tool means prepending a
 * new dated entry to its array — nothing else needs touching, and the old
 * entries stay put so the history of what was tried survives the change.
 *
 * Conventions that keep the log worth reading:
 *  - Newest entry first.
 *  - `date` is the day the change shipped, ISO, never relative.
 *  - `result` stays honestly "Pending" until someone has actually looked at the
 *    output. An entry that claims a result it never measured is worse than no
 *    entry at all.
 */

export interface ExperimentEntry {
  /** YYYY-MM-DD, the day this iteration shipped. */
  date: string;
  /** What was wrong that this iteration set out to fix. */
  motivation: string;
  /** What was actually built or changed. */
  steps: string[];
  /** What it did to the output — or "Pending", until that has been measured. */
  result: string;
}

/** Keyed by tool id. Each array is newest first. */
export const EXPERIMENTS: Record<string, ExperimentEntry[]> = {
  betterTranscribe: [
    {
      date: '2026-08-27',
      motivation: 'Every .srt needed hand-nudging for its timing before it was usable.',
      steps: [
        'Added a second silero-vad pass after alignment separate from the VAD WhisperX runs internally: that one is tuned to chunk audio for the ASR, this one is tuned for caption cut points.',
        'Split a caption wherever it spans a pause of 0.70s or longer that VAD also reports as silent.',
        'Snapped each caption’s start and end onto the nearest speech edge within 0.35s. Anything further away is left as WhisperX had it.',
        'Captions can never overlap, never invert, and never shrink below 0.20s. A correction that cannot be applied cleanly is abandoned and the original boundaries kept.',
      ],
      result: 'Pending — no employee has reviewed a corrected file yet.',
    },
  ],
};
