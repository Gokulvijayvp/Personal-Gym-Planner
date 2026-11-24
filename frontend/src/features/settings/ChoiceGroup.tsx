import { useId } from "react";

interface Option<T extends string> { value: T; label: string; hint?: string }

interface Props<T extends string> {
  legend: string;
  name: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  help?: string;
}

/** Radio buttons styled as large tap-friendly chips (native radios, so keyboard and screen readers just work). */
export default function ChoiceGroup<T extends string>({ legend, name, value, options, onChange, disabled, help }: Props<T>) {
  const helpId = useId();
  return (
    <fieldset className="field choice-field" disabled={disabled} aria-describedby={help ? helpId : undefined}>
      <legend>{legend}</legend>
      <div className="choice-group">
        {options.map((o) => (
          <label key={o.value} className={o.value === value ? "choice is-checked" : "choice"}>
            <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span className="choice-label">{o.label}</span>
            {o.hint && <small>{o.hint}</small>}
          </label>
        ))}
      </div>
      {help && <span className="hint" id={helpId}>{help}</span>}
    </fieldset>
  );
}
