import type { ExerciseListQuery, MuscleGroup, TargetArea } from "../../types/exercise";

export const PAGE_SIZE = 12;

export type SortKey = "name_asc" | "name_desc" | "newest" | "updated";
export type StatusFilter = "all" | "active" | "inactive";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "name_desc", label: "Name (Z–A)" },
  { value: "newest", label: "Newest first" },
  { value: "updated", label: "Recently updated" },
];

/** Filter state. IDs are kept as strings because they come from <select>/URL; "" = no filter. */
export interface ExerciseFilters {
  search: string;
  muscleGroupId: string;
  targetAreaId: string;
  workoutTypeId: string;
  status: StatusFilter;
  sort: SortKey;
  page: number;
}

export const DEFAULT_FILTERS: ExerciseFilters = {
  search: "", muscleGroupId: "", targetAreaId: "", workoutTypeId: "", status: "all", sort: "name_asc", page: 1,
};

const isId = (v: string | null): v is string => v !== null && /^[1-9]\d*$/.test(v);

/** URL -> filters. Anything malformed falls back to the default, so a hand-edited URL can't break the page. */
export function parseFilters(params: URLSearchParams): ExerciseFilters {
  const status = params.get("status");
  const sort = params.get("sort");
  const page = Number(params.get("page"));
  return {
    search: (params.get("q") ?? "").slice(0, 100),
    muscleGroupId: isId(params.get("muscle")) ? params.get("muscle")! : "",
    targetAreaId: isId(params.get("area")) ? params.get("area")! : "",
    workoutTypeId: isId(params.get("type")) ? params.get("type")! : "",
    status: status === "active" || status === "inactive" ? status : "all",
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? (sort as SortKey) : "name_asc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** filters -> URL (defaults omitted so the address stays clean). */
export function serializeFilters(f: ExerciseFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search) p.set("q", f.search);
  if (f.muscleGroupId) p.set("muscle", f.muscleGroupId);
  if (f.targetAreaId) p.set("area", f.targetAreaId);
  if (f.workoutTypeId) p.set("type", f.workoutTypeId);
  if (f.status !== "all") p.set("status", f.status);
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

/** Number of narrowing filters in use (sort and page don't count). */
export function activeFilterCount(f: ExerciseFilters): number {
  return [f.search, f.muscleGroupId, f.targetAreaId, f.workoutTypeId, f.status !== "all" ? "x" : ""]
    .filter(Boolean).length;
}

const SORTS: Record<SortKey, Pick<ExerciseListQuery, "sort" | "order">> = {
  name_asc: { sort: "name", order: "asc" },
  name_desc: { sort: "name", order: "desc" },
  newest: { sort: "created_at", order: "desc" },
  updated: { sort: "updated_at", order: "desc" },
};

/** filters -> API query. */
export function toListQuery(f: ExerciseFilters): ExerciseListQuery {
  return {
    search: f.search.trim() || undefined,
    muscle_group_id: f.muscleGroupId ? Number(f.muscleGroupId) : undefined,
    target_area_id: f.targetAreaId ? Number(f.targetAreaId) : undefined,
    workout_type_id: f.workoutTypeId ? Number(f.workoutTypeId) : undefined,
    is_active: f.status === "all" ? undefined : f.status === "active",
    ...SORTS[f.sort],
    page: f.page,
    page_size: PAGE_SIZE,
  };
}

export interface TargetAreaGroup { group: string; areas: TargetArea[] }

/**
 * Target areas that may be offered for a selected primary muscle group.
 *  - a muscle group is selected  -> only that group's areas (never irrelevant ones)
 *  - none selected (filters only) -> every area, grouped by muscle group
 */
export function targetAreaOptions(groups: MuscleGroup[], muscleGroupId: string | number | ""): TargetAreaGroup[] {
  const selected = muscleGroupId === "" ? null : Number(muscleGroupId);
  return groups
    .filter((g) => (selected === null ? true : g.id === selected) && g.target_areas.length > 0)
    .map((g) => ({ group: g.name, areas: g.target_areas }));
}

/** True when the target area belongs to the muscle group (used to keep or clear a selection). */
export function areaBelongsToGroup(groups: MuscleGroup[], targetAreaId: string, muscleGroupId: string): boolean {
  if (!targetAreaId || !muscleGroupId) return false;
  return targetAreaOptions(groups, muscleGroupId).some((g) => g.areas.some((a) => String(a.id) === targetAreaId));
}
