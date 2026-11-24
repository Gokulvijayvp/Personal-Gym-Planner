import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorState from "../components/ui/ErrorState";
import PageHeader from "../components/ui/PageHeader";
import { dateFormatter } from "../features/home/prefs";
import PlanBoard from "../features/quickplan/PlanBoard";
import { useSettingsPrefs } from "../features/settings/useSettingsPrefs";
import { getErrorMessage } from "../services/apiError";
import { dashboardService } from "../services/dashboardService";
import type { Dashboard } from "../types/dashboard";

/**
 * Workout: today's plan up front, this week beside it, and one-tap ways to change either.
 * It reuses the Weekly Planner API for every edit; starting a workout still copies the plan into the log.
 */
export default function WorkoutPage() {
  const { prefs } = useSettingsPrefs();
  const fmt = useMemo(() => dateFormatter(prefs), [prefs]);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    dashboardService.get(controller.signal).then(setData)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [attempt]);

  // after an edit: refresh quietly (the page keeps what it shows) so the week strip and Home see the change
  const refresh = useCallback(async () => {
    try { setData(await dashboardService.get()); } catch { /* the edit itself succeeded; the next load will catch up */ }
  }, []);

  return (
    <>
      <PageHeader eyebrow="TRAIN" title="Workout" description="Today's plan and your week. Tap anything to change it." />
      {error && !data ? (
        <section className="panel page-empty">
          <ErrorState title="Couldn't load your workout plan" message={error} onRetry={() => setAttempt((n) => n + 1)} />
        </section>
      ) : !data ? (
        <div aria-busy="true" role="status" aria-label="Loading your workout">
          <div className="skeleton" style={{ height: 84, marginBottom: 14 }} />
          <div className="skeleton" style={{ height: 260 }} />
        </div>
      ) : (
        <PlanBoard dash={data} prefs={prefs} fmt={fmt} onRefresh={refresh} />
      )}
    </>
  );
}
