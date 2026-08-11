import { useEffect, useRef, useState } from 'react';
import type { ApiJob } from '../lib/api';
import { errorMessage, listJobs } from '../lib/api';

export const POLL_MS = 2000;
/** A server that is down doesn't need asking twice a second. */
export const POLL_BACKOFF_MS = 10000;

export interface JobPoll {
  jobs: ApiJob[];
  error: string | null;
}

/**
 * The backend pushes nothing, so job state arrives by polling GET /api/jobs.
 * A failed poll surfaces as `error` and slows the interval rather than
 * throwing — the last good list stays on screen while the server recovers.
 */
export function useJobPolling(enabled: boolean): JobPoll {
  const [jobs, setJobs] = useState<ApiJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setError(null);
      return;
    }

    let cancelled = false;

    async function poll() {
      let delay = POLL_MS;
      try {
        const next = await listJobs();
        if (cancelled) return;
        setJobs(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(errorMessage(err));
        delay = POLL_BACKOFF_MS;
      }
      timerRef.current = setTimeout(poll, delay);
    }

    poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled]);

  return { jobs, error };
}
