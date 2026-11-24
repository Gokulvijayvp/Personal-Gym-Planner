import { useEffect, useMemo, useState } from "react";
import { Layers, Plus, Search, SearchX } from "lucide-react";
import ErrorState from "../../components/ui/ErrorState";
import Modal from "../../components/ui/Modal";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { getErrorMessage } from "../../services/apiError";
import { catalogueService } from "../../services/catalogueService";
import { exerciseService } from "../../services/exerciseService";
import { exerciseSetService } from "../../services/exerciseSetService";
import type { CatalogueItem } from "../../types/catalogue";
import type { Exercise } from "../../types/exercise";
import type { ExerciseSet } from "../../types/exerciseSet";
import ExerciseThumb from "../exercises/ExerciseThumb";

export interface PickedExercise { id: number; muscleGroupId: number; name: string }

interface Props {
  /** "Add exercise" or "Replace Bench Press". */
  title: string;
  /** Library exercise ids to hide (already in the day). */
  excludeIds?: number[];
  /** Muscle to open on. Leave out to ask the user first. */
  muscle?: string;
  /** Offer "My exercises" sets (adding a whole set in one tap). Off when replacing a single exercise. */
  allowSets?: boolean;
  onClose: () => void;
  /** Resolve once the pick is saved; the dialog closes after it succeeds and shows the error otherwise. */
  onPick: (exercise: PickedExercise) => Promise<void>;
  /** Add every exercise of a saved set at once. Required when `allowSets` is on. */
  onPickMany?: (exercises: PickedExercise[], setName: string) => Promise<void>;
}

/**
 * Pick what to add to a day. Step 1: which muscle. Step 2: that muscle's saved sets ("Chest A", "Chest B"),
 * where one tap adds the whole set, and below them every exercise of the muscle for a one-off choice.
 * Anything chosen from the catalogue is put in the library on the way.
 */
export default function QuickAddDialog({ title, excludeIds = [], muscle, allowSets = true, onClose, onPick, onPickMany }: Props) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 200);
  const [group, setGroup] = useState(muscle ?? "");
  const [mine, setMine] = useState<Exercise[] | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [sets, setSets] = useState<ExerciseSet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const showSets = allowSets && !!onPickMany;

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    Promise.all([
      exerciseService.list({ is_active: true, sort: "name", order: "asc", page: 1, page_size: 100 }, controller.signal),
      catalogueService.list(controller.signal).catch(() => null),          // the catalogue is a bonus: its failure must not block
      showSets ? exerciseSetService.list(controller.signal).catch(() => [] as ExerciseSet[]) : Promise.resolve([] as ExerciseSet[]),
    ]).then(([list, cat, mySets]) => {
      setMine(list.items);
      setCatalogue(cat?.items ?? []);
      setGroups(cat?.muscle_groups ?? Array.from(new Set(list.items.map((e) => e.muscle_group.name))));
      setSets(mySets);
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [attempt, showSets]);

  const catRows = useMemo(
    () => catalogue.filter((c) => c.muscle_group === group
      && !(c.exercise_id !== null && excludeIds.includes(c.exercise_id))
      && (!q || c.name.toLowerCase().includes(q.toLowerCase()))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogue, q, group, excludeIds.join(",")]);
  const setRows = useMemo(() => sets.filter((s) => s.muscle_group === group && s.exercises.length > 0), [sets, group]);

  /** The library exercise behind a catalogue entry: the one you already have, or a new one added on the way. */
  async function resolve(c: CatalogueItem): Promise<PickedExercise> {
    const existing = c.exercise_id !== null ? (mine ?? []).find((e) => e.id === c.exercise_id) : undefined;
    if (existing) return { id: existing.id, muscleGroupId: existing.muscle_group.id, name: existing.name };
    const created = await catalogueService.add(c.key);
    return { id: created.id, muscleGroupId: created.muscle_group.id, name: created.name };
  }

  async function run(key: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(key); setPickError(null);
    try {
      await work();
    } catch (e) {
      setPickError(getErrorMessage(e));
      setBusy(null);
    }
  }

  const pickOne = (c: CatalogueItem) => run(`c${c.key}`, async () => onPick(await resolve(c)));
  const pickSet = (s: ExerciseSet) => run(`s${s.id}`, async () => {
    const byKey = new Map(catalogue.map((c) => [c.key, c]));
    const picked: PickedExercise[] = [];
    for (const e of s.exercises) {
      const c = byKey.get(e.key);
      if (c) picked.push(await resolve(c));
    }
    await onPickMany!(picked, s.name);
  });

  return (
    <Modal title={title} size="lg" onClose={onClose} dismissible={busy === null} closeOnBackdrop>
      {error ? <ErrorState title="Couldn't load exercises" message={error} onRetry={() => setAttempt((n) => n + 1)} /> : mine === null ? (
        <div className="skeleton cat-skeleton" role="status" aria-busy="true" aria-label="Loading exercises" />
      ) : (
        <div className="cat">
          <div className="cat-tools">
            <span className="qs-label" id="qa-muscle">{group ? "Muscle" : "Which muscle?"}</span>
            <div className="cat-chips" role="group" aria-labelledby="qa-muscle">
              {groups.map((g) => (
                <button key={g} type="button" className={group === g ? "cat-chip is-on" : "cat-chip"} aria-pressed={group === g}
                  onClick={() => { setGroup(g); setSearch(""); setPickError(null); }}>{g}</button>
              ))}
            </div>
          </div>
          {pickError && <p className="form-alert" role="alert">{pickError}</p>}

          {!group ? (
            <p className="hint qa-hint">Choose a muscle to see your saved sets and its exercises.</p>
          ) : (
            <>
              {showSets && (
                <>
                  <h3 className="qa-head">My exercises <span>(one tap adds the whole set)</span></h3>
                  {setRows.length === 0 ? (
                    <p className="hint">No saved {group.toLowerCase()} sets yet. Make one in Exercises, then My exercises.</p>
                  ) : (
                    <ul className="qa-list" aria-label={`My ${group} sets`}>
                      {setRows.map((s) => (
                        <li key={s.id}>
                          <button type="button" className="qa-row" disabled={busy !== null} data-testid={`pick-set-${s.id}`} onClick={() => pickSet(s)}>
                            <span className="qa-icon"><Layers size={20} aria-hidden /></span>
                            <span className="qa-text">
                              <b>{s.name}</b>
                              <small>{s.exercises.length} {s.exercises.length === 1 ? "exercise" : "exercises"}: {s.exercises.map((e) => e.name).join(", ")}</small>
                            </span>
                            <Plus size={18} aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              <h3 className="qa-head">{showSets ? `All ${group.toLowerCase()} exercises` : `${group} exercises`} {showSets && <span>(pick one for this time only)</span>}</h3>
              <div className="master-search">
                <Search size={15} aria-hidden />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${group.toLowerCase()} exercises`}
                  aria-label="Search exercises" autoComplete="off" />
              </div>
              {catRows.length > 0 ? (
                <ul className="qa-list" aria-label="Exercises">
                  {catRows.map((c) => (
                    <li key={c.key}>
                      <button type="button" className="qa-row" disabled={busy !== null} data-testid={`pick-cat-${c.key}`} onClick={() => pickOne(c)}>
                        <span className="qa-icon"><ExerciseThumb item={c} size={40} /></span>
                        <span className="qa-text"><b>{c.name}</b><small>{c.target_area ? `${c.target_area} · ` : ""}{c.equipment}</small></span>
                        <Plus size={18} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="cat-none"><SearchX size={22} aria-hidden /><b>No exercise matches</b><span>Try another word or muscle.</span></div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
