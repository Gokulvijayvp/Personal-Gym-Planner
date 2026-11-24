import { ChevronLeft, ChevronRight } from "lucide-react";
import { VIEWS, type CalendarView } from "./calendarLogic";

interface Props {
  view: CalendarView;
  title: string;
  onView: (v: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

const LABEL: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day" };

export default function CalendarToolbar({ view, title, onView, onPrev, onNext, onToday }: Props) {
  return (
    <section className="panel cal-toolbar" aria-label="Calendar controls">
      <div className="cal-nav">
        <button type="button" className="icon-btn cal-arrow" aria-label={`Previous ${view}`} onClick={onPrev}><ChevronLeft size={20} /></button>
        <button type="button" className="icon-btn cal-arrow" aria-label={`Next ${view}`} onClick={onNext}><ChevronRight size={20} /></button>
        <button type="button" className="btn btn-outline btn-sm cal-today" onClick={onToday}>Today</button>
        <h2 className="cal-title" aria-live="polite" data-testid="cal-title">{title}</h2>
      </div>
      <div className="seg cal-seg" role="group" aria-label="Calendar view">
        {VIEWS.map((v) => (
          <button key={v} type="button" className={v === view ? "seg-btn on" : "seg-btn"} aria-pressed={v === view} onClick={() => onView(v)}>
            {LABEL[v]}
          </button>
        ))}
      </div>
    </section>
  );
}
