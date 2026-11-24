import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { MuscleGroup, WorkoutType } from "../../types/exercise";
import { areaBelongsToGroup, targetAreaOptions, type ExerciseFilters, type StatusFilter } from "./exerciseFilters";

interface Props {
  filters: ExerciseFilters;
  /** Live text of the search box (debounced into `filters.search` by the page). */
  searchText: string;
  onSearchText: (text: string) => void;
  onChange: (patch: Partial<ExerciseFilters>) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  muscleGroups: MuscleGroup[];
  workoutTypes: WorkoutType[];
}

export default function ExerciseFiltersBar({
  filters, searchText, onSearchText, onChange, onClear, hasActiveFilters, muscleGroups, workoutTypes,
}: Props) {
  const areaGroups = targetAreaOptions(muscleGroups, filters.muscleGroupId);
  const [open, setOpen] = useState(false);           // phones: the dropdowns sit behind a Filters button
  const narrowed = [filters.muscleGroupId, filters.targetAreaId, filters.workoutTypeId].filter(Boolean).length + (filters.status !== "all" ? 1 : 0);

  return (
    <section className="panel filters" aria-label="Search and filters">
      <div className="search-box">
        <Search size={17} aria-hidden />
        <input
          type="search" value={searchText} placeholder="Search exercises by name…" aria-label="Search exercises"
          maxLength={100} onChange={(e) => onSearchText(e.target.value)}
        />
        {searchText && (
          <button type="button" className="icon-btn icon-btn-plain" aria-label="Clear search" onClick={() => onSearchText("")}>
            <X size={15} />
          </button>
        )}
      </div>

      <button type="button" className={narrowed ? "cat-filter-btn has-active" : "cat-filter-btn"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={16} aria-hidden /> Filters{narrowed > 0 && <span className="cat-filter-n">{narrowed}</span>}
      </button>

      <div className={open ? "filters-more is-open" : "filters-more"}>
      <label className="select-field">
        <span>Muscle group</span>
        <select
          value={filters.muscleGroupId}
          onChange={(e) => {
            const muscleGroupId = e.target.value;
            // Keep the chosen target area only if it still belongs to the newly chosen muscle group.
            const keep = muscleGroupId === "" || areaBelongsToGroup(muscleGroups, filters.targetAreaId, muscleGroupId);
            onChange({ muscleGroupId, targetAreaId: keep ? filters.targetAreaId : "" });
          }}
        >
          <option value="">All muscle groups</option>
          {muscleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>

      <label className="select-field">
        <span>Target area</span>
        <select value={filters.targetAreaId} onChange={(e) => onChange({ targetAreaId: e.target.value })}>
          <option value="">All target areas</option>
          {filters.muscleGroupId
            ? areaGroups.flatMap((g) => g.areas).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)
            : areaGroups.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            ))}
        </select>
      </label>

      <label className="select-field">
        <span>Workout type</span>
        <select value={filters.workoutTypeId} onChange={(e) => onChange({ workoutTypeId: e.target.value })}>
          <option value="">All types</option>
          {workoutTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      <label className="select-field">
        <span>Status</span>
        <select value={filters.status} onChange={(e) => onChange({ status: e.target.value as StatusFilter })}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>

      {hasActiveFilters && (
        <button type="button" className="btn btn-ghost clear-filters" onClick={onClear}>
          <X size={15} /> Clear filters
        </button>
      )}
      </div>
    </section>
  );
}
