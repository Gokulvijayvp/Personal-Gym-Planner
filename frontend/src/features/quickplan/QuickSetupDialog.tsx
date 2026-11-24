import { useEffect, useMemo, useState } from "react";
import ErrorState from "../../components/ui/ErrorState";
import Modal from "../../components/ui/Modal";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { catalogueService } from "../../services/catalogueService";
import { masterDataService } from "../../services/exerciseService";
import { exerciseSetService } from "../../services/exerciseSetService";
import { plannerService } from "../../services/plannerService";
import type { Catalogue } from "../../types/catalogue";
import type { MuscleGroup } from "../../types/exercise";
import type { ExerciseSet } from "../../types/exerciseSet";
import { DAY_NAMES } from "../planner/plannerLogic";
import { DEFAULT_ASSIGNMENT } from "./dayOps";
import {
  PRESETS, applyPreset, autoPicks, dayTitle, describeScope, effectivePicks, emptyDay, emptyWeek, isConfigured, otherWeeks,
  type DayPlan, type Scope,
} from "./quickSetupLogic";

interface Props {
  cycle: { id: number; name: string; total_weeks: number };
  /** The week being looked at, and the day (0 = Monday) that was selected. */
  week: number;
  day: number;
  onClose: () => void;
  onApplied: (message: string) => void;
}

type Mode = "week" | "day";

const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

/**
 * Quick setup: choose muscles for each weekday (or for one day), optionally tick exercises, then apply to this
 * week, the following weeks, or every week of the plan. Everything is done with the existing planner API.
 */
export default function QuickSetupDialog({ cycle, week, day, onClose, onApplied }: Props) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [groups, setGroups] = useState<MuscleGroup[]>([]);
  const [sets, setSets] = useState<ExerciseSet[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [mode, setMode] = useState<Mode>("week");
  const [days, setDays] = useState<DayPlan[]>(emptyWeek);
  const [dayIdx, setDayIdx] = useState(Math.min(Math.max(day, 0), 6));
  const [perMuscle, setPerMuscle] = useState(3);
  const [scope, setScope] = useState<Scope>("this");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    setLoadError(null);
    Promise.all([
      catalogueService.list(c.signal), masterDataService.muscleGroups(c.signal),
      exerciseSetService.list(c.signal).catch(() => [] as ExerciseSet[]),        // saved sets are a bonus: never block on them
    ])
      .then(([cat, g, mySets]) => { setCatalogue(cat); setGroups(g); setSets(mySets); })
      .catch((e: unknown) => { if (!c.signal.aborted) setLoadError(getErrorMessage(e)); });
    return () => c.abort();
  }, [attempt]);

  const items = catalogue?.items ?? [];
  const muscleNames = catalogue?.muscle_groups ?? [];
  const shownDays = mode === "week" ? [0, 1, 2, 3, 4, 5, 6] : [dayIdx];
  const targets = shownDays.filter((d) => isConfigured(days[d]));
  const picksOf = (d: number) => effectivePicks(days[d], items, perMuscle);
  const totalExercises = useMemo(
    () => targets.reduce((n, d) => n + effectivePicks(days[d], items, perMuscle).length, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targets.join(","), days, items, perMuscle]);

  const setDay = (d: number, next: DayPlan) => setDays((all) => all.map((x, i) => (i === d ? next : x)));
  const toggleMuscle = (d: number, m: string) => {
    const cur = days[d];
    const muscles = cur.muscles.includes(m) ? cur.muscles.filter((x) => x !== m) : [...cur.muscles, m];
    setDay(d, { rest: false, muscles });                                  // picking a muscle ends "rest"; picks are re-suggested
  };
  const toggleRest = (d: number) => setDay(d, days[d].rest ? emptyDay() : { rest: true, muscles: [] });
  const togglePick = (d: number, key: string) => {
    const cur = new Set(picksOf(d));
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    setDay(d, { ...days[d], picks: Array.from(cur) });
  };

  /** Tap a saved set ("Chest A") to use its exercises. While a muscle still has the automatic picks, the set replaces them. */
  function toggleSet(d: number, set: ExerciseSet) {
    const day = days[d];
    const known = new Set(items.map((i) => i.key));
    const keys = set.exercises.map((e) => e.key).filter((k) => known.has(k));
    const current = effectivePicks(day, items, perMuscle);
    let next: string[];
    if (keys.length > 0 && keys.every((k) => current.includes(k))) {
      next = current.filter((k) => !keys.includes(k));
    } else {
      const auto = new Set(day.picks === undefined ? autoPicks(items, [set.muscle_group], perMuscle) : []);
      next = [...current.filter((k) => !auto.has(k) || keys.includes(k)), ...keys.filter((k) => !current.includes(k))];
    }
    setDay(d, { ...day, picks: next });
  }

  async function apply() {
    if (busy || targets.length === 0 || !catalogue) return;
    setError(null);
    const idByMuscle = new Map(groups.map((g) => [g.name, g.id]));
    const addedIds = new Map<string, number>();                            // catalogue key -> library exercise id
    for (const i of items) if (i.exercise_id !== null) addedIds.set(i.key, i.exercise_id);

    async function libraryId(key: string): Promise<number> {
      const known = addedIds.get(key);
      if (known !== undefined) return known;
      try {
        const created = await catalogueService.add(key);
        addedIds.set(key, created.id);
        return created.id;
      } catch (e) {
        if (e instanceof ApiError && e.code === "already_in_library") {
          const fresh = (await catalogueService.list()).items.find((i) => i.key === key)?.exercise_id;
          if (fresh != null) { addedIds.set(key, fresh); return fresh; }
        }
        throw e;
      }
    }

    try {
      for (const d of targets) {
        setBusy(`Setting up ${DAY_NAMES[d]}…`);
        const plan = days[d];
        try { await plannerService.clearDay(cycle.id, week, d); } catch (e) { if (!isNotFound(e)) throw e; }
        if (plan.rest) {
          await plannerService.putDay(cycle.id, week, d, { status: "rest", title: null, notes: null });
          continue;
        }
        await plannerService.putDay(cycle.id, week, d, { status: "planned", title: dayTitle(plan.muscles), notes: null });
        for (const m of plan.muscles) {
          const gid = idByMuscle.get(m);
          if (gid !== undefined) await plannerService.addMuscleGroup(cycle.id, week, d, gid);
        }
        for (const key of effectivePicks(plan, items, perMuscle)) {
          const item = items.find((i) => i.key === key);
          const gid = item ? idByMuscle.get(item.muscle_group) : undefined;
          if (!item || gid === undefined) continue;
          await plannerService.addExercise(cycle.id, week, d, gid, { ...DEFAULT_ASSIGNMENT, exercise_id: await libraryId(key) });
        }
      }

      const others = otherWeeks(scope, week, cycle.total_weeks);
      if (others.length > 0) {
        setBusy(`Copying to ${others.length} more ${others.length === 1 ? "week" : "weeks"}…`);
        if (mode === "week") {
          await plannerService.copyWeek(cycle.id, week, others, true);
        } else {
          for (const w of others) await plannerService.copyDay(cycle.id, week, dayIdx, w, dayIdx, true);
        }
      }
      onApplied(mode === "week"
        ? `Week set up (${targets.length} ${targets.length === 1 ? "day" : "days"}, ${describeScope(scope, week, cycle.total_weeks, true)}).`
        : `${DAY_NAMES[dayIdx]} set up (${describeScope(scope, week, cycle.total_weeks, false)}).`);
    } catch (e) {
      setError(getErrorMessage(e));
      setBusy(null);
    }
  }

  const weeksLeft = cycle.total_weeks - week;
  const scopes: { id: Scope; label: string; disabled?: boolean }[] = [
    { id: "this", label: mode === "week" ? `Week ${week} only` : `${DAY_NAMES[dayIdx]} of week ${week} only` },
    { id: "following", label: `Week ${week} and the ${weeksLeft} after it`, disabled: weeksLeft < 1 },
    { id: "all", label: `All ${cycle.total_weeks} weeks`, disabled: cycle.total_weeks < 2 },
  ];

  return (
    <Modal title="Quick setup" size="lg" onClose={onClose} dismissible={busy === null}
      footer={<>
        <span className="qs-summary" aria-live="polite">
          {targets.length === 0 ? "Choose muscles or Rest for at least one day."
            : `${targets.length} ${targets.length === 1 ? "day" : "days"} · ${totalExercises} exercises · ${describeScope(scope, week, cycle.total_weeks, mode === "week")}`}
        </span>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy !== null}>Cancel</button>
        <button type="button" className="btn" onClick={apply} disabled={busy !== null || targets.length === 0 || !catalogue} data-testid="qs-apply">
          {busy ?? "Apply"}
        </button>
      </>}>
      {loadError ? <ErrorState title="Couldn't load exercises" message={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : !catalogue ? (
        <div className="skeleton cat-skeleton" role="status" aria-busy="true" aria-label="Loading" />
      ) : (
        <div className="qs">
          <p className="hint qs-note">Plan: <b>{cycle.name}</b>. Days you fill in here replace what is planned on them. Days you leave empty are not touched.</p>
          {error && <p className="form-alert" role="alert">{error}</p>}

          <div className="seg" role="tablist" aria-label="Set up">
            <button type="button" role="tab" aria-selected={mode === "week"} className={mode === "week" ? "seg-btn is-on" : "seg-btn"}
              onClick={() => setMode("week")}>Whole week</button>
            <button type="button" role="tab" aria-selected={mode === "day"} className={mode === "day" ? "seg-btn is-on" : "seg-btn"}
              onClick={() => setMode("day")}>One day</button>
          </div>

          {mode === "week" ? (
            <div className="qs-presets" role="group" aria-label="Ready-made weeks">
              <span className="qs-label">Quick start</span>
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className="cat-chip" title={p.hint} onClick={() => { setDays(applyPreset(p, muscleNames)); setOpen(null); }}>{p.label}</button>
              ))}
              <button type="button" className="cat-chip" onClick={() => setDays(emptyWeek())}>Clear</button>
            </div>
          ) : (
            <div className="qs-presets" role="group" aria-label="Day">
              <span className="qs-label">Day</span>
              {DAY_NAMES.map((n, i) => (
                <button key={n} type="button" className={dayIdx === i ? "cat-chip is-on" : "cat-chip"} aria-pressed={dayIdx === i}
                  onClick={() => { setDayIdx(i); setOpen(null); }}>{n.slice(0, 3)}</button>
              ))}
            </div>
          )}

          <div className="qs-count">
            <label htmlFor="qs-per">Exercises per muscle</label>
            <input id="qs-per" type="number" min={0} max={8} value={perMuscle}
              onChange={(e) => setPerMuscle(Math.min(8, Math.max(0, Math.floor(Number(e.target.value) || 0))))} />
            <span className="hint">Picked for you. You can tick your own below. 0 = add exercises later.</span>
          </div>

          <ul className="qs-days" aria-label="Days">
            {shownDays.map((d) => {
              const plan = days[d];
              const picks = picksOf(d);
              return (
                <li key={d} className={plan.rest ? "qs-day is-rest" : isConfigured(plan) ? "qs-day is-set" : "qs-day"} data-testid={`qs-day-${d}`}>
                  <div className="qs-day-head">
                    <b>{DAY_NAMES[d]}</b>
                    <button type="button" className={plan.rest ? "cat-chip is-on" : "cat-chip"} aria-pressed={plan.rest} onClick={() => toggleRest(d)}>Rest</button>
                  </div>
                  {!plan.rest && (
                    <div className="qs-muscles" role="group" aria-label={`Muscles for ${DAY_NAMES[d]}`}>
                      {muscleNames.map((m) => (
                        <button key={m} type="button" className={plan.muscles.includes(m) ? "cat-chip is-on" : "cat-chip"}
                          aria-pressed={plan.muscles.includes(m)} onClick={() => toggleMuscle(d, m)}>{m}</button>
                      ))}
                    </div>
                  )}
                  {!plan.rest && sets.some((x) => plan.muscles.includes(x.muscle_group)) && (
                    <div className="qs-sets" role="group" aria-label={`My exercises for ${DAY_NAMES[d]}`}>
                      <span className="qs-label">My exercises</span>
                      {sets.filter((x) => plan.muscles.includes(x.muscle_group)).map((x) => {
                        const keys = x.exercises.map((e) => e.key);
                        const on = keys.length > 0 && keys.every((k) => picks.includes(k));
                        return (
                          <button key={x.id} type="button" className={on ? "cat-chip is-on" : "cat-chip"} aria-pressed={on}
                            data-testid={`qs-set-${d}-${x.id}`} title={x.exercises.map((e) => e.name).join(", ")} onClick={() => toggleSet(d, x)}>
                            {x.name} ({x.exercises.length})
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!plan.rest && plan.muscles.length > 0 && (
                    <>
                      <button type="button" className="qs-more" aria-expanded={open === d} onClick={() => setOpen(open === d ? null : d)}>
                        {picks.length} {picks.length === 1 ? "exercise" : "exercises"} · {open === d ? "Hide list" : "Choose exercises"}
                      </button>
                      {open === d && (
                        <div className="qs-picks">
                          {plan.muscles.map((m) => (
                            <fieldset key={m}>
                              <legend>{m}</legend>
                              {items.filter((i) => i.muscle_group === m).map((i) => (
                                <label key={i.key} className="qs-pick">
                                  <input type="checkbox" checked={picks.includes(i.key)} onChange={() => togglePick(d, i.key)} />
                                  <span>{i.name}</span><small>{i.equipment}</small>
                                </label>
                              ))}
                            </fieldset>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <fieldset className="qs-scope">
            <legend>Apply to</legend>
            {scopes.map((s) => (
              <label key={s.id} className={s.disabled ? "qs-radio is-disabled" : "qs-radio"}>
                <input type="radio" name="qs-scope" checked={scope === s.id} disabled={s.disabled} onChange={() => setScope(s.id)} />
                <span>{s.label}</span>
              </label>
            ))}
            {scope !== "this" && mode === "week" && <p className="hint">The other weeks become a copy of this week, including days you did not change here.</p>}
          </fieldset>
        </div>
      )}
    </Modal>
  );
}
