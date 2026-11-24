import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import ErrorState from "../components/ui/ErrorState";
import PageHeader from "../components/ui/PageHeader";
import ActiveCycleCard from "../features/home/ActiveCycleCard";
import { greetingText, hourInAppTz } from "../features/home/homeLogic";
import { DEFAULT_PREFS, dateFormatter, prefsFrom, type DisplayPrefs } from "../features/home/prefs";
import SetupChecklist from "../features/home/SetupChecklist";
import { NextWorkout, QuickLinks, RecentActivity, StatsRow } from "../features/home/Sections";
import TodayCard from "../features/home/TodayCard";
import WeekSchedule from "../features/home/WeekSchedule";
import { getErrorMessage } from "../services/apiError";
import { dashboardService } from "../services/dashboardService";
import { settingsService } from "../services/settingsService";
import type { Dashboard } from "../types/dashboard";
import { formatDateOnly } from "../utils/date";

/**
 * Home: a read-only overview built from the Weekly Planner / Calendar data (one API call) plus the
 * user's display settings. It never creates workouts or edits plans.
 */
export default function HomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [prefs, setPrefs] = useState<DisplayPrefs>(DEFAULT_PREFS);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    // Both are fetched together and applied together so dates never flash in the wrong format.
    Promise.allSettled([dashboardService.get(controller.signal), settingsService.get(controller.signal)]).then(([dash, settings]) => {
      if (controller.signal.aborted) return;
      if (dash.status === "rejected") { setError(getErrorMessage(dash.reason)); return; }
      setData(dash.value);
      setSettingsFailed(settings.status === "rejected");
      setPrefs(prefsFrom(settings.status === "fulfilled" ? settings.value : null)); // safe defaults if Settings fails
    });
    return () => controller.abort();
  }, [attempt]);

  const fmt = useMemo(() => dateFormatter(prefs), [prefs]);
  const greeting = greetingText(hourInAppTz(), prefs.displayName);

  const header = (
    <PageHeader eyebrow="OVERVIEW" title={greeting}>
      {data && (
        <div className="date" data-testid="home-date">
          <CalendarDays size={16} aria-hidden />{formatDateOnly(data.date, { weekday: "long" })}, {fmt(data.date)}
        </div>
      )}
    </PageHeader>
  );

  if (error && !data) {
    return (
      <>
        {header}
        <section className="panel page-empty">
          <ErrorState title="Couldn't load your overview" message={error}
            onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />
        </section>
      </>
    );
  }

  if (!data) {
    return (
      <>
        {header}
        <div className="home-grid" aria-busy="true" role="status" aria-label="Loading your overview">
          <div className="home-col">{[0, 1].map((i) => <div key={i} className="skeleton home-skeleton" />)}</div>
          <div className="home-col">{[0, 1, 2].map((i) => <div key={i} className="skeleton home-skeleton short" />)}</div>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      {settingsFailed && (
        <p className="home-note" role="status" data-testid="settings-fallback">
          Your display settings couldn't be loaded, so default formats are being used.
        </p>
      )}
      <div className="home-page">
      <QuickLinks />
      <div className="home-grid">
        <div className="home-col">
          <TodayCard today={data.today} activeCycle={data.active_cycle} prefs={prefs} fmt={fmt} workout={data.today_workout} inProgress={data.in_progress_session} />
          <NextWorkout week={data.week} fmt={fmt} />
          <WeekSchedule week={data.week} fmt={fmt} />
        </div>
        <div className="home-col">
          <ActiveCycleCard card={data.active_cycle} counts={data.cycle_counts} other={data.other_cycle} fmt={fmt} />
          <StatsRow stats={data.stats} />
          <SetupChecklist setup={data.setup} activeCycle={data.active_cycle} />
          <RecentActivity items={data.recent_activity} fmt={fmt} />
        </div>
      </div>
      </div>
    </>
  );
}
