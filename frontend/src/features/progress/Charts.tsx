import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { labelIndexes, lineScale, niceScale } from "./progressLogic";

/** The width of an element, kept up to date, with a sensible default where it cannot be measured (tests). */
export function useWidth(fallback = 600): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { const w = el.clientWidth; if (w > 0) setWidth(w); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const PAD = { left: 46, right: 10, top: 18, bottom: 34 };

export interface BarDatum { label: string; value: number; tooltip: string; partial?: boolean }

interface BarProps {
  data: BarDatum[];
  ariaLabel: string;
  /** Short axis title, e.g. "Workouts" or "kg". */
  axisTitle: string;
  format?: (n: number) => string;
  height?: number;
}

/** Vertical bars on a zero-based axis. Zero periods stay visible as labelled gaps; hatched bars are partial periods. */
export function BarChart({ data, ariaLabel, axisTitle, format = (n) => String(n), height = 230 }: BarProps) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const hatch = useId().replace(/:/g, "");
  const w = Math.max(width, 260), innerW = w - PAD.left - PAD.right, innerH = height - PAD.top - PAD.bottom;
  const { max, step } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const slot = innerW / Math.max(1, data.length), barW = Math.min(slot * 0.68, 42);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const showLabel = new Set(labelIndexes(data.length, Math.max(2, Math.floor(innerW / 56))));
  const showValues = data.length <= 14;
  const partialPresent = data.some((d) => d.partial);

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="group" aria-label={ariaLabel} className="chart-svg">
        <defs>
          <pattern id={hatch} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--accent-soft)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="2.5" />
          </pattern>
        </defs>
        <text x={PAD.left} y={11} className="chart-axis-title">{axisTitle}</text>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.left - 7} y={y(t) + 4} textAnchor="end" className="chart-tick">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2, top = y(d.value);
          return (
            <g key={`${d.label}-${i}`} tabIndex={0} role="img" aria-label={d.tooltip} className={`chart-bar${active === i ? " is-active" : ""}`}
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
              onClick={() => setActive(i)}>
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} className="chart-hit" />
              {d.value > 0 && <rect x={cx - barW / 2} y={top} width={barW} height={PAD.top + innerH - top} rx={3} fill={d.partial ? `url(#${hatch})` : "var(--green)"} className="chart-fill" stroke={d.partial ? "var(--green)" : "none"} strokeWidth={1} />}
              {showValues && <text x={cx} y={d.value > 0 ? top - 5 : PAD.top + innerH - 5} textAnchor="middle" className="chart-value">{format(d.value)}</text>}
              {showLabel.has(i) && <text x={cx} y={height - 12} textAnchor="middle" className="chart-label">{d.label}</text>}
            </g>
          );
        })}
        <line x1={PAD.left} x2={w - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} className="chart-axis" />
      </svg>
      <p className="chart-tip" role="status" aria-live="polite">{active !== null ? data[active].tooltip : "Hover, tap or focus a bar for its exact value."}</p>
      {partialPresent && <p className="chart-note"><i className="legend-hatch" aria-hidden /> Hatched bars are partial periods: the selected range starts or ends inside them.</p>}
    </div>
  );
}

export interface LinePoint { x: string; y: number; tooltip: string }

interface LineProps {
  points: LinePoint[];
  ariaLabel: string;
  axisTitle: string;
  format?: (n: number) => string;
  xLabel: (x: string) => string;
  height?: number;
  /** Whole-number axis (reps). */
  integer?: boolean;
}

const t = (iso: string) => Date.parse(iso + "T00:00:00Z");

/** A line over real dates. The vertical axis hugs the data (it says so) so small changes stay readable. */
export function LineChart({ points, ariaLabel, axisTitle, format = (n) => String(n), xLabel, height = 230, integer = false }: LineProps) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const w = Math.max(width, 260), innerW = w - PAD.left - PAD.right, innerH = height - PAD.top - PAD.bottom;
  const ys = points.map((p) => p.y);
  const scale = lineScale(Math.min(...ys), Math.max(...ys), 4, integer);
  const span = points.length > 1 ? t(points[points.length - 1].x) - t(points[0].x) : 0;
  const px = (p: LinePoint) => PAD.left + 14 + (span === 0 ? (innerW - 28) / 2 : ((t(p.x) - t(points[0].x)) / span) * (innerW - 28));
  const py = (v: number) => PAD.top + innerH - ((v - scale.min) / (scale.max - scale.min)) * innerH;
  const ticks: number[] = [];
  for (let v = scale.min; v <= scale.max + 1e-9; v += scale.step) ticks.push(Number(v.toFixed(6)));
  const showLabel = new Set(labelIndexes(points.length, Math.max(2, Math.floor(innerW / 70))));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="group" aria-label={ariaLabel} className="chart-svg">
        <text x={PAD.left} y={11} className="chart-axis-title">{axisTitle}</text>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={w - PAD.right} y1={py(v)} y2={py(v)} className="chart-grid" />
            <text x={PAD.left - 7} y={py(v) + 4} textAnchor="end" className="chart-tick">{format(v)}</text>
          </g>
        ))}
        {points.length > 1 && <path d={path} className="chart-line" fill="none" />}
        {points.map((p, i) => (
          <g key={`${p.x}-${i}`} tabIndex={0} role="img" aria-label={p.tooltip} className={`chart-point${active === i ? " is-active" : ""}`}
            onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)}>
            <circle cx={px(p)} cy={py(p.y)} r={14} className="chart-hit" />
            <circle cx={px(p)} cy={py(p.y)} r={active === i ? 6 : 4.5} className="chart-dot" />
            {showLabel.has(i) && <text x={px(p)} y={height - 12} textAnchor="middle" className="chart-label">{xLabel(p.x)}</text>}
          </g>
        ))}
        <line x1={PAD.left} x2={w - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} className="chart-axis" />
      </svg>
      <p className="chart-tip" role="status" aria-live="polite">{active !== null ? points[active].tooltip : "Hover, tap or focus a point for its exact value."}</p>
      <p className="chart-note">
        {points.length === 1 ? "Only one training date so far, so there is no line yet. " : ""}
        {scale.min > 0 ? `The vertical axis starts at ${format(scale.min)}, not zero.` : ""}
      </p>
    </div>
  );
}

export interface ListItem { label: string; value: number; valueLabel: string; sub?: string; muted?: boolean }

/** Horizontal bars ranked by value, with the exact figure beside each. Best for names that are too long for an axis. */
export function BarList({ items, ariaLabel }: { items: ListItem[]; ariaLabel: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ul className="bar-list" aria-label={ariaLabel}>
      {items.map((i) => (
        <li key={i.label} className={i.muted ? "is-muted" : undefined}>
          <span className="bl-top"><b>{i.label}</b><span className="bl-val">{i.valueLabel}</span></span>
          <span className="bl-track" aria-hidden><span className="bl-fill" style={{ width: `${max > 0 ? Math.max(i.value > 0 ? 2 : 0, (i.value / max) * 100) : 0}%` }} /></span>
          {i.sub && <small>{i.sub}</small>}
        </li>
      ))}
    </ul>
  );
}

/** The exact numbers behind a chart, for screen readers and for anyone who prefers to read them. */
export function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <details className="chart-data">
      <summary>View as a table</summary>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
