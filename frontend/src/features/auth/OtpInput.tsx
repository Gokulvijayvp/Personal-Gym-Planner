import { useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { OTP_LENGTH } from "./authLogic";

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/** Six single-digit boxes: typing moves forward, Backspace moves back, a pasted code fills them all. */
export default function OtpInput({ value, onChange, disabled, invalid, describedBy }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? "");
  const focus = (i: number) => refs.current[Math.max(0, Math.min(OTP_LENGTH - 1, i))]?.focus();

  function setAt(i: number, chars: string) {
    const next = digits.slice();
    chars.split("").forEach((c, k) => { if (i + k < OTP_LENGTH) next[i + k] = c; });
    onChange(next.join("").slice(0, OTP_LENGTH));
    focus(i + chars.length);
  }

  function handleChange(i: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (!clean) onChange(digits.map((d, k) => (k === i ? "" : d)).join(""));
    else setAt(i, clean);
  }

  function handleKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i]) onChange(digits.map((d, k) => (k === i ? "" : d)).join(""));
      else if (i > 0) { onChange(digits.map((d, k) => (k === i - 1 ? "" : d)).join("")); focus(i - 1); }
    } else if (e.key === "ArrowLeft") { e.preventDefault(); focus(i - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); focus(i + 1); }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!text) return;
    e.preventDefault();
    onChange(text);
    focus(text.length >= OTP_LENGTH ? OTP_LENGTH - 1 : text.length);
  }

  return (
    <div className="otp" role="group" aria-label="6-digit verification code">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} className={invalid ? "otp-box is-bad" : "otp-box"}
          type="text" inputMode="numeric" pattern="[0-9]*" maxLength={OTP_LENGTH} autoComplete={i === 0 ? "one-time-code" : "off"}
          value={d} disabled={disabled} aria-label={`Digit ${i + 1}`} aria-invalid={invalid || undefined} aria-describedby={describedBy}
          autoFocus={i === 0}
          onChange={(e) => handleChange(i, e.target.value)} onKeyDown={(e) => handleKey(i, e)} onPaste={handlePaste}
          onFocus={(e) => e.target.select()} />
      ))}
    </div>
  );
}
