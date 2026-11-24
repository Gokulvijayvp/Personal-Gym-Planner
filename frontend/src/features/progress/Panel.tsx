import type { ReactNode } from "react";
import ErrorState from "../../components/ui/ErrorState";
import type { AsyncState } from "./useAsync";

/** Loading / error / content for one analytics panel. Errors name the problem and offer a retry. */
export default function Panel<T>({ state, label, children }: { state: AsyncState<T>; label: string; children: (data: T) => ReactNode }) {
  if (state.error && !state.data) return <ErrorState title={`Couldn't load ${label}`} message={state.error} onRetry={state.reload} />;
  if (!state.data) return <div className="skeleton progress-skeleton" role="status" aria-label={`Loading ${label}`} aria-busy="true" />;
  return (
    <div className={state.loading ? "panel-body is-refreshing" : "panel-body"} aria-busy={state.loading}>
      {state.error && <p className="form-alert" role="alert">{state.error}</p>}
      {children(state.data)}
    </div>
  );
}

export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="home-empty progress-empty" data-testid="progress-empty">
      <b>{title}</b>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function Stat({ label, value, note, testId }: { label: string; value: ReactNode; note?: string; testId?: string }) {
  return (
    <article className="stat prog-stat" data-testid={testId}>
      <span>{label}</span>
      <b>{value}</b>
      {note && <small>{note}</small>}
    </article>
  );
}
