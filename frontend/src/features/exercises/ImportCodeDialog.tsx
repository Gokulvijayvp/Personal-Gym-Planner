import { useState } from "react";
import type { FormEvent } from "react";
import { ClipboardPaste } from "lucide-react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Modal from "../../components/ui/Modal";
import { getErrorMessage } from "../../services/apiError";
import { exerciseSetService } from "../../services/exerciseSetService";
import type { ExerciseSet, ImportResult, SharedPreview } from "../../types/exerciseSet";
import { pasteText } from "./copyText";

interface Props {
  /** The person's current sets: they are deleted if the import goes ahead, so they are named in the warning. */
  current: ExerciseSet[];
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

const list = (names: string[]) => (names.length <= 6 ? names.join(", ") : `${names.slice(0, 6).join(", ")} and ${names.length - 6} more`);

/** Paste a share code, check what it holds, confirm, and replace My exercises with it. */
export default function ImportCodeDialog({ current, onClose, onImported }: Props) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<SharedPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (code.replace(/[^a-z0-9]/gi, "").length < 4) { setError("Paste the share code first."); return; }
    setBusy(true); setError(null);
    try {
      setPreview(await exerciseSetService.previewShared(code.trim()));
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

  async function confirm() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      onImported(await exerciseSetService.importShared(code.trim()));
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  if (preview) {
    const incoming = preview.sets.map((s) => `${s.name} (${s.exercise_count})`);
    return (
      <ConfirmDialog title="Replace your My exercises?" confirmLabel={current.length ? "Delete mine and import" : "Import"} tone="danger"
        busy={busy} error={error} onConfirm={confirm} onCancel={onClose}>
        {current.length > 0 ? (
          <p><b>Your {current.length} current {current.length === 1 ? "set" : "sets"} will be deleted</b> ({list(current.map((s) => s.name))}) and cannot be brought back.</p>
        ) : (
          <p>You have no sets yet, so nothing will be deleted.</p>
        )}
        <p>They will be replaced by the {preview.sets_count} shared {preview.sets_count === 1 ? "set" : "sets"}: {list(incoming)}.</p>
      </ConfirmDialog>
    );
  }

  return (
    <Modal title="Paste a share code" size="sm" onClose={onClose} dismissible={!busy} closeOnBackdrop
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="import-code-form" className="btn" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
      </>}>
      <form id="import-code-form" className="shc" onSubmit={check} noValidate>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="field">
          <label htmlFor="share-code">Share code</label>
          <div className="shc-row">
            <input id="share-code" className="shc-code" value={code} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false}
              placeholder="XXXXX-XXXXX" maxLength={40} onChange={(e) => { setCode(e.target.value); setError(null); }} />
            <button type="button" className="btn btn-outline" onClick={pasteFromClipboard} disabled={busy}>
              <ClipboardPaste size={16} aria-hidden /> Paste
            </button>
          </div>
        </div>
        <p className="hint">Ask the other person to tap Share in their My exercises and send you the code. You will see what it contains before anything changes.</p>
      </form>
    </Modal>
  );
}
