import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Search, SearchX, SlidersHorizontal } from "lucide-react";
import ErrorState from "../../components/ui/ErrorState";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { catalogueService } from "../../services/catalogueService";
import { useSession } from "../auth/session";
import type { Catalogue, CatalogueItem, CatalogueMedia } from "../../types/catalogue";
import { useAsync } from "../progress/useAsync";
import ExerciseThumb from "./ExerciseThumb";
import MediaCarousel from "./MediaCarousel";
import AddCatalogueExerciseDialog from "./AddCatalogueExerciseDialog";
import { addCatalogueItem, setCatalogueMedia } from "./catalogueStore";
import MediaEditorDialog from "./MediaEditorDialog";

interface Props {
  /** Called with how many exercises were added during this visit (so a host can refresh its list). */
  onAddedCount?: (n: number) => void;
  /** Look only: no Add buttons and no "In library" marks. */
  readOnly?: boolean;
  /** Admin tools: the edit (pencil) button on each card and the Add exercise button. Shown only when the signed-in user is the admin. */
  allowMedia?: boolean;
}

const uniq = (xs: string[]) => Array.from(new Set(xs));

interface ChipsProps {
  label: string; all: string; values: string[]; value: string; onChange: (v: string) => void;
  /** How many exercises each chip would show (shown beside the name; "" = the All chip). */
  counts?: Record<string, number>;
}

function Chips({ label, all, values, value, onChange, counts }: ChipsProps) {
  return (
    <div className="cat-chips" role="group" aria-label={label}>
      {[["", all], ...values.map((v) => [v, v])].map(([v, text]) => (
        <button key={v || "all"} type="button" className={value === v ? "cat-chip is-on" : "cat-chip"} aria-pressed={value === v}
          onClick={() => onChange(v)}>
          {text}{counts && counts[v] !== undefined && <span className="cat-chip-n" aria-hidden>{counts[v]}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Browse the built-in exercise catalogue: Muscle group -> Target area -> Equipment -> exercise cards.
 * Tap a card for its details, or Add to put it in your library. Used inline on the Exercises tab and in a dialog.
 */
export default function CatalogueBrowser({ onAddedCount, readOnly = false, allowMedia: adminTools = false }: Props) {
  const toast = useToast();
  const session = useSession();
  const allowMedia = adminTools && session.status === "in" && session.user.role === "admin";    // the server enforces this too (403)
  const [adding, setAdding] = useState(false);
  const cat = useAsync<Catalogue>((s) => catalogueService.list(s), []);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [area, setArea] = useState("");
  const [equipment, setEquipment] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [detail, setDetail] = useState<CatalogueItem | null>(null);
  const [editing, setEditing] = useState<CatalogueItem | null>(null);
  const [mediaByKey, setMediaByKey] = useState<Record<string, CatalogueMedia[]>>({});   // after an upload / removal
  const mediaOf = (i: CatalogueItem): CatalogueMedia[] => mediaByKey[i.key] ?? i.media ?? [];
  const [moreOpen, setMoreOpen] = useState(false);       // phones: target area + equipment live behind a Filters button

  useEffect(() => { onAddedCount?.(added.size); }, [added.size, onAddedCount]);

  const items = cat.data?.items ?? [];
  const inGroup = useMemo(() => items.filter((i) => !group || i.muscle_group === group), [items, group]);
  const areas = useMemo(() => uniq(inGroup.map((i) => i.target_area ?? "")).filter(Boolean), [inGroup]);
  const inArea = useMemo(() => inGroup.filter((i) => !area || i.target_area === area), [inGroup, area]);
  const equipments = useMemo(() => uniq(inArea.map((i) => i.equipment)), [inArea]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inArea.filter((i) => (!equipment || i.equipment === equipment)
      && (!q || `${i.name} ${i.muscle_group} ${i.target_area ?? ""} ${i.equipment}`.toLowerCase().includes(q)));
  }, [inArea, equipment, search]);

  // how many exercises each chip leads to (muscle: all; area: within the muscle; equipment: within muscle + area)
  const countBy = (xs: CatalogueItem[], key: (i: CatalogueItem) => string) => {
    const out: Record<string, number> = { "": xs.length };
    for (const i of xs) out[key(i)] = (out[key(i)] ?? 0) + 1;
    return out;
  };
  const groupCounts = useMemo(() => countBy(items, (i) => i.muscle_group), [items]);
  const areaCounts = useMemo(() => countBy(inGroup, (i) => i.target_area ?? ""), [inGroup]);
  const equipmentCounts = useMemo(() => countBy(inArea, (i) => i.equipment), [inArea]);
  const narrowed = (area ? 1 : 0) + (equipment ? 1 : 0);

  // choosing a broader filter resets the narrower ones, so a stale choice can never hide everything
  const pickGroup = (g: string) => { setGroup(g); setArea(""); setEquipment(""); };
  const pickArea = (a: string) => { setArea(a); setEquipment(""); };

  async function add(item: CatalogueItem) {
    if (busy) return;
    setBusy(item.key); setFailed(null);
    try {
      await catalogueService.add(item.key);
      setAdded((s) => new Set(s).add(item.key));
      toast.success(`"${item.name}" was added to your library.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "already_in_library") {
        setAdded((s) => new Set(s).add(item.key));
        toast.success(`"${item.name}" is already in your library.`);
      } else {
        setFailed({ key: item.key, message: getErrorMessage(e) });
      }
    } finally {
      setBusy(null);
    }
  }
  const have = (i: CatalogueItem) => i.in_library || added.has(i.key);

  if (cat.error && !cat.data) return <ErrorState title="Couldn't load the exercise catalogue" message={cat.error} onRetry={cat.reload} />;
  if (!cat.data) return <div className="skeleton cat-skeleton" aria-busy="true" role="status" aria-label="Loading exercises" />;

  const addButton = (i: CatalogueItem) => readOnly ? null : have(i) ? (
    <span className="cat-have"><Check size={15} aria-hidden /> In library</span>
  ) : (
    <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => add(i)} aria-label={`Add ${i.name}`}>
      <Plus size={15} /> {busy === i.key ? "Adding…" : "Add"}
    </button>
  );

  return (
    <div className="cat">
      <div className="cat-tools">
        <div className="cat-search-row">
          <div className="master-search">
            <Search size={15} aria-hidden />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exercises"
              aria-label="Search exercise catalogue" autoComplete="off" />
          </div>
          {allowMedia && (
            <button type="button" className="btn btn-sm cat-add-ex" onClick={() => setAdding(true)} data-testid="add-catalogue-exercise">
              <Plus size={15} aria-hidden /> Add exercise
            </button>
          )}
          <button type="button" className={narrowed ? "cat-filter-btn has-active" : "cat-filter-btn"} aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}>
            <SlidersHorizontal size={16} aria-hidden /> Filters{narrowed > 0 && <span className="cat-filter-n">{narrowed}</span>}
          </button>
        </div>
        <Chips label="Muscle group" all="All" values={cat.data.muscle_groups} value={group} onChange={pickGroup} counts={groupCounts} />
        <div className={moreOpen ? "cat-more is-open" : "cat-more"}>
          {group && areas.length > 1 && <Chips label="Target area" all="Any area" values={areas} value={area} onChange={pickArea} counts={areaCounts} />}
          {equipments.length > 1 && <Chips label="Equipment" all="Any equipment" values={equipments} value={equipment} onChange={setEquipment} counts={equipmentCounts} />}
        </div>
        <p className="cat-result" aria-live="polite">{shown.length === items.length ? `${items.length} exercises` : `${shown.length} of ${items.length} exercises`}</p>
      </div>

      {shown.length === 0 ? (
        <div className="cat-none"><SearchX size={22} aria-hidden /><b>No exercise matches</b><span>{readOnly ? "Try another word or muscle group." : "Try another word, or create your own."}</span></div>
      ) : (
        <ul className="cat-grid" aria-label="Exercise catalogue">
          {shown.map((i) => (
            <li key={i.key} className={!readOnly && have(i) ? "cat-card is-have" : "cat-card"} data-testid={`cat-${i.key}`}
              onClick={() => setDetail(i)}>
              <button type="button" className="cat-open" onClick={(e) => { e.stopPropagation(); setDetail(i); }} aria-label={`Details of ${i.name}`}>
                <span className="cat-icon">
                  <ExerciseThumb item={{ ...i, media: mediaOf(i) }} size={64} />
                </span>
              </button>
              <div className={allowMedia ? "cat-info has-edit" : "cat-info"}>
                <b>{i.name}</b>
                <span className="cat-muscle">{i.muscle_group}{i.target_area && i.target_area !== i.muscle_group ? ` · ${i.target_area}` : ""}</span>
                <span className="tag tag-type">{i.equipment}</span>
              </div>
              {allowMedia && (
                <button type="button" className="cat-edit" aria-label={`Edit pictures and videos of ${i.name}`}
                  onClick={(e) => { e.stopPropagation(); setEditing(i); }}>
                  <Pencil size={14} aria-hidden />
                </button>
              )}
              <span onClick={(e) => e.stopPropagation()} style={{ display: "contents" }}>{addButton(i)}</span>
              {failed?.key === i.key && <span className="error-text cat-error" role="alert">{failed.message}</span>}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddCatalogueExerciseDialog onClose={() => setAdding(false)}
          onCreated={(item, media) => {
            addCatalogueItem({ ...item, media });
            setMediaByKey((m) => ({ ...m, [item.key]: media }));
            cat.reload();
          }} />
      )}

      {editing && (
        <MediaEditorDialog item={editing} media={mediaOf(editing)} onClose={() => setEditing(null)}
          onChange={(key, list) => { setMediaByKey((m) => ({ ...m, [key]: list })); setCatalogueMedia(key, list); }} />
      )}

      {detail && (
        <Modal title={detail.name} size="sm" onClose={() => setDetail(null)} closeOnBackdrop
          footer={<><button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>Close</button>{addButton(detail)}</>}>
          <div className="cat-detail">
            <MediaCarousel media={mediaOf(detail)} motion={detail.icon_motion} alt={detail.name} />
            <dl>
              <div><dt>Muscle group</dt><dd>{detail.muscle_group}</dd></div>
              {detail.target_area && <div><dt>Target area</dt><dd>{detail.target_area}</dd></div>}
              <div><dt>Equipment</dt><dd>{detail.equipment}</dd></div>
              <div><dt>Movement</dt><dd>{detail.movement || (cat.data.motions[detail.icon_motion] ?? detail.icon_motion)}</dd></div>
            </dl>
            <p className="hint">{readOnly ? "A demonstration of the movement." : "A demonstration of the movement. Adding it puts it in your library, ready to use in a workout."}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
