import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../services/apiError";
import { catalogueService } from "../../services/catalogueService";
import { masterDataService } from "../../services/exerciseService";
import type { CatalogueItem, CatalogueMedia } from "../../types/catalogue";
import type { MuscleGroup } from "../../types/exercise";

interface Props {
  onClose: () => void;
  /** The new exercise, with whatever pictures/videos were uploaded for it. */
  onCreated: (item: CatalogueItem, media: CatalogueMedia[]) => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";

interface Picked { id: number; file: File; url: string; video: boolean }

/**
 * Admin: add an exercise to the catalogue. Top: pictures and videos. Then: muscle group (list), target area (list for
 * that muscle), equipment and movement (free text). Everyone then sees the exercise, with its pictures.
 */
export default function AddCatalogueExerciseDialog({ onClose, onCreated }: Props) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const [groups, setGroups] = useState<MuscleGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [group, setGroup] = useState("");
  const [area, setArea] = useState("");
  const [name, setName] = useState("");
  const [equipment, setEquipment] = useState("");
  const [movement, setMovement] = useState("");
  const [errors, setErrors] = useState<{ name?: string; group?: string; equipment?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = new AbortController();
    masterDataService.muscleGroups(c.signal).then(setGroups).catch((e: unknown) => { if (!c.signal.aborted) setLoadError(getErrorMessage(e)); });
    return () => c.abort();
  }, []);

  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const areas = useMemo(() => groups?.find((g) => g.name === group)?.target_areas ?? [], [groups, group]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list).map((file) => ({ id: nextId.current++, file, url: URL.createObjectURL(file), video: file.type.startsWith("video/") }));
    setFiles((f) => [...f, ...picked]);
    if (input.current) input.current.value = "";
  }
  function removeFile(id: number) {
    setFiles((f) => { const gone = f.find((x) => x.id === id); if (gone) URL.revokeObjectURL(gone.url); return f.filter((x) => x.id !== id); });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next = {
      group: group ? undefined : "Choose a muscle group.",
      name: name.trim().length < 2 ? "Enter the exercise name." : undefined,
      equipment: equipment.trim() ? undefined : "Enter the equipment (for example Barbell, or Bodyweight).",
    };
    if (next.group || next.name || next.equipment) { setErrors(next); return; }
    setBusy(true); setErrors({});
    let item: CatalogueItem;
    try {
      item = await catalogueService.create({
        name: name.trim().replace(/\s+/g, " "), muscle_group: group, target_area: area || null, equipment: equipment.trim().replace(/\s+/g, " "), movement: movement.trim().replace(/\s+/g, " ") || null,
      });
    } catch (err) {
      setErrors({ form: getErrorMessage(err) });
      setBusy(false);
      return;
    }
    let media: CatalogueMedia[] = [];
    if (files.length > 0) {
      try {
        media = await catalogueService.uploadMedia(item.key, files.map((f) => f.file));
      } catch (err) {
        // the exercise exists now; only the upload failed, and it can be retried from the pencil on its card
        onCreated(item, []);
        toast.error(`"${item.name}" was added, but its pictures could not be uploaded: ${getErrorMessage(err)} Use the pencil on its card to try again.`);
        onClose();
        return;
      }
    }
    onCreated(item, media);
    toast.success(`"${item.name}" was added${media.length ? ` with ${media.length} ${media.length === 1 ? "file" : "files"}` : ""}.`);
    onClose();
  }

  return (
    <Modal title="Add exercise" size="md" onClose={onClose} dismissible={!busy} closeOnBackdrop={false}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="add-catalogue-form" className="btn" disabled={busy || !groups} data-testid="catalogue-save">{busy ? "Adding…" : "Add exercise"}</button>
      </>}>
      <form id="add-catalogue-form" className="ace" onSubmit={submit} noValidate>
        {errors.form && <p className="form-alert" role="alert">{errors.form}</p>}
        {loadError && <p className="form-alert" role="alert">{loadError}</p>}

        <section className="ace-media" aria-label="Pictures and videos">
          <div className="ace-media-head">
            <b>Pictures &amp; videos</b>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => input.current?.click()} disabled={busy}>
              <ImagePlus size={15} aria-hidden /> Add files
            </button>
          </div>
          <input ref={input} type="file" accept={ACCEPT} multiple hidden aria-label="Choose pictures or videos" onChange={(e) => addFiles(e.target.files)} />
          {files.length === 0 ? (
            <p className="hint">Optional. Pictures slide automatically and a video always comes last. JPG, PNG, WebP or GIF up to 10 MB; MP4, WebM or MOV up to 200 MB.</p>
          ) : (
            <ul className="me-grid" aria-label="Chosen files">
              {files.map((f, i) => (
                <li key={f.id} className="me-item">
                  {f.video ? <video src={f.url} muted preload="metadata" aria-label="Video" /> : <img src={f.url} alt={`Picture ${i + 1}`} />}
                  {f.video && <span className="me-badge">Video</span>}
                  <button type="button" className="me-del" onClick={() => removeFile(f.id)} disabled={busy} aria-label={`Remove ${f.video ? "video" : `picture ${i + 1}`}`}>
                    <X size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="field">
          <label htmlFor="ace-name">Exercise name <span className="req" aria-hidden>*</span></label>
          <input id="ace-name" type="text" value={name} maxLength={120} autoComplete="off" onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }}
            aria-invalid={!!errors.name} aria-describedby={errors.name ? "ace-name-err" : undefined} />
          {errors.name && <p id="ace-name-err" className="error-text" role="alert">{errors.name}</p>}
        </div>

        <div className="ace-row">
          <div className="field">
            <label htmlFor="ace-group">Muscle group <span className="req" aria-hidden>*</span></label>
            <select id="ace-group" value={group} disabled={!groups} aria-invalid={!!errors.group} aria-describedby={errors.group ? "ace-group-err" : undefined}
              onChange={(e) => { setGroup(e.target.value); setArea(""); setErrors((x) => ({ ...x, group: undefined })); }}>
              <option value="">{groups ? "Choose a muscle group" : "Loading…"}</option>
              {(groups ?? []).map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
            </select>
            {errors.group && <p id="ace-group-err" className="error-text" role="alert">{errors.group}</p>}
          </div>
          <div className="field">
            <label htmlFor="ace-area">Target area <span className="optional">(optional)</span></label>
            <select id="ace-area" value={area} disabled={!group || areas.length === 0} onChange={(e) => setArea(e.target.value)}>
              <option value="">{!group ? "Choose a muscle group first" : areas.length === 0 ? "No target areas" : "Not specific"}</option>
              {areas.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ace-equipment">Equipment <span className="req" aria-hidden>*</span></label>
          <input id="ace-equipment" type="text" value={equipment} maxLength={80} autoComplete="off" placeholder="For example Barbell, Cable, Bodyweight"
            onChange={(e) => { setEquipment(e.target.value); setErrors((x) => ({ ...x, equipment: undefined })); }}
            aria-invalid={!!errors.equipment} aria-describedby={errors.equipment ? "ace-eq-err" : undefined} />
          {errors.equipment && <p id="ace-eq-err" className="error-text" role="alert">{errors.equipment}</p>}
        </div>

        <div className="field">
          <label htmlFor="ace-movement">Movement <span className="optional">(optional)</span></label>
          <input id="ace-movement" type="text" value={movement} maxLength={200} autoComplete="off" placeholder="Describe the movement, for example Press up and forward"
            onChange={(e) => setMovement(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
