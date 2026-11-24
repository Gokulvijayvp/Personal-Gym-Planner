import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Search } from "lucide-react";
import ErrorState from "../../components/ui/ErrorState";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { getErrorMessage } from "../../services/apiError";
import { exerciseService } from "../../services/exerciseService";
import type { Exercise, MuscleGroup, WorkoutType } from "../../types/exercise";

interface Props {
  muscleGroups: MuscleGroup[];
  workoutTypes: WorkoutType[];
  /** Muscle group of the day section; the list starts filtered to it (can be widened to "All"). */
  defaultMuscleGroupId: number | null;
  selectedId: number | null;
  onSelect: (exercise: Exercise) => void;
  invalid?: boolean;
}

/** Search the Exercise Library and pick one active exercise. Nothing is created here. */
export default function ExercisePicker({ muscleGroups, workoutTypes, defaultMuscleGroupId, selectedId, onSelect, invalid }: Props) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 250);
  const [muscle, setMuscle] = useState(defaultMuscleGroupId ? String(defaultMuscleGroupId) : "");
  const [type, setType] = useState("");
  const [items, setItems] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Keep the previous results on screen while new ones load, so the form below doesn't jump around.
    setRefreshing(true);
    exerciseService.list({
      search: debounced || undefined, muscle_group_id: muscle ? Number(muscle) : undefined,
      workout_type_id: type ? Number(type) : undefined, is_active: true,
      sort: "name", order: "asc", page: 1, page_size: 50,
    }, controller.signal)
      .then((res) => { setItems(res.items); setError(null); setRefreshing(false); })
      .catch((e: unknown) => { if (!controller.signal.aborted) { setError(getErrorMessage(e)); setRefreshing(false); } });
    return () => controller.abort();
  }, [debounced, muscle, type, attempt]);

  return (
    <div className={invalid ? "picker has-error" : "picker"}>
      <div className="picker-filters">
        <div className="search-box">
          <Search size={16} aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100}
            placeholder="Search your exercise library…" aria-label="Search exercises to add" />
        </div>
        <select value={muscle} onChange={(e) => setMuscle(e.target.value)} aria-label="Filter by muscle group">
          <option value="">All muscle groups</option>
          {muscleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by workout type">
          <option value="">All types</option>
          {workoutTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {error ? (
        <ErrorState title="Couldn't load exercises" message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />
      ) : items === null ? (
        <div className="picker-list" aria-busy="true" aria-label="Loading exercises" role="status">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton sk-line picker-sk" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="muted-note picker-empty">
          No active exercises match. {muscle && <>Try “All muscle groups”, or </>}
          <Link to="/exercises">add one in the Exercise Library</Link>.
        </p>
      ) : (
        <ul className={refreshing ? "picker-list is-refreshing" : "picker-list"} aria-label="Library exercises" aria-busy={refreshing}>
          {items.map((ex) => {
            const selected = ex.id === selectedId;
            return (
              <li key={ex.id}>
                <button type="button" className={selected ? "picker-item selected" : "picker-item"} aria-pressed={selected} onClick={() => onSelect(ex)}>
                  <span className="picker-main">
                    <b>{ex.name}</b>
                    <span className="picker-tags">
                      <span className="tag tag-primary">{ex.muscle_group.name}</span>
                      {ex.target_area && <span className="tag">{ex.target_area.name}</span>}
                      {ex.workout_type && <span className="tag tag-type">{ex.workout_type.name}</span>}
                    </span>
                  </span>
                  {selected && <Check size={18} aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
