import { useEffect, useId, useRef, useState } from "react";
import type { Parsed } from "./units";

/** A value is saved this long after the last keystroke, and only if what is typed is valid at that moment. */
export const COMMIT_IDLE_MS = 500;

interface Props {
  label: string;
  value: number | null;
  toText: (value: number | null) => string;
  parse: (text: string) => Parsed;
  /** Called only when the user changed the value to something valid. */
  onCommit: (value: number | null, immediate: boolean) => void;
  inputMode?: "numeric" | "decimal";
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Visible caption above the input; otherwise the label is only for assistive technology. */
  showLabel?: boolean;
  maxLength?: number;
  /** Told when text has been typed but not yet saved (so the screen can show Saving… and warn before leaving). */
  onTyping?: (typing: boolean) => void;
}

/**
 * A numeric input that keeps what the user is typing until they leave it and converts it only when valid.
 *
 * A value counts as *edited* only if the text differs from what was on screen when the field got focus. Merely
 * tabbing through a field, or retyping exactly what it showed, never reports a change, so a stored 10.093 kg
 * displayed as "22.25 lb" cannot be rewritten as 10.092 kg by viewing it. Restoring the original text restores
 * the exact original stored value rather than a reconverted one.
 */
export default function NumberField({
  label, value, toText, parse, onCommit, inputMode = "decimal", unit, placeholder, disabled, showLabel = false, maxLength = 9, onTyping,
}: Props) {
  const id = useId();
  const [text, setText] = useState(() => toText(value));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const touched = useRef(false);
  const focusText = useRef("");
  const original = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const typing = useRef(false);
  const setTyping = (on: boolean) => { if (typing.current !== on) { typing.current = on; onTyping?.(on); } };
  const cancelTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } setTyping(false); };

  // Follow the stored value (after a save or a reload) unless the user is in the middle of typing.
  useEffect(() => {
    if (!focused.current) { setText(toText(value)); setError(null); }
  }, [value, toText]);

  /** Decide what, if anything, to save for the text as it stands now. Called after a typing pause and on blur. */
  const settle = (next: string, immediate: boolean) => {
    const parsed = parse(next);
    if (!parsed.ok) return;                                  // never save a half-typed or invalid value
    if (next === focusText.current) {                        // back to what it was: put the exact original value back
      touched.current = false;
      if (latest.current !== original.current) onCommit(original.current, immediate);
      return;
    }
    touched.current = true;
    if (parsed.value !== latest.current) onCommit(parsed.value, immediate);
  };

  // Text typed in the last moments is saved if the tab is hidden or the screen is left, never silently dropped.
  const flush = useRef<() => void>(() => undefined);
  flush.current = () => { if (timer.current) { const t = textRef.current; cancelTimer(); settle(t, true); } };
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush.current(); };
    const onPageHide = () => flush.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onPageHide); flush.current(); };
  }, []);

  const change = (next: string) => {
    setText(next);
    cancelTimer();
    const parsed = parse(next);
    setError(parsed.ok ? null : parsed.message);
    if (parsed.ok) {
      timer.current = setTimeout(() => { timer.current = null; setTyping(false); settle(next, true); }, COMMIT_IDLE_MS);
      setTyping(true);
    }
  };

  return (
    <div className={`num-field${error ? " has-error" : ""}`}>
      <label htmlFor={id} className={showLabel ? "num-label" : "sr-only"}>{label}</label>
      <div className="num-wrap">
        <input
          id={id} type="text" inputMode={inputMode} enterKeyHint="done" autoComplete="off" autoCorrect="off" maxLength={maxLength}
          value={text} placeholder={placeholder} disabled={disabled} aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onFocus={(e) => {
            focused.current = true;
            touched.current = false;
            focusText.current = e.currentTarget.value;
            original.current = latest.current;
            const el = e.currentTarget;
            // Once the on-screen keyboard has opened, make sure the field is still in view.
            setTimeout(() => el.scrollIntoView?.({ block: "center", behavior: "smooth" }), 320);
          }}
          onChange={(e) => change(e.target.value)}
          onBlur={(e) => {
            focused.current = false;
            cancelTimer();
            const next = e.target.value;
            const parsed = parse(next);
            if (!parsed.ok) { touched.current = false; return; }          // leave the text and its error; nothing was saved
            settle(next, true);                                            // leaving a field saves it now
            if (touched.current) setText(toText(parsed.value));
            else setText(focusText.current);
            touched.current = false;
          }}
        />
        {unit && <span className="num-unit" aria-hidden>{unit}</span>}
      </div>
      {error && <span className="num-error" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  );
}
