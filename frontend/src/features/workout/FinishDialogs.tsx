import { useState } from "react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import type { SessionSummary } from "../../types/workout";
import { formatDurationShort } from "./units";

interface Props {
  kind: "complete" | "cancel";
  summary: SessionSummary;
  elapsed: number;
  empty: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (text: string | null) => void;
  onClose: () => void;
}

/** Confirmation (with an optional note / reason) before a workout is completed or cancelled. */
export default function FinishDialog({ kind, summary, elapsed, empty, busy, error, onConfirm, onClose }: Props) {
  const [text, setText] = useState("");
  const complete = kind === "complete";
  return (
    <ConfirmDialog
      title={complete ? "Complete this workout?" : "Cancel this workout?"} confirmLabel={complete ? "Complete workout" : "Cancel workout"}
      cancelLabel={complete ? "Keep logging" : "Keep workout"} tone={complete ? "default" : "danger"} busy={busy} error={error}
      onConfirm={() => onConfirm(text.trim() || null)} onCancel={onClose}>
      {complete ? (
        <>
          <p>
            <b>{summary.completed_exercises}</b> of {summary.total_exercises} exercises done, <b>{summary.completed_sets}</b> sets completed
            {summary.cardio_completed > 0 && <>, <b>{summary.cardio_minutes}</b> min of cardio</>}, after {formatDurationShort(elapsed)}.
          </p>
          {empty && <p role="note"><b>Nothing is marked done yet.</b> The workout will be saved without any completed sets.</p>}
          <p>Once completed it becomes read-only.</p>
        </>
      ) : (
        <p>The workout will be marked as cancelled and can no longer be edited. What you logged stays in your history.</p>
      )}
      <label className="finish-note">
        <span>{complete ? "Overall note (optional)" : "Reason (optional)"}</span>
        <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
          placeholder={complete ? "How did the session go?" : "Why are you stopping?"} data-autofocus />
      </label>
    </ConfirmDialog>
  );
}
