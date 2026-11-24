import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM, toInput, validateForm, valuesFromExercise, withPrimaryMuscle, type ExerciseFormValues,
} from "./exerciseForm";
import { MUSCLE_GROUPS, makeExercise } from "./testData";

const valid: ExerciseFormValues = { ...EMPTY_FORM, name: "Cable Fly", muscleGroupId: "1", targetAreaId: "4", workoutTypeId: "4" };

describe("validateForm", () => {
  it("accepts a valid form", () => {
    expect(validateForm(valid, MUSCLE_GROUPS)).toEqual({});
  });

  it("requires name and primary muscle group", () => {
    const e = validateForm(EMPTY_FORM, MUSCLE_GROUPS);
    expect(e.name).toBeTruthy();
    expect(e.muscle_group_id).toBeTruthy();
  });

  it("name length rules apply after trimming and collapsing spaces", () => {
    expect(validateForm({ ...valid, name: "   " }, MUSCLE_GROUPS).name).toBeTruthy();
    expect(validateForm({ ...valid, name: " A " }, MUSCLE_GROUPS).name).toMatch(/at least 2/);
    expect(validateForm({ ...valid, name: "x".repeat(161) }, MUSCLE_GROUPS).name).toMatch(/at most 160/);
    expect(validateForm({ ...valid, name: "a   b" }, MUSCLE_GROUPS).name).toBeUndefined();
  });

  it("rejects a target area from a different muscle group", () => {
    expect(validateForm({ ...valid, targetAreaId: "8" }, MUSCLE_GROUPS).target_area_id).toBeTruthy(); // Lats vs Chest
  });

  it("image URL must be http(s)", () => {
    for (const bad of ["ftp://x.com/a.png", "javascript:alert(1)", "not a url", "http://"]) {
      expect(validateForm({ ...valid, mediaUrl: bad }, MUSCLE_GROUPS).media_url, bad).toBeTruthy();
    }
    expect(validateForm({ ...valid, mediaUrl: "https://example.com/a.png" }, MUSCLE_GROUPS).media_url).toBeUndefined();
    expect(validateForm({ ...valid, mediaUrl: "   " }, MUSCLE_GROUPS).media_url).toBeUndefined(); // optional
  });

  it("enforces text length limits", () => {
    expect(validateForm({ ...valid, description: "x".repeat(2001) }, MUSCLE_GROUPS).description).toBeTruthy();
    expect(validateForm({ ...valid, instructions: "x".repeat(5001) }, MUSCLE_GROUPS).instructions).toBeTruthy();
  });
});

describe("dependent fields", () => {
  it("changing primary muscle clears a target area that no longer belongs", () => {
    const next = withPrimaryMuscle(valid, "2", MUSCLE_GROUPS); // Chest -> Back
    expect(next.muscleGroupId).toBe("2");
    expect(next.targetAreaId).toBe("");
  });

  it("re-selecting the same group keeps the target area", () => {
    expect(withPrimaryMuscle(valid, "1", MUSCLE_GROUPS).targetAreaId).toBe("4");
  });

  it("the new primary is removed from secondary muscles", () => {
    const next = withPrimaryMuscle({ ...valid, secondaryIds: [2, 5] }, "5", MUSCLE_GROUPS);
    expect(next.secondaryIds).toEqual([2]);
  });
});

describe("toInput / valuesFromExercise", () => {
  it("builds the API body: trims, collapses whitespace, blanks become null, ids become numbers", () => {
    expect(toInput({ ...valid, name: "  Cable   Fly ", description: "  ", mediaUrl: "", instructions: " do it ",
      secondaryIds: [5] })).toEqual({
      name: "Cable Fly", description: null, muscle_group_id: 1, secondary_muscle_group_ids: [5], target_area_id: 4,
      workout_type_id: 4, instructions: "do it", media_url: null, is_active: true,
    });
    expect(toInput({ ...EMPTY_FORM, name: "Push Up", muscleGroupId: "1" })).toMatchObject({
      target_area_id: null, workout_type_id: null, secondary_muscle_group_ids: [],
    });
  });

  it("an exercise survives a round trip through the form", () => {
    const ex = makeExercise({ description: "d", instructions: "i", media_url: "https://e.com/a.png" });
    const input = toInput(valuesFromExercise(ex));
    expect(input).toEqual({
      name: ex.name, description: "d", muscle_group_id: 1, secondary_muscle_group_ids: [5], target_area_id: 2,
      workout_type_id: 1, instructions: "i", media_url: "https://e.com/a.png", is_active: true,
    });
  });
});
