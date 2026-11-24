import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "../../services/apiError";

export interface AsyncState<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/**
 * Runs a read-only request whenever `deps` change, cancelling the previous one. The previous result stays
 * available while the next loads (so the page dims instead of flashing), and a failure never clears it silently.
 */
export function useAsync<T>(run: (signal: AbortSignal) => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    run(controller.signal)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: unknown) => { if (!controller.signal.aborted) { setError(getErrorMessage(e)); setLoading(false); } });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, enabled]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, error, loading, reload };
}
