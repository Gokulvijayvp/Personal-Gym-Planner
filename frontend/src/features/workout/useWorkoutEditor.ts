import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { workoutService } from "../../services/workoutService";
import type { CardioPatch, ExercisePatch, SetPatch, WorkoutSession } from "../../types/workout";
import { useToast } from "../../components/ui/Toast";

/** Typing is saved this long after the last keystroke (or at once on blur / a tap on a button). */
export const SAVE_DELAY_MS = 600;
/** One automatic retry for a network hiccup before the problem is shown to the user. */
export const RETRY_DELAY_MS = 700;

export type SaveState = "idle" | "saving" | "saved" | "error";
type Kind = "set" | "exercise" | "cardio";
type Fields = Record<string, unknown>;
interface Op { run: () => Promise<WorkoutSession>; entity?: string; rev?: number }
interface Pending { kind: Kind; id: number; fields: Fields; rev: number; timer: ReturnType<typeof setTimeout> | null }

const retryable = (e: unknown) => e instanceof ApiError && (e.kind === "network" || e.kind === "server");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The workout screen's data layer.
 *
 * - The server is the source of truth: every mutation returns the whole session, which replaces local state.
 * - What the user typed is shown at once (an "overlay") and kept until the server confirms it, so a slow or
 *   failed save never makes a value flicker back.
 * - All requests run one after another in a single queue, so edits can never overtake each other.
 * - "Saved" is only claimed when the queue is empty and the last response was a success.
 */
export function useWorkoutEditor(sessionId: number) {
  const toast = useToast();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Record<string, Fields>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [typingCount, setTypingCount] = useState(0);

  const queue = useRef<Op[]>([]);
  const running = useRef(false);
  const failed = useRef(false);
  const pending = useRef(new Map<string, Pending>());
  const revs = useRef(new Map<string, number>());
  const waiters = useRef<((ok: boolean) => void)[]>([]);
  const mounted = useRef(true);

  const accept = useCallback((s: WorkoutSession) => { setSession(s); setReceivedAt(Date.now()); }, []);

  // ---- load / resume --------------------------------------------------------------------------------
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setLoadError(null);
    workoutService.get(sessionId, controller.signal)
      .then(accept)
      .catch((e: unknown) => { if (!controller.signal.aborted) setLoadError(getErrorMessage(e)); });
    return () => { controller.abort(); };
  }, [sessionId, attempt, accept]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // ---- the queue -----------------------------------------------------------------------------------------
  const settle = useCallback((ok: boolean) => {
    const list = waiters.current; waiters.current = [];
    list.forEach((w) => w(ok));
  }, []);

  const clearOverlay = useCallback((entity: string, uptoRev?: number) => {
    if (uptoRev !== undefined && (revs.current.get(entity) ?? 0) > uptoRev) return; // newer edits are still on their way
    setOverlay((o) => { if (!(entity in o)) return o; const { [entity]: _gone, ...rest } = o; return rest; });
  }, []);

  const resync = useCallback(async () => {
    try { accept(await workoutService.get(sessionId)); } catch { /* the next action will surface the problem */ }
  }, [sessionId, accept]);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    failed.current = false;
    setSaveState("saving");
    setSaveError(null);
    while (queue.current.length > 0) {
      const op = queue.current[0];
      try {
        let result: WorkoutSession;
        try { result = await op.run(); }
        catch (e) { if (!retryable(e)) throw e; await sleep(RETRY_DELAY_MS); result = await op.run(); }
        queue.current.shift();
        if (mounted.current) { accept(result); }
        if (op.entity) clearOverlay(op.entity, op.rev);
      } catch (e) {
        if (retryable(e)) {                                   // keep the change and let the user retry
          failed.current = true;
          running.current = false;
          if (mounted.current) { setSaveState("error"); setSaveError(getErrorMessage(e)); }
          settle(false);
          return;
        }
        queue.current.shift();                                // the server refused it: drop it and show the truth
        if (op.entity) clearOverlay(op.entity);
        if (mounted.current) toast.error(getErrorMessage(e));
        await resync();
      }
    }
    running.current = false;
    const stillPending = [...pending.current.values()].length > 0;
    if (mounted.current) setSaveState(stillPending ? "saving" : "saved");
    settle(true);
  }, [accept, clearOverlay, resync, settle, toast]);

  const enqueue = useCallback((op: Op) => { queue.current.push(op); void pump(); }, [pump]);

  const flushEntity = useCallback((key: string) => {
    const p = pending.current.get(key);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    pending.current.delete(key);
    const { kind, id, fields, rev } = p;
    const run = () => kind === "set" ? workoutService.updateSet(sessionId, id, fields as SetPatch)
      : kind === "exercise" ? workoutService.updateExercise(sessionId, id, fields as ExercisePatch)
        : workoutService.updateCardio(sessionId, id, fields as CardioPatch);
    enqueue({ run, entity: key, rev });
  }, [enqueue, sessionId]);

  const flushAll = useCallback(() => { [...pending.current.keys()].forEach(flushEntity); }, [flushEntity]);

  /** Show a value now and save it shortly (immediately for taps and blur). */
  const edit = useCallback((kind: Kind, id: number, patch: Fields, immediate = false) => {
    const key = `${kind}:${id}`;
    const rev = (revs.current.get(key) ?? 0) + 1;
    revs.current.set(key, rev);
    const existing = pending.current.get(key);
    if (existing?.timer) clearTimeout(existing.timer);
    const entry: Pending = { kind, id, fields: { ...(existing?.fields ?? {}), ...patch }, rev, timer: null };
    pending.current.set(key, entry);
    setOverlay((o) => ({ ...o, [key]: { ...(o[key] ?? {}), ...patch } }));
    setSaveState("saving");
    if (immediate) flushEntity(key);
    else entry.timer = setTimeout(() => flushEntity(key), SAVE_DELAY_MS);
  }, [flushEntity]);

  /** Structural changes (add / remove / reorder). Pending edits are sent first so order is preserved. */
  const run = useCallback((fn: () => Promise<WorkoutSession>) => { flushAll(); enqueue({ run: fn }); }, [enqueue, flushAll]);

  /** Resolves true when everything typed so far is confirmed by the server, false if saving is stuck. */
  const drain = useCallback((): Promise<boolean> => {
    flushAll();
    if (!running.current && queue.current.length === 0) return Promise.resolve(!failed.current);
    if (!running.current) void pump();
    return new Promise((resolve) => { waiters.current.push(resolve); });
  }, [flushAll, pump]);

  const retry = useCallback(() => { failed.current = false; void pump(); }, [pump]);

  // ---- finishing --------------------------------------------------------------------------------------------
  const finish = useCallback(async (kind: "complete" | "cancel", text: string | null): Promise<string | null> => {
    setFinishing(true);
    try {
      if (!(await drain())) return "Some changes haven't been saved yet. Retry saving, then finish the workout.";
      const result = kind === "complete" ? await workoutService.complete(sessionId, text) : await workoutService.cancel(sessionId, text);
      accept(result);
      setOverlay({});
      setSaveState("idle");
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.code === "session_locked") void resync();
      return getErrorMessage(e);
    } finally {
      setFinishing(false);
    }
  }, [accept, drain, resync, sessionId]);

  // ---- never lose typed values ------------------------------------------------------------------------------
  /** Text typed but not yet handed to the queue also counts as unsaved. */
  const typing = useCallback((on: boolean) => setTypingCount((n) => Math.max(0, n + (on ? 1 : -1))), []);
  const shownState: SaveState = typingCount > 0 && (saveState === "idle" || saveState === "saved") ? "saving" : saveState;
  const unsaved = shownState === "saving" || shownState === "error";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { flushAll(); e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, flushAll]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushAll(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushAll);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", flushAll); };
  }, [flushAll]);

  useEffect(() => () => { mounted.current = false; flushAll(); }, [flushAll]);

  // ---- what the screen renders: the server's data with the user's unconfirmed edits on top -------------------
  const view = useMemo<WorkoutSession | null>(() => {
    if (!session) return null;
    if (Object.keys(overlay).length === 0) return session;
    return {
      ...session,
      exercises: session.exercises.map((e) => ({
        ...e, ...(overlay[`exercise:${e.id}`] ?? {}),
        sets: e.sets.map((s) => ({ ...s, ...(overlay[`set:${s.id}`] ?? {}) })),
      })),
      cardio: session.cardio.map((c) => ({ ...c, ...(overlay[`cardio:${c.id}`] ?? {}) })),
    };
  }, [session, overlay]);

  return { session: view, receivedAt, loadError, reload, saveState: shownState, saveError, typing, finishing, edit, run, drain, retry, finish };
}
