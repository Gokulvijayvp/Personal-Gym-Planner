import { useEffect, useState } from "react";
import { motionFor, type N, type Pt, type Shape } from "./exerciseMotions";

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

const first = (n: N) => (Array.isArray(n) ? n[0] : n);

/** One SVG attribute: fixed, or looping start -> peak -> start. A still icon (reduced motion) shows the start. */
function Attr({ name, value, seconds, still }: { name: string; value: N; seconds: number; still: boolean }) {
  if (!Array.isArray(value) || still) return null;
  return (
    <animate attributeName={name} values={`${value[0]};${value[1]};${value[0]}`} dur={`${seconds}s`}
      repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
  );
}

function pointAttrs(p: Pt, xName: string, yName: string, seconds: number, still: boolean) {
  return {
    [xName]: first(p[0]), [yName]: first(p[1]),
    kids: [
      <Attr key={xName} name={xName} value={p[0]} seconds={seconds} still={still} />,
      <Attr key={yName} name={yName} value={p[1]} seconds={seconds} still={still} />,
    ],
  };
}

function Part({ shape, seconds, still }: { shape: Shape; seconds: number; still: boolean }) {
  if (shape.t === "dot") {
    const c = pointAttrs(shape.c, "cx", "cy", seconds, still);
    return (
      <circle cx={c.cx as number} cy={c.cy as number} r={shape.r} className={shape.solid ? "xi-solid" : "xi-head"}>
        {c.kids}
      </circle>
    );
  }
  const a = pointAttrs(shape.a, "x1", "y1", seconds, still);
  const b = pointAttrs(shape.b, "x2", "y2", seconds, still);
  return (
    <line x1={a.x1 as number} y1={a.y1 as number} x2={b.x2 as number} y2={b.y2 as number}
      className={shape.faint ? "xi-ground" : "xi-line"} strokeWidth={shape.w}>
      {a.kids}{b.kids}
    </line>
  );
}

interface Props {
  /** One of the motion keys from the exercise masters (press, curl, squat ...). Unknown keys draw a weight. */
  motion: string | null | undefined;
  size?: number;
  /** Screen-reader text. Leave out when the exercise name is already shown next to the icon. */
  label?: string;
  className?: string;
}

/** An animated stick figure doing the exercise's movement. Drawn in the browser: nothing to download. */
export default function ExerciseIcon({ motion, size = 56, label, className }: Props) {
  const still = usePrefersReducedMotion();
  const m = motionFor(motion);
  return (
    <svg className={className ? `exercise-icon ${className}` : "exercise-icon"} width={size} height={size}
      viewBox="0 0 100 100" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      focusable="false" data-motion={motion ?? "generic"} data-still={still ? "true" : undefined}>
      {m.shapes.map((s, i) => <Part key={i} shape={s} seconds={m.seconds} still={still} />)}
    </svg>
  );
}
