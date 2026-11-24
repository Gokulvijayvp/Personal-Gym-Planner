import { HeartPulse, Moon, Pencil, Plus, Eye } from "lucide-react";
import type { DaySummary } from "../../types/planner";
import { formatDateOnly } from "../../utils/date";
import { DAY_NAMES, KIND_LABEL } from "./plannerLogic";

interface Props {
  day: DaySummary;
  isToday: boolean;
  editable: boolean;
  onOpen: (dayOfWeek: number) => void;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function DayRow({ day, isToday, editable, onOpen }: Props) {
  const name = DAY_NAMES[day.day_of_week];
  const empty = day.kind === "empty" && !day.title && !day.notes;
  // The badge already says "Cardio" / "Rest day"; only show a title that adds information.
  const showTitle = (Boolean(day.display_title) && day.display_title !== KIND_LABEL[day.kind] && day.kind !== "empty") || Boolean(day.title);
  const label = !editable ? "View" : empty ? "Plan day" : "Edit day";

  return (
    <li className={`day-row kind-${day.kind}${isToday ? " today" : ""}`} data-testid={`day-${day.day_of_week}`}>
      <div className="day-date">
        <b>{name}</b>
        <span>{formatDateOnly(day.date, { day: "numeric", month: "short" })}</span>
        {isToday && <span className="badge badge-active">Today</span>}
      </div>

      <div className="day-main">
        <div className="day-kind">
          <span className={`kind-badge kind-${day.kind}`}>
            {day.kind === "rest" && <Moon size={12} aria-hidden />}
            {(day.kind === "cardio" || day.kind === "mixed") && <HeartPulse size={12} aria-hidden />}
            {KIND_LABEL[day.kind]}
          </span>
          {showTitle && <b className="day-title">{day.display_title}</b>}
        </div>

        {day.muscle_groups.length > 0 && (
          <div className="ex-tags">{day.muscle_groups.map((g) => <span key={g.id} className="tag tag-primary">{g.name}</span>)}</div>
        )}
        {(day.exercise_count > 0 || day.cardio_count > 0) && (
          <p className="day-meta-line">
            {day.exercise_count > 0 && <span>{plural(day.exercise_count, "exercise")}</span>}
            {day.cardio_count > 0 && <span>{day.cardio_count} cardio</span>}
          </p>
        )}
        {day.notes && <p className="day-note-line">{day.notes}</p>}
      </div>

      <button type="button" className={empty && editable ? "btn btn-sm" : "btn btn-outline btn-sm"}
        onClick={() => onOpen(day.day_of_week)} aria-label={`${label} ${name}`}>
        {!editable ? <Eye size={14} /> : empty ? <Plus size={14} /> : <Pencil size={14} />} {label}
      </button>
    </li>
  );
}
