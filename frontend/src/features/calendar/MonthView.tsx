import { CircleCheck, HeartPulse, Moon, Play } from "lucide-react";
import type { DateString } from "../../types/api";
import type { CalendarDay } from "../../types/calendar";
import { formatDateOnly } from "../../utils/date";
import { compactLabel, describeDay } from "./calendarLogic";

interface Props {
  weeks: DateString[][];
  /** The month being shown (any date inside it); other dates in the grid are dimmed. */
  anchor: DateString;
  days: Map<DateString, CalendarDay>;
  today: DateString;
  selected: DateString;
  onSelect: (date: DateString) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function MonthView({ weeks, anchor, days, today, selected, onSelect }: Props) {
  const month = anchor.slice(0, 7);
  return (
    <div className="cal-month" role="grid" aria-label="Month">
      <div className="cal-weekdays" role="row">
        {WEEKDAYS.map((d) => <span key={d} role="columnheader">{d}</span>)}
      </div>
      {weeks.map((week) => (
        <div className="cal-week" role="row" key={week[0]}>
          {week.map((date) => {
            const day = days.get(date);
            const kind = day?.plan?.kind ?? null;
            const label = day ? compactLabel(day) : "";
            const classes = ["cal-cell"];
            if (date.slice(0, 7) !== month) classes.push("out");
            if (date === today) classes.push("today");
            if (date === selected) classes.push("selected");
            if (kind) classes.push(`kind-${kind}`);
            if (day?.cycle) classes.push("in-cycle");
            return (
              <button type="button" key={date} role="gridcell" className={classes.join(" ")}
                aria-label={day ? describeDay(day) : formatDateOnly(date, { weekday: "long", day: "numeric", month: "long" })} aria-current={date === today ? "date" : undefined}
                title={day ? describeDay(day) : undefined} onClick={() => onSelect(date)}>
                <span className="cal-num">{Number(date.slice(8))}</span>
                {kind && kind !== "empty" && (
                  <span className="cal-dots" aria-hidden>
                    {kind === "rest" ? <Moon size={11} /> : <i className={`dot dot-${kind}`} />}
                    {kind === "mixed" && <HeartPulse size={11} />}
                  </span>
                )}
                {day?.workout && (
                  <span className={`cal-logged s-${day.workout.status}`} aria-hidden title={day.workout.status === "completed" ? "Workout logged" : "Workout in progress"}>
                    {day.workout.status === "completed" ? <CircleCheck size={13} /> : <Play size={11} />}
                  </span>
                )}
                {day?.cycle && day.week_number && day.day_of_week === 0 && (
                  <span className="cal-weektag" aria-hidden>W{day.week_number}</span>
                )}
                {kind === "empty" && day?.cycle && (
                  <>
                    <span className="cal-dots" aria-hidden><i className="dot dot-empty" /></span>
                    <span className="cal-label cal-label-empty" aria-hidden>Not planned</span>
                  </>
                )}
                {label && <span className="cal-label" aria-hidden>{label}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
