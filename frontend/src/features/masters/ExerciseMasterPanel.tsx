import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Dumbbell, Pencil, Plus, Search, Trash2, Wand2 } from "lucide-react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { exerciseMasterService } from "../../services/exerciseMasterService";
import type { ExerciseMaster } from "../../types/exerciseMaster";
import { useAsync } from "../progress/useAsync";
import ExerciseIcon from "./ExerciseIcon";

const AUTO = "auto";

interface FormProps {
  master: ExerciseMaster | null;           // null = adding
  motions: Record<string, string>;
  onClose: () => void;
  onSaved: (m: ExerciseMaster) => void;
}

function MasterFormModal({ master, motions, onClose, onSaved }: FormProps) {
  const uid = useId();
  const [name, setName] = useState(master?.name ?? "");
  const [motion, setMotion] = useState(master?.icon_motion ?? AUTO);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Auto: ask the server which movement it would pick for the typed name, so the icon shows before saving.
  const [guess, setGuess] = useState<string | null>(null);
  useEffect(() => {
    const typed = name.replace(/\s+/g, " ").trim();
    if (motion !== AUTO || typed.length < 2) { setGuess(null); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      exerciseMasterService.guess(typed, controller.signal).then((g) => setGuess(g?.icon_motion ?? null)).catch(() => undefined);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [name, motion]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (trimmed.length < 2) { setError("Enter at least 2 characters."); return; }
    setSaving(true); setError(null); setFormError(null);
    try {
      const input = { name: trimmed, ...(motion === AUTO ? {} : { icon_motion: motion }) };
      const saved = master ? await exerciseMasterService.update(master.id, input) : await exerciseMasterService.create(input);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === "validation" || err.status === 409)) {
        setError(err.fieldErrors?.name ?? err.message);
      } else {
        setFormError(getErrorMessage(err));
      }
      setSaving(false);
    }
  }

  return (
    <Modal title={master ? "Edit exercise master" : "Add exercise master"} onClose={onClose} dismissible={!saving}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form={`${uid}-form`} className="btn" disabled={saving}>
          {saving ? "Saving…" : master ? "Save changes" : "Add exercise"}
        </button>
      </>}>
      <form id={`${uid}-form`} onSubmit={submit} noValidate className="ex-form">
        {formError && <p className="form-alert" role="alert">{formError}</p>}
        <div className={error ? "field has-error" : "field"}>
          <label htmlFor={`${uid}-name`}>Exercise name <span className="req">*</span></label>
          <input id={`${uid}-name`} value={name} maxLength={200} autoComplete="off" placeholder="e.g. Incline Dumbbell Press"
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${uid}-err` : undefined}
            onChange={(e) => { setName(e.target.value); setError(null); }} />
          {error && <span className="error-text" id={`${uid}-err`} role="alert">{error}</span>}
          {master && master.usage_count > 0 && (
            <span className="hint">Renaming also renames the {master.usage_count} library exercise{master.usage_count === 1 ? "" : "s"} that use it.</span>
          )}
        </div>
        <fieldset className="icon-picker">
          <legend>Icon animation</legend>
          <div className="icon-picker-grid">
            <label className={motion === AUTO ? "icon-choice is-on" : "icon-choice"}>
              <input type="radio" name={`${uid}-motion`} value={AUTO} checked={motion === AUTO} onChange={() => setMotion(AUTO)} />
              {guess ? <ExerciseIcon motion={guess} size={44} /> : <span className="icon-auto"><Wand2 size={26} /></span>}
              <span>Auto</span>
            </label>
            {Object.entries(motions).map(([key, label]) => (
              <label key={key} className={motion === key ? "icon-choice is-on" : "icon-choice"}>
                <input type="radio" name={`${uid}-motion`} value={key} checked={motion === key} onChange={() => setMotion(key)} />
                <ExerciseIcon motion={key} size={44} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {motion === AUTO && guess ? (
            <div className="icon-preview" data-testid="auto-preview" aria-live="polite">
              <ExerciseIcon motion={guess} size={72} />
              <span>Auto icon for “{name.replace(/\s+/g, " ").trim()}”: <b>{motions[guess] ?? guess}</b>. Pick another above to change it.</span>
            </div>
          ) : (
            <p className="hint">{motion === AUTO ? "Type the exercise name and its animated icon is generated here." : "You can change this any time."}</p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

export default function ExerciseMasterPanel() {
  const toast = useToast();
  const list = useAsync((s) => exerciseMasterService.list(s), []);
  const [editing, setEditing] = useState<ExerciseMaster | "new" | null>(null);
  const [deleting, setDeleting] = useState<ExerciseMaster | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const items = list.data?.items ?? [];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((m) => m.name.toLowerCase().includes(q)) : items;
  }, [items, filter]);

  async function confirmDelete() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true); setDeleteError(null);
    try {
      await exerciseMasterService.remove(deleting.id);
      toast.success(`${deleting.name} removed from the master list.`);
      setDeleting(null);
      list.reload();
    } catch (e) {
      setDeleteError(getErrorMessage(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  if (list.error && !list.data) return <ErrorState title="Couldn't load the exercise master" message={list.error} onRetry={list.reload} />;
  if (!list.data) return <div className="skeleton settings-skeleton" aria-busy="true" role="status" aria-label="Loading exercise master" />;

  const motions = list.data.motions;
  return (
    <div className="master-panel" aria-busy={list.loading || undefined}>
      <div className="master-toolbar">
        <div className="master-search">
          <Search size={15} aria-hidden />
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search exercises"
            aria-label="Search exercise master" />
        </div>
        <button type="button" className="btn" onClick={() => setEditing("new")}><Plus size={16} /> Add exercise</button>
      </div>
      <p className="settings-note">
        The names your Exercise Library picks from. Each has an animated icon showing the movement. A Library exercise you add
        is linked to a master with the same name, and one is created for you if it is new.
      </p>

      {items.length === 0 ? (
        <EmptyState Icon={Dumbbell} title="No exercise masters yet"
          description="Add one here, or add an exercise in the Exercise Library and it will appear here.">
          <button type="button" className="btn" onClick={() => setEditing("new")}><Plus size={16} /> Add exercise</button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="master-none">No exercise matches “{filter}”.</p>
      ) : (
        <ul className="master-list" aria-label="Exercise master list">
          {shown.map((m) => (
            <li key={m.id} className="master-row" data-testid={`master-${m.id}`}>
              <ExerciseIcon motion={m.icon_motion} size={56} label={`${motions[m.icon_motion] ?? "Weight"} animation`} />
              <div className="master-info">
                <b>{m.name}</b>
                <span>{motions[m.icon_motion] ?? "Generic weight"} · {m.usage_count === 0 ? "Not used yet" : `Used by ${m.usage_count} library exercise${m.usage_count === 1 ? "" : "s"}`}</span>
              </div>
              <div className="master-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}>
                  <Pencil size={14} /> Edit
                </button>
                <button type="button" className="btn btn-outline btn-sm btn-danger-outline" disabled={m.usage_count > 0}
                  title={m.usage_count > 0 ? "In use by the Exercise Library" : undefined}
                  onClick={() => { setDeleteError(null); setDeleting(m); }} aria-label={`Delete ${m.name}`}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <MasterFormModal master={editing === "new" ? null : editing} motions={motions} onClose={() => setEditing(null)}
          onSaved={(saved) => { toast.success(editing === "new" ? `${saved.name} added.` : "Exercise master saved."); setEditing(null); list.reload(); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.name}?`} confirmLabel="Delete" tone="danger" busy={deleteBusy} error={deleteError}
          onConfirm={confirmDelete} onCancel={() => setDeleting(null)}>
          <p>This removes the name and icon from the master list. No Library exercise uses it.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
