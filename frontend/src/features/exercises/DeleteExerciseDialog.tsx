import { useState } from "react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { exerciseService } from "../../services/exerciseService";
import type { Exercise } from "../../types/exercise";

interface Props {
  exercise: Exercise;
  onClose: () => void;
  onDeleted: (e: Exercise) => void;
  onDeactivated: (e: Exercise) => void;
}

export default function DeleteExerciseDialog({ exercise, onClose, onDeleted, onDeactivated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The list already tells us when an exercise is in use; otherwise we learn it if the server refuses.
  const [inUseMessage, setInUseMessage] = useState<string | null>(
    exercise.usage_count > 0
      ? `"${exercise.name}" is used in ${exercise.usage_count} planned or logged record(s) and can't be deleted. ` +
        "Deactivate it instead to keep your history and hide it from new plans."
      : null,
  );

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await exerciseService.remove(exercise.id);
      onDeleted(exercise);
    } catch (err) {
      if (err instanceof ApiError && err.code === "exercise_in_use") setInUseMessage(err.message);
      else setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      await exerciseService.setActive(exercise.id, false);
      onDeactivated(exercise);
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title={inUseMessage ? "Can't delete this exercise" : "Delete exercise?"}
      confirmLabel="Delete exercise"
      tone="danger"
      busy={busy}
      hideConfirm={inUseMessage !== null}
      error={error}
      alternative={inUseMessage && exercise.is_active ? { label: "Deactivate instead", onClick: deactivate } : null}
      onConfirm={confirm}
      onCancel={onClose}
    >
      {inUseMessage ? (
        <>
          <p>{inUseMessage}</p>
          {!exercise.is_active && <p>This exercise is already inactive, so it is hidden from new plans.</p>}
        </>
      ) : (
        <p>
          Delete <b>{exercise.name}</b> from your library? This can't be undone.
          If you only want to hide it, deactivate it instead.
        </p>
      )}
    </ConfirmDialog>
  );
}
