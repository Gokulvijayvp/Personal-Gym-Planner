import { useState } from "react";
import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import type { Exercise } from "../../types/exercise";
import ExerciseIcon from "../masters/ExerciseIcon";

interface Props {
  exercise: Exercise;
  busy?: boolean;
  onEdit: (e: Exercise) => void;
  onDelete: (e: Exercise) => void;
  onToggleActive: (e: Exercise) => void;
}

export default function ExerciseCard({ exercise: e, busy = false, onEdit, onDelete, onToggleActive }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = e.media_url && !imageFailed;

  return (
    <article className={e.is_active ? "ex-card" : "ex-card inactive"} aria-label={e.name}>
      <header className="ex-head">
        {showImage ? (
          <img className="ex-thumb" src={e.media_url!} alt="" loading="lazy" referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)} />
        ) : (
          <span className="ex-thumb ex-icon" data-testid="exercise-icon"><ExerciseIcon motion={e.exercise_master?.icon_motion} size={44} /></span>
        )}
        <div className="ex-title">
          <h3>{e.name}</h3>
          <span className={e.is_active ? "badge badge-active" : "badge badge-inactive"}>
            {e.is_active ? "Active" : "Inactive"}
          </span>
        </div>
      </header>

      <div className="ex-tags">
        <span className="tag tag-primary" title="Primary muscle">{e.muscle_group.name}</span>
        {e.target_area && <span className="tag" title="Target area">{e.target_area.name}</span>}
        {e.workout_type && <span className="tag tag-type" title="Workout type">{e.workout_type.name}</span>}
      </div>

      {e.secondary_muscle_groups.length > 0 && (
        <p className="ex-secondary">Also works: {e.secondary_muscle_groups.map((g) => g.name).join(", ")}</p>
      )}
      {e.description && <p className="ex-desc">{e.description}</p>}

      <footer className="ex-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onEdit(e)} disabled={busy}
          aria-label={`Edit ${e.name}`}>
          <Pencil size={14} /> Edit
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onToggleActive(e)} disabled={busy}
          aria-label={`${e.is_active ? "Deactivate" : "Activate"} ${e.name}`}>
          {e.is_active ? <EyeOff size={14} /> : <Eye size={14} />} {e.is_active ? "Deactivate" : "Activate"}
        </button>
        <button type="button" className="btn btn-outline btn-sm btn-danger-outline btn-icon-only" onClick={() => onDelete(e)}
          disabled={busy} aria-label={`Delete ${e.name}`} title="Delete">
          <Trash2 size={14} /> <span className="btn-text">Delete</span>
        </button>
      </footer>
    </article>
  );
}
