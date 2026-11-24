import { describe, expect, it } from "vitest";
import {
  EMPTY_ASSIGNMENT, EMPTY_CARDIO, assignmentFromItem, clampWeek, defaultCycle, describeAssignment, moveItem,
  normaliseReps, toAssignmentInput, toCardioInput, validateAssignment, validateCardio,
} from "./plannerLogic";
import type { CycleSummary, ScheduledExercise } from "../../types/planner";

const item = (over: Partial<ScheduledExercise> = {}): ScheduledExercise => ({
  id: 7, order: 1,
  exercise: { id: 3, name: "Cable Fly", is_active: true, muscle_group: { id: 1, name: "Chest" },
    target_area: { id: 4, name: "Inner Chest", muscle_group_id: 1 }, workout_type: { id: 4, name: "Cable" } },
  target_sets: 4, target_reps: "8-12", target_weight_kg: 22.5, rest_seconds: 90, notes: "slow",
  ...over,
});

describe("normaliseReps mirrors the backend", () => {
  it.each([["10", "10"], [" 8 - 12 ", "8-12"], ["8–12", "8-12"], ["amrap", "AMRAP"], ["FAILURE", "Failure"], ["012", "12"]])(
    "%j -> %j", (raw, out) => expect(normaliseReps(raw)).toBe(out));
  it.each(["", "0", "12-8", "abc", "1000", "10 reps", "5-", "-5"])("rejects %j", (raw) => expect(normaliseReps(raw)).toBeNull());
});

describe("validateAssignment", () => {
  const ok = { ...EMPTY_ASSIGNMENT, exerciseId: 3 };
  it("defaults + a chosen exercise are valid", () => expect(validateAssignment(ok)).toEqual({}));
  it("requires an exercise from the library", () => expect(validateAssignment(EMPTY_ASSIGNMENT).exercise_id).toBeTruthy());
  it("sets 1-20 whole", () => {
    for (const s of ["0", "21", "", "1.5", "abc", "-1"]) expect(validateAssignment({ ...ok, sets: s }).target_sets, s).toBeTruthy();
    for (const s of ["1", "20"]) expect(validateAssignment({ ...ok, sets: s }).target_sets, s).toBeUndefined();
  });
  it("reps", () => {
    expect(validateAssignment({ ...ok, reps: "abc" }).target_reps).toBeTruthy();
    expect(validateAssignment({ ...ok, reps: "6-8" }).target_reps).toBeUndefined();
  });
  it("optional weight / rest only validated when given", () => {
    expect(validateAssignment({ ...ok, weight: "", rest: "" })).toEqual({});
    expect(validateAssignment({ ...ok, weight: "-1" }).target_weight_kg).toBeTruthy();
    expect(validateAssignment({ ...ok, weight: "1001" }).target_weight_kg).toBeTruthy();
    expect(validateAssignment({ ...ok, weight: "82.5" }).target_weight_kg).toBeUndefined();
    expect(validateAssignment({ ...ok, rest: "3601" }).rest_seconds).toBeTruthy();
    expect(validateAssignment({ ...ok, rest: "1.5" }).rest_seconds).toBeTruthy();
    expect(validateAssignment({ ...ok, rest: "0" }).rest_seconds).toBeUndefined();
  });
  it("notes length", () => expect(validateAssignment({ ...ok, notes: "x".repeat(501) }).notes).toBeTruthy());
});

describe("assignment <-> form <-> API body", () => {
  it("builds the API body", () => {
    expect(toAssignmentInput({ exerciseId: 3, sets: "4", reps: " 6 - 8", weight: "80", rest: "120", notes: " pause " })).toEqual({
      exercise_id: 3, target_sets: 4, target_reps: "6-8", target_weight_kg: 80, rest_seconds: 120, notes: "pause" });
    expect(toAssignmentInput({ ...EMPTY_ASSIGNMENT, exerciseId: 3 })).toEqual({
      exercise_id: 3, target_sets: 3, target_reps: "10", target_weight_kg: null, rest_seconds: null, notes: null });
  });
  it("round-trips a planned exercise through the form", () => {
    expect(toAssignmentInput(assignmentFromItem(item()))).toEqual({
      exercise_id: 3, target_sets: 4, target_reps: "8-12", target_weight_kg: 22.5, rest_seconds: 90, notes: "slow" });
    expect(assignmentFromItem(item({ target_weight_kg: null, rest_seconds: null, notes: null }))).toMatchObject({ weight: "", rest: "", notes: "" });
  });
  it("describes a row", () => {
    expect(describeAssignment(item())).toBe("4 × 8-12 @ 22.5 kg · rest 90s");
    expect(describeAssignment(item({ target_weight_kg: null, rest_seconds: null }))).toBe("4 × 8-12");
    expect(describeAssignment(item({ rest_seconds: 0 }))).toContain("rest 0s");
  });
});

describe("reordering", () => {
  it("moves one step and never leaves the list", () => {
    expect(moveItem([10, 20, 30], 1, -1)).toEqual([20, 10, 30]);
    expect(moveItem([10, 20, 30], 1, 1)).toEqual([10, 30, 20]);
    expect(moveItem([10, 20, 30], 0, -1)).toBeNull();
    expect(moveItem([10, 20, 30], 2, 1)).toBeNull();
    expect(moveItem([10], 0, 1)).toBeNull();
    expect(moveItem([10, 20], 5, -1)).toBeNull();
  });
  it("does not mutate its input", () => {
    const ids = [1, 2, 3];
    moveItem(ids, 0, 1);
    expect(ids).toEqual([1, 2, 3]);
  });
});

describe("cardio form", () => {
  const ok = { ...EMPTY_CARDIO, activityId: "2" };
  it("validates", () => {
    expect(validateCardio(EMPTY_CARDIO).cardio_activity_id).toBeTruthy();
    expect(validateCardio(ok)).toEqual({});
    for (const m of ["0", "601", "", "x", "2.5"]) expect(validateCardio({ ...ok, minutes: m }).duration_minutes, m).toBeTruthy();
    expect(validateCardio({ ...ok, distance: "-1" }).distance_km).toBeTruthy();
    expect(validateCardio({ ...ok, distance: "5.5" }).distance_km).toBeUndefined();
  });
  it("builds the API body", () => {
    expect(toCardioInput({ activityId: "2", minutes: "40", distance: "5", notes: " easy " })).toEqual({
      cardio_activity_id: 2, duration_minutes: 40, distance_km: 5, notes: "easy" });
    expect(toCardioInput(ok)).toMatchObject({ distance_km: null, notes: null });
  });
});

describe("cycle / week selection helpers", () => {
  const c = (over: Partial<CycleSummary>): CycleSummary => ({
    id: 1, name: "C", description: null, start_date: "2026-11-16", end_date: "2027-01-10", total_weeks: 8, status: "draft",
    planned_days: 0, rest_days: 0, exercise_count: 0, cardio_count: 0, created_at: "", updated_at: "", ...over });

  it("prefers the active cycle, then the newest draft, then anything", () => {
    expect(defaultCycle([])).toBeNull();
    expect(defaultCycle([c({ id: 1, status: "completed" }), c({ id: 2, status: "active" }), c({ id: 3, status: "draft" })])!.id).toBe(2);
    expect(defaultCycle([c({ id: 1, status: "draft", start_date: "2026-01-05" }), c({ id: 3, status: "draft", start_date: "2027-03-01" })])!.id).toBe(3);
    expect(defaultCycle([c({ id: 9, status: "archived" })])!.id).toBe(9);
  });
  it("clamps the week into the cycle", () => {
    expect(clampWeek(3, 8)).toBe(3);
    expect(clampWeek(99, 8)).toBe(8);
    expect(clampWeek(0, 8)).toBe(1);
    expect(clampWeek(-4, 8)).toBe(1);
    expect(clampWeek(2.5, 8)).toBe(1);
    expect(clampWeek(NaN, 8)).toBe(1);
  });
});
