import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../services/apiError";
import { catalogueService } from "../../services/catalogueService";
import type { CatalogueItem, CatalogueMedia } from "../../types/catalogue";
import ExerciseIcon from "../masters/ExerciseIcon";

interface Props {
  item: CatalogueItem;
  media: CatalogueMedia[];
  onChange: (key: string, media: CatalogueMedia[]) => void;
  onClose: () => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";

/** Add or remove an exercise's pictures and videos. Several files can be chosen at once. */
export default function MediaEditorDialog({ item, media, onChange, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);   // "upload" or "del<id>"
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const toast = useToast();

  async function upload(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;
    setBusy("upload"); setError(null);
    try {
      onChange(item.key, await catalogueService.uploadMedia(item.key, Array.from(files)));
      setChanged(true);
      toast.success(`${files.length === 1 ? "File" : `${files.length} files`} uploaded.`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(m: CatalogueMedia) {
    if (busy) return;
    setBusy(`del${m.id}`); setError(null);
    try {
      await catalogueService.deleteMedia(m.id);
      onChange(item.key, media.filter((x) => x.id !== m.id));
      setChanged(true);
      toast.success("Removed.");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function done() {
    if (changed) toast.success(`Pictures and videos saved for "${item.name}".`);
    onClose();
  }

  return (
    <Modal title={`Pictures & videos · ${item.name}`} size="md" onClose={onClose} dismissible={busy === null} closeOnBackdrop
      footer={<button type="button" className="btn" onClick={done} disabled={busy !== null}>Done</button>}>
      <div className="me">
        <p className="hint">
          Pictures slide automatically on the exercise card details. A video always comes last. Without any upload, the
          animated icon is shown.
        </p>
        {error && <p className="form-alert" role="alert">{error}</p>}

        {media.length === 0 ? (
          <div className="me-empty"><ExerciseIcon motion={item.icon_motion} size={64} /><span>Nothing uploaded yet. The animated icon is used.</span></div>
        ) : (
          <ul className="me-grid" aria-label="Uploaded pictures and videos">
            {media.map((m, i) => (
              <li key={m.id} className="me-item">
                {m.kind === "video"
                  ? <video src={m.url} muted preload="metadata" aria-label="Video" />
                  : <img src={m.url} alt={`Picture ${i + 1}`} />}
                {m.kind === "video" && <span className="me-badge">Video</span>}
                <button type="button" className="me-del" disabled={busy !== null} onClick={() => remove(m)}
                  aria-label={`Remove ${m.kind === "video" ? "video" : `picture ${i + 1}`}`}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <input ref={input} type="file" accept={ACCEPT} multiple hidden aria-label="Choose pictures or videos"
          onChange={(e) => upload(e.target.files)} />
        <button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => input.current?.click()}>
          <ImagePlus size={16} aria-hidden /> {busy === "upload" ? "Uploading…" : "Add pictures or videos"}
        </button>
        <p className="hint">JPG, PNG, WebP or GIF up to 10 MB each. MP4, WebM or MOV videos up to 200 MB.</p>
      </div>
    </Modal>
  );
}
