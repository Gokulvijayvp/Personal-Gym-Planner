import { CalendarRange } from "lucide-react";
import { todayISO } from "../../utils/date";
import { PRESETS, customError, type Preset, type RangeSelection } from "./progressLogic";

interface Props { value: RangeSelection; onChange: (next: RangeSelection) => void; summary: string }

/** The date range every card and chart on the page follows. Dates are Asia/Kolkata calendar dates. */
export default function RangeBar({ value, onChange, summary }: Props) {
  const error = customError(value);
  const today = todayISO();
  return (
    <section className="panel range-bar" aria-label="Date range">
      <div className="range-main">
        <label className="select-field range-select">
          <span><CalendarRange size={13} aria-hidden /> Date range</span>
          <select value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value as Preset })} data-testid="range-select">
            {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        {value.preset === "custom" && (
          <div className="range-custom">
            <label className="select-field"><span>From</span>
              <input type="date" value={value.from} max={value.to || today} onChange={(e) => onChange({ ...value, from: e.target.value })} data-testid="range-from" />
            </label>
            <label className="select-field"><span>To</span>
              <input type="date" value={value.to} min={value.from || undefined} max={today} onChange={(e) => onChange({ ...value, to: e.target.value })} data-testid="range-to" />
            </label>
          </div>
        )}
      </div>
      {error ? <p className="form-alert range-error" role="alert">{error}</p> : <p className="range-summary" data-testid="range-summary">{summary}</p>}
    </section>
  );
}
