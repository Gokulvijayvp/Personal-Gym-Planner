import type { WeekDay } from "../../types/dashboard";
import { DAY_NAMES } from "../planner/plannerLogic";

interface Props { days: WeekDay[]; selected: string; onSelect: (date: string) => void }

function status(d: WeekDay): { text: string; tone: "plan" | "rest" | "none" } {
  const k = d.plan?.kind;
  if (!k || k === "empty") return { text: "—", tone: "none" };
  if (k === "rest") return { text: "Rest", tone: "rest" };
  return { text: d.plan?.display_title || "Workout", tone: "plan" };
}

/** Monday-to-Sunday strip: tap a day to see and edit it below. Today is marked. */
export default function WeekStrip({ days, selected, onSelect }: Props) {
  return (
    <div className="ws" role="group" aria-label="This week">
      {days.map((d) => {
        const st = status(d);
        const on = d.date === selected;
        return (
          <button key={d.date} type="button" className={`ws-day tone-${st.tone}${on ? " is-on" : ""}${d.is_today ? " is-today" : ""}`}
            aria-pressed={on} aria-current={d.is_today ? "date" : undefined} data-testid={`week-${d.day_of_week}`}
            aria-label={`${DAY_NAMES[d.day_of_week]}${d.is_today ? " (today)" : ""}: ${st.text === "—" ? "nothing planned" : st.text}`}
            onClick={() => onSelect(d.date)}>
            <span className="ws-name">{DAY_NAMES[d.day_of_week].slice(0, 3)}</span>
            <span className="ws-num">{Number(d.date.slice(8, 10))}</span>
            <span className="ws-state">{st.text}</span>
          </button>
        );
      })}
    </div>
  );
}
