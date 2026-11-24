import { useState } from "react";
import { ClipboardPaste, ListPlus, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import EmptyState from "../../components/ui/EmptyState";
import ErrorState from "../../components/ui/ErrorState";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../services/apiError";
import { exerciseSetService } from "../../services/exerciseSetService";
import type { ExerciseSet, ShareCreated } from "../../types/exerciseSet";
import ExerciseDetailDialog from "./ExerciseDetailDialog";
import ExerciseThumb from "./ExerciseThumb";
import { useCatalogue } from "./catalogueStore";
import { useAsync } from "../progress/useAsync";
import ExerciseSetDialog from "./ExerciseSetDialog";
import ImportCodeDialog from "./ImportCodeDialog";
import ShareCodeDialog from "./ShareCodeDialog";
import { copyText } from "./copyText";

/** "My exercises": your own named sets (Chest A, Chest B…), each shown as a card with its exercises in a row. */
export default function MyExercises() {
  const toast = useToast();
  const sets = useAsync<ExerciseSet[]>((s) => exerciseSetService.list(s), []);
  const { catalogue, byKey } = useCatalogue();
  const [viewing, setViewing] = useState<string | null>(null);     // catalogue key whose details are open
  const [dialog, setDialog] = useState<{ editing?: ExerciseSet } | null>(null);
  const [deleting, setDeleting] = useState<ExerciseSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [shared, setShared] = useState<{ share: ShareCreated; copied: boolean } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [importing, setImporting] = useState(false);

  /** Make a code for the whole list and copy it to the clipboard. */
  async function share() {
    if (sharing) return;
    setSharing(true);
    try {
      const made = await exerciseSetService.share();
      const copied = await copyText(made.code);
      setShared({ share: made, copied });
      if (copied) toast.success(`Code ${made.code} copied.`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSharing(false);
    }
  }

  const openDialog = (editing?: ExerciseSet) => { if (catalogue) setDialog({ editing }); };

  async function confirmDelete() {
    if (!deleting || busy) return;
    setBusy(true); setDeleteError(null);
    try {
      await exerciseSetService.remove(deleting.id);
      toast.success(`"${deleting.name}" was deleted.`);
      setDeleting(null);
      sets.reload();
    } catch (e) {
      setDeleteError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (sets.error && !sets.data) return <ErrorState title="Couldn't load your exercises" message={sets.error} onRetry={sets.reload} />;
  if (!sets.data) return <div className="skeleton cat-skeleton" aria-busy="true" role="status" aria-label="Loading your exercises" />;

  const list = sets.data;
  const addButton = (
    <button type="button" className="btn" disabled={!catalogue} onClick={() => openDialog()} data-testid="add-set">
      <Plus size={16} aria-hidden /> Add
    </button>
  );

  return (
    <div className="sx">
      <div className="sx-bar">
        <p className="hint">{list.length === 0 ? "Group exercises into your own sets, like Chest A or Leg B." : `${list.length} ${list.length === 1 ? "set" : "sets"}`}</p>
        <div className="sx-tools">
          <button type="button" className="icon-btn sx-tool" aria-label="Share my exercises" title="Share: copy a code for your whole list"
            disabled={list.length === 0 || sharing} onClick={share}><Share2 size={17} aria-hidden /></button>
          <button type="button" className="icon-btn sx-tool" aria-label="Paste a share code" title="Paste a code to copy someone else's list"
            onClick={() => setImporting(true)}><ClipboardPaste size={17} aria-hidden /></button>
          {list.length > 0 && addButton}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState Icon={ListPlus} title="No exercises yet" description="Add your first set: choose a muscle, then the exercises you want in it.">
          {addButton}
        </EmptyState>
      ) : (
        <ul className="sx-list" aria-label="My exercises">
          {list.map((s) => (
            <li key={s.id} className="sx-card" data-testid={`set-${s.id}`}>
              <header className="sx-head">
                <div><b>{s.name}</b><span className="tag tag-type">{s.muscle_group}</span><small>{s.exercises.length} {s.exercises.length === 1 ? "exercise" : "exercises"}</small></div>
                <div className="sx-actions">
                  <button type="button" className="icon-btn" aria-label={`Edit ${s.name}`} onClick={() => openDialog(s)}><Pencil size={15} aria-hidden /></button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => { setDeleteError(null); setDeleting(s); }}><Trash2 size={15} aria-hidden /></button>
                </div>
              </header>
              <ul className="sx-row-h" aria-label={`${s.name} exercises`}>
                {s.exercises.map((e) => (
                  <li key={e.key} className="sx-chip">
                    <button type="button" className="sx-chip-btn" onClick={() => setViewing(e.key)} aria-label={`Show ${e.name}`}>
                      <span className="sx-chip-icon"><ExerciseThumb item={byKey(e.key)} motion={e.icon_motion} size={44} /></span>
                      <b>{e.name}</b>
                      <small>{e.equipment}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {dialog && catalogue && (
        <ExerciseSetDialog catalogue={catalogue} existing={list} editing={dialog.editing} onClose={() => setDialog(null)}
          onSaved={(saved, wasNew) => {
            setDialog(null);
            sets.reload();
            toast.success(wasNew ? `"${saved.name}" was added.` : `"${saved.name}" was saved.`);
          }} />
      )}
      {viewing && byKey(viewing) && (
        <ExerciseDetailDialog item={byKey(viewing)!} motions={catalogue?.motions} onClose={() => setViewing(null)} />
      )}
      {shared && <ShareCodeDialog share={shared.share} copied={shared.copied} onClose={() => setShared(null)} />}
      {importing && (
        <ImportCodeDialog current={list} onClose={() => setImporting(false)}
          onImported={(r) => {
            setImporting(false);
            sets.reload();
            toast.success(`Done. ${r.removed ? `${r.removed} ${r.removed === 1 ? "set was" : "sets were"} replaced by ` : "Added "}${r.imported} shared ${r.imported === 1 ? "set" : "sets"}.`);
          }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.name}?`} confirmLabel="Delete" tone="danger" busy={busy} error={deleteError}
          onConfirm={confirmDelete} onCancel={() => setDeleting(null)}>
          <p>This removes the set only. The exercises themselves stay in the catalogue.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
