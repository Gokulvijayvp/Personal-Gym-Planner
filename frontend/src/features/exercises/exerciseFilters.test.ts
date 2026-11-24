import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS, PAGE_SIZE, activeFilterCount, areaBelongsToGroup, parseFilters, serializeFilters,
  targetAreaOptions, toListQuery,
} from "./exerciseFilters";
import { MUSCLE_GROUPS } from "./testData";

describe("target area options depend on the muscle group", () => {
  it("shows ONLY the selected group's areas", () => {
    const chest = targetAreaOptions(MUSCLE_GROUPS, 1);
    expect(chest).toHaveLength(1);
    expect(chest[0].group).toBe("Chest");
    expect(chest[0].areas.map((a) => a.name)).toEqual(["Upper Chest", "Middle Chest", "Lower Chest", "Inner Chest"]);
    const names = (id: number) => targetAreaOptions(MUSCLE_GROUPS, id).flatMap((g) => g.areas.map((a) => a.name));
    expect(names(2)).toEqual(["Upper Back", "Lats"]);
    expect(names(3)).toEqual(["Front Delts", "Side Delts"]);
    expect(names(1)).not.toContain("Lats");
  });

  it("accepts string ids (as they come from <select>)", () => {
    expect(targetAreaOptions(MUSCLE_GROUPS, "2")[0].group).toBe("Back");
  });

  it("with no muscle group (filters only) lists every area, grouped", () => {
    const all = targetAreaOptions(MUSCLE_GROUPS, "");
    expect(all.map((g) => g.group)).toEqual(["Chest", "Back", "Shoulders", "Biceps", "Triceps"]);
  });

  it("unknown group -> no options", () => {
    expect(targetAreaOptions(MUSCLE_GROUPS, 999)).toEqual([]);
  });

  it("areaBelongsToGroup", () => {
    expect(areaBelongsToGroup(MUSCLE_GROUPS, "8", "2")).toBe(true);   // Lats in Back
    expect(areaBelongsToGroup(MUSCLE_GROUPS, "8", "1")).toBe(false);  // Lats not in Chest
    expect(areaBelongsToGroup(MUSCLE_GROUPS, "", "1")).toBe(false);
    expect(areaBelongsToGroup(MUSCLE_GROUPS, "8", "")).toBe(false);
  });
});

describe("filters <-> URL", () => {
  it("defaults when the URL is empty", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it("round-trips every filter", () => {
    const f = { search: "bench", muscleGroupId: "1", targetAreaId: "2", workoutTypeId: "3", status: "inactive" as const,
      sort: "newest" as const, page: 3 };
    const qs = serializeFilters(f);
    expect(qs.toString()).toBe("q=bench&muscle=1&area=2&type=3&status=inactive&sort=newest&page=3");
    expect(parseFilters(qs)).toEqual(f);
  });

  it("omits defaults so URLs stay clean", () => {
    expect(serializeFilters(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("ignores malformed values instead of breaking", () => {
    const f = parseFilters(new URLSearchParams("muscle=abc&area=-1&type=0&status=weird&sort=bogus&page=-5"));
    expect(f).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(new URLSearchParams("page=2.5")).page).toBe(1);
  });

  it("counts only narrowing filters", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, sort: "newest", page: 4 })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, search: "x", muscleGroupId: "1", status: "active" })).toBe(3);
  });
});

describe("filters -> API query", () => {
  it("empty filters send no filter params", () => {
    expect(toListQuery(DEFAULT_FILTERS)).toEqual({
      search: undefined, muscle_group_id: undefined, target_area_id: undefined, workout_type_id: undefined,
      is_active: undefined, sort: "name", order: "asc", page: 1, page_size: PAGE_SIZE,
    });
  });

  it("maps each filter to the backend parameter", () => {
    const q = toListQuery({ search: "  press ", muscleGroupId: "1", targetAreaId: "2", workoutTypeId: "4",
      status: "inactive", sort: "updated", page: 2 });
    expect(q).toMatchObject({ search: "press", muscle_group_id: 1, target_area_id: 2, workout_type_id: 4,
      is_active: false, sort: "updated_at", order: "desc", page: 2 });
    expect(toListQuery({ ...DEFAULT_FILTERS, status: "active" }).is_active).toBe(true);
    expect(toListQuery({ ...DEFAULT_FILTERS, sort: "name_desc" })).toMatchObject({ sort: "name", order: "desc" });
  });
});
