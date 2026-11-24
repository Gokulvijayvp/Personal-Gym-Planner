import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ErrorState from "../../components/ui/ErrorState";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { getErrorMessage } from "../../services/apiError";
import { exerciseService, masterDataService } from "../../services/exerciseService";
import { planningMasterData } from "../../services/plannerService";
import type { Exercise, MuscleGroup } from "../../types/exercise";
import type { CardioActivity } from "../../types/planner";

/** Choose an active exercise from the Exercise Library. Nothing here changes the library. */
export function AddExerciseModal({ onPick, onClose }: { onPick: (exercise: Exercise) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), 250);
  const [group, setGroup] = useState("");
  const [groups, setGroups] = useState<MuscleGroup[]>([]);
  const [items, setItems] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { masterDataService.muscleGroups().then(setGroups).catch(() => setGroups([])); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    exerciseService.list({ search: search || undefined, muscle_group_id: group ? Number(group) : undefined, is_active: true, sort: "name", order: "asc", page: 1, page_size: 30 }, controller.signal)
      .then((r) => setItems(r.items))
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [search, group, attempt]);

  return (
    <Modal title="Add an exercise" size="md" onClose={onClose} closeOnBackdrop footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <div className="wk-picker-filters">
        <div className="search-box">
          <Search size={16} aria-hidden />
          <input type="search" aria-label="Search the exercise library" placeholder="Search exercises…" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} data-autofocus />
        </div>
        <label className="select-field">
          <span>Muscle group</span>
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All muscle groups</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>
      {error ? <ErrorState title="Couldn't load exercises" message={error} onRetry={() => setAttempt((n) => n + 1)} />
        : items === null ? <div className="skeleton" style={{ height: 140 }} role="status" aria-label="Loading exercises" />
          : items.length === 0 ? <p className="home-note">No active exercises match. Add or reactivate one in the Exercise Library.</p>
            : (
              <ul className="wk-picker-list" aria-label="Exercises">
                {items.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="wk-picker-item" onClick={() => onPick(x)} aria-label={`Add ${x.name}`}>
                      <span><b>{x.name}</b><small>{[x.muscle_group.name, x.workout_type?.name].filter(Boolean).join(" · ")}</small></span>
                      <Plus size={18} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
    </Modal>
  );
}

export function AddCardioModal({ onPick, onClose }: { onPick: (activity: CardioActivity) => void; onClose: () => void }) {
  const [items, setItems] = useState<CardioActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    planningMasterData.cardioActivities(controller.signal).then(setItems)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [attempt]);
  return (
    <Modal title="Add cardio" size="sm" onClose={onClose} closeOnBackdrop footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>}>
      {error ? <ErrorState title="Couldn't load activities" message={error} onRetry={() => setAttempt((n) => n + 1)} />
        : items === null ? <div className="skeleton" style={{ height: 120 }} role="status" aria-label="Loading activities" />
          : (
            <ul className="wk-picker-list" aria-label="Cardio activities">
              {items.map((a) => (
                <li key={a.id}>
                  <button type="button" className="wk-picker-item" onClick={() => onPick(a)} aria-label={`Add ${a.name}`}>
                    <span><b>{a.name}</b></span><Plus size={18} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
    </Modal>
  );
}
