import { useState } from "react";
import type { FormEvent } from "react";
import { ClipboardPaste } from "lucide-react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Modal from "../../components/ui/Modal";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { planShareService } from "../../services/planShareService";
import type { PlanImportResult, PlanSharePreview } from "../../types/planShare";
import { pasteText } from "../exercises/copyText";
import { DAY_NAMES } from "../planner/plannerLogic";

interface Props {
  cycle: { id: number; name: string };
  /** The week of your plan the shared plan goes into. */
  week: number;
  /** The weekday that is open now: the default place for a shared day. */
  day: number;
  onClose: () => void;
  onImported: (result: PlanImportResult) => void;
}

const dayLine = (d: PlanSharePreview["days"][number]) => {
  if (d.status === "rest") return `${d.name}: rest day`;
  const parts = [d.muscle_groups.join(" + "), d.exercise_count ? `${d.exercise_count} ${d.exercise_count === 1 ? "exercise" : "exercises"}` : "", d.cardio_count ? "cardio" : ""].filter(Boolean);
  return `${d.name}: ${parts.join(", ") || "planned"}`;
};

/** Paste a plan code, see what it holds, pick where it goes, confirm if that would replace something, and copy it in. */
export default function PlanImportDialog({ cycle, week, day, onClose, onImported }: Props) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<PlanSharePreview | null>(null);
  const [target, setTarget] = useState(day);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (code.replace(/[^a-z0-9]/gi, "").length < 4) { setError("Paste the share code first."); return; }
    setBusy(true); setError(null);
    try {
      setPreview(await planShareService.preview(code.trim()));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function pasteFromClipboard() {
    const text = await pasteText();
    if (text) { setCode(text.trim()); setError(null); }
    else setError("Your browser did not allow reading the clipboard. Paste the code into the box (Ctrl+V).");
  }

  async function run(confirm: boolean) {
    if (busy || !preview) return;
    setBusy(true); setError(null);
    try {
      onImported(await planShareService.importPlan({
        code: code.trim(), cycle_id: cycle.id, week_number: week,
        day_of_week: preview.kind === "day" ? target : null, confirm_replace: confirm,
      }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "target_not_empty") setNeedsConfirm(true);     // there is a plan there: ask before replacing it
      else setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  if (preview && needsConfirm) {
    const what = preview.kind === "day" ? `${DAY_NAMES[target]} of week ${week}` : `all of week ${week}`;
    return (
      <ConfirmDialog title="Replace your plan?" confirmLabel="Delete mine and import" tone="danger" busy={busy} error={error}
        onConfirm={() => run(true)} onCancel={() => { setNeedsConfirm(false); setError(null); }}>
        <p><b>The plan you already have for {what} will be deleted</b> and cannot be brought back.</p>
        <p>It will be replaced by the shared {preview.kind === "day" ? "day" : "week"}.</p>
      </ConfirmDialog>
    );
  }

  if (preview) {
    return (
      <Modal title={preview.kind === "day" ? "Copy a shared day" : "Copy a shared week"} size="sm" onClose={onClose} dismissible={!busy} closeOnBackdrop
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => { setPreview(null); setError(null); }} disabled={busy}>Back</button>
          <button type="button" className="btn" onClick={() => run(false)} disabled={busy} data-testid="plan-import">{busy ? "Importing…" : "Import"}</button>
        </>}>
        <div className="shc">
          {error && <p className="form-alert" role="alert">{error}</p>}
          <p><b>{preview.kind === "day" ? "1 day" : `${preview.days.length} ${preview.days.length === 1 ? "day" : "days"}`}</b> shared:</p>
          <ul className="shc-days" aria-label="What the code contains">
            {preview.days.map((d) => <li key={d.day_of_week}>{preview.kind === "day" ? dayLine({ ...d, name: "Plan" }).replace("Plan: ", "") : dayLine(d)}</li>)}
          </ul>
          {preview.kind === "day" ? (
            <div className="field">
              <label htmlFor="plan-target-day">Put it on</label>
              <select id="plan-target-day" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {DAY_NAMES.map((n, i) => <option key={n} value={i}>{n} of week {week}</option>)}
              </select>
            </div>
          ) : (
            <p>It goes into <b>week {week}</b> of “{cycle.name}”. Days the shared week leaves empty become empty.</p>
          )}
          {preview.new_exercises.length > 0 && (
            <p className="hint">These exercises are not in your library yet and will be added: {preview.new_exercises.join(", ")}.</p>
          )}
          <p className="hint">If you already planned that {preview.kind === "day" ? "day" : "week"}, you will be asked before anything is deleted.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Paste a plan code" size="sm" onClose={onClose} dismissible={!busy} closeOnBackdrop
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="plan-code-form" className="btn" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
      </>}>
      <form id="plan-code-form" className="shc" onSubmit={check} noValidate>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="field">
          <label htmlFor="plan-code">Share code</label>
          <div className="shc-row">
            <input id="plan-code" className="shc-code" value={code} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false}
              placeholder="XXXXX-XXXXX" maxLength={40} onChange={(e) => { setCode(e.target.value); setError(null); }} />
            <button type="button" className="btn btn-outline" onClick={pasteFromClipboard} disabled={busy}>
              <ClipboardPaste size={16} aria-hidden /> Paste
            </button>
          </div>
        </div>
        <p className="hint">Ask the other person to tap Share on their Workout page and send you the code. You will see what it contains before anything changes.</p>
      </form>
    </Modal>
  );
}
