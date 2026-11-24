import { Link } from "react-router-dom";
import { Archive, CalendarRange, CheckCheck, ClipboardList, Pencil, Play, Trash2 } from "lucide-react";
import type { CycleSummary } from "../../types/planner";
import { STATUS_LABEL, formatRange } from "./cycleForm";
import type { CycleAction } from "./CycleActionDialog";

interface Props {
  cycle: CycleSummary;
  highlight?: boolean;
  onEdit: (c: CycleSummary) => void;
  onAction: (action: CycleAction, c: CycleSummary) => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function CycleCard({ cycle: c, highlight = false, onEdit, onAction }: Props) {
  const editable = c.status === "draft" || c.status === "active";
  return (
    <article className={highlight ? "cycle-card cycle-active" : "cycle-card"} aria-label={c.name}>
      <header className="cycle-head">
        <div className="cycle-title">
          <h3>{c.name}</h3>
          <span className={`badge badge-${c.status}`}>{STATUS_LABEL[c.status]}</span>
        </div>
      </header>

      <p className="cycle-dates"><CalendarRange size={15} aria-hidden /> {formatRange(c.start_date, c.end_date)}
        <span className="dot">·</span> {plural(c.total_weeks, "week")}</p>
      {c.description && <p className="ex-desc">{c.description}</p>}

      <ul className="cycle-stats" aria-label="Plan summary">
        <li><b>{c.planned_days}</b> workout days</li>
        <li><b>{c.exercise_count}</b> exercises</li>
        <li><b>{c.rest_days}</b> rest days</li>
        <li><b>{c.cardio_count}</b> cardio</li>
      </ul>

      <footer className="ex-actions cycle-actions">
        <Link className="btn btn-sm" to={`/planner?cycle=${c.id}`} aria-label={`Open planner for ${c.name}`}>
          <ClipboardList size={14} /> {editable ? "Open planner" : "View plan"}
        </Link>
        {editable && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onEdit(c)} aria-label={`Edit ${c.name}`}>
            <Pencil size={14} /> Edit
          </button>
        )}
        {c.status === "draft" && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onAction("activate", c)} aria-label={`Activate ${c.name}`}>
            <Play size={14} /> Activate
          </button>
        )}
        {c.status === "active" && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onAction("complete", c)} aria-label={`Complete ${c.name}`}>
            <CheckCheck size={14} /> Complete
          </button>
        )}
        {c.status !== "archived" && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onAction("archive", c)} aria-label={`Archive ${c.name}`}>
            <Archive size={14} /> Archive
          </button>
        )}
        {c.status === "draft" && (
          <button type="button" className="btn btn-outline btn-sm btn-danger-outline btn-icon-only" onClick={() => onAction("delete", c)}
            aria-label={`Delete ${c.name}`} title="Delete draft">
            <Trash2 size={14} /> <span className="btn-text">Delete</span>
          </button>
        )}
      </footer>
    </article>
  );
}
