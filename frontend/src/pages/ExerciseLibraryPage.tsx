import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Library, Plus, SearchX } from "lucide-react";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import Pagination from "../components/ui/Pagination";
import { useToast } from "../components/ui/Toast";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { getErrorMessage } from "../services/apiError";
import { exerciseService } from "../services/exerciseService";
import type { Exercise, ExerciseListResponse } from "../types/exercise";
import DeleteExerciseDialog from "../features/exercises/DeleteExerciseDialog";
import ExerciseCard from "../features/exercises/ExerciseCard";
import ExerciseFiltersBar from "../features/exercises/ExerciseFiltersBar";
import CataloguePicker from "../features/exercises/CataloguePicker";
import ExerciseFormModal from "../features/exercises/ExerciseFormModal";
import ExerciseListSkeleton from "../features/exercises/ExerciseListSkeleton";
import {
  SORT_OPTIONS, activeFilterCount, parseFilters, serializeFilters, toListQuery,
  type ExerciseFilters, type SortKey,
} from "../features/exercises/exerciseFilters";
import { useMasterData } from "../features/exercises/useMasterData";

type FormState = null | { mode: "catalogue" } | { mode: "create" } | { mode: "edit"; exercise: Exercise };

/** `embedded`: shown inside the Exercises tab, which supplies the page header; keeps `?view=library` in the URL. */
export default function ExerciseLibraryPage({ embedded = false }: { embedded?: boolean } = {}) {
  const master = useMasterData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);

  // ---- search box: typing is debounced into the URL --------------------------------------
  const [searchText, setSearchText] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const lastPushedSearch = useRef(filters.search);

  const update = useCallback((patch: Partial<ExerciseFilters>, replace = false) => {
    setParams((prev) => {
      const next = { ...parseFilters(prev), ...patch };
      if (!("page" in patch)) next.page = 1; // any filter change starts again from page 1
      const sp = serializeFilters(next);
      if (embedded) sp.set("view", "library");
      return sp;
    }, { replace });
  }, [setParams]);

  useEffect(() => {
    const term = debouncedSearch.trim();
    if (term !== filters.search) { lastPushedSearch.current = term; update({ search: term }, true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debouncedSearch]);

  useEffect(() => { // URL changed from outside (back button / link): mirror it into the box
    if (filters.search !== lastPushedSearch.current) { lastPushedSearch.current = filters.search; setSearchText(filters.search); }
  }, [filters.search]);

  const clearFilters = () => {
    lastPushedSearch.current = "";
    setSearchText("");
    setParams(embedded ? new URLSearchParams({ view: "library" }) : new URLSearchParams());
  };

  // ---- data -----------------------------------------------------------------------------
  const [data, setData] = useState<ExerciseListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const queryKey = JSON.stringify(toListQuery(filters));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    exerciseService.list(JSON.parse(queryKey), controller.signal)
      .then((res) => {
        if (res.items.length === 0 && res.total > 0 && res.page > res.pages) { // e.g. deleted the last item on a page
          update({ page: res.pages }, true);
          return;
        }
        setData(res); setError(null); setLoading(false);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(getErrorMessage(e)); setLoading(false);
      });
    return () => controller.abort();
  }, [queryKey, reloadToken, update]);

  // ---- actions --------------------------------------------------------------------------
  const [form, setForm] = useState<FormState>(null);
  const [deleting, setDeleting] = useState<Exercise | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function toggleActive(exercise: Exercise) {
    setBusyId(exercise.id);
    try {
      await exerciseService.setActive(exercise.id, !exercise.is_active);
      toast.success(`"${exercise.name}" ${exercise.is_active ? "deactivated" : "activated"}.`);
      reload();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const hasActiveFilters = activeFilterCount(filters) > 0;
  const ready = master.status === "ready";

  const pageFrom = data ? (data.page - 1) * data.page_size + 1 : 0;
  const pageTo = data ? pageFrom + data.items.length - 1 : 0;

  return (
    <>
      {embedded ? (
        <div className="lib-bar"><div className="header-actions">
          {data && (
            <span className="count-pill" data-testid="total-count">
              {data.total_all} {data.total_all === 1 ? "exercise" : "exercises"}
            </span>
          )}
          <button type="button" className="btn" disabled={!ready} onClick={() => setForm({ mode: "catalogue" })}>
            <Plus size={17} /> Add Exercise
          </button>
        </div></div>
      ) : (
      <PageHeader eyebrow="LIBRARY" title="Exercise Library"
        description="Build and manage the exercises you can use in your workout plans.">
        <div className="header-actions">
          {data && (
            <span className="count-pill" data-testid="total-count">
              {data.total_all} {data.total_all === 1 ? "exercise" : "exercises"}
            </span>
          )}
          <button type="button" className="btn" disabled={!ready} onClick={() => setForm({ mode: "catalogue" })}>
            <Plus size={17} /> Add Exercise
          </button>
        </div>
      </PageHeader>
      )}

      {master.status === "error" && (
        <section className="panel page-empty">
          <ErrorState title="Couldn't load muscle groups and workout types" message={master.message} onRetry={master.reload} />
        </section>
      )}

      {ready && (
        <ExerciseFiltersBar
          filters={filters} searchText={searchText} onSearchText={setSearchText} onChange={(p) => update(p)}
          onClear={clearFilters} hasActiveFilters={hasActiveFilters}
          muscleGroups={master.muscleGroups} workoutTypes={master.workoutTypes}
        />
      )}

      {master.status !== "error" && (
        <>
          {data && data.total > 0 && !error && (
            <div className="list-toolbar">
              <span data-testid="result-summary">
                {hasActiveFilters ? `Showing ${data.total} of ${data.total_all} exercises` : `Showing ${pageFrom}–${pageTo} of ${data.total}`}
              </span>
              <label className="select-field inline">
                <span>Sort by</span>
                <select value={filters.sort} onChange={(e) => update({ sort: e.target.value as SortKey })}>
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
          )}

          {error ? (
            <section className="panel page-empty">
              <ErrorState title="Couldn't load exercises" message={error} onRetry={reload} />
            </section>
          ) : !data ? (
            <ExerciseListSkeleton />
          ) : data.total_all === 0 ? (
            <section className="panel page-empty">
              <EmptyState Icon={Library} title="No exercises yet"
                description="Your library is empty. Add your first exercise to start building workouts.">
                <button type="button" className="btn" disabled={!ready} onClick={() => setForm({ mode: "catalogue" })}>
                  <Plus size={17} /> Add your first exercise
                </button>
              </EmptyState>
            </section>
          ) : data.total === 0 ? (
            <section className="panel page-empty">
              <EmptyState Icon={SearchX} title="No matching exercises"
                description={filters.search ? `Nothing matches “${filters.search}” with the current filters.` : "No exercises match the current filters."}>
                <button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>
              </EmptyState>
            </section>
          ) : (
            <>
              <div className={loading ? "ex-grid is-refreshing" : "ex-grid"} aria-busy={loading} data-testid="exercise-grid">
                {data.items.map((ex) => (
                  <ExerciseCard key={ex.id} exercise={ex} busy={busyId === ex.id}
                    onEdit={(e) => setForm({ mode: "edit", exercise: e })}
                    onDelete={setDeleting} onToggleActive={toggleActive} />
                ))}
              </div>
              <Pagination page={data.page} pages={data.pages} disabled={loading} onChange={(page) => update({ page })} />
            </>
          )}
        </>
      )}

      {form?.mode === "catalogue" && ready && (
        <CataloguePicker
          onClose={(changed) => { setForm(null); if (changed) reload(); }}
          onCreateCustom={(changed) => { if (changed) reload(); setForm({ mode: "create" }); }} />
      )}

      {(form?.mode === "create" || form?.mode === "edit") && ready && (
        <ExerciseFormModal
          exercise={form.mode === "edit" ? form.exercise : undefined}
          muscleGroups={master.muscleGroups} workoutTypes={master.workoutTypes}
          onClose={() => setForm(null)}
          onSaved={(saved, mode) => {
            setForm(null);
            toast.success(`"${saved.name}" was ${mode === "created" ? "added to" : "updated in"} your library.`);
            reload();
          }}
        />
      )}

      {deleting && (
        <DeleteExerciseDialog
          exercise={deleting} onClose={() => setDeleting(null)}
          onDeleted={(e) => { setDeleting(null); toast.success(`"${e.name}" was deleted.`); reload(); }}
          onDeactivated={(e) => { setDeleting(null); toast.success(`"${e.name}" was deactivated instead.`); reload(); }}
        />
      )}
    </>
  );
}
