import { describe, expect, it } from "vitest";
import { elapsedSeconds, isEmptyLog, summarize } from "./sessionLogic";
import { makeCardio, makeExercise, makeSession, makeSet } from "./testData";

describe("summarize", () => {
  it("is all zero for a freshly started planned workout: targets are not performance", () => {
    const s = summarize(makeSession());
    expect(s).toEqual({ total_exercises: 2, completed_exercises: 0, skipped_exercises: 0, total_sets: 5, completed_sets: 0, cardio_entries: 1, cardio_completed: 0, cardio_minutes: 0 });
  });
  it("counts only completed sets and cardio, whatever else is filled in", () => {
    const bench = makeExercise({ id: 1, status: "completed", sets: [
      makeSet({ id: 11, set_number: 1, status: "completed", actual_reps: 8 }), makeSet({ id: 12, set_number: 2, status: "skipped" }),
      makeSet({ id: 13, set_number: 3, actual_reps: 6 }),                                    // reps typed but never marked done
    ] });
    const fly = makeExercise({ id: 2, status: "skipped", sets: [] });
    const run = makeCardio({ id: 1, status: "completed", duration_minutes: 28 });
    const walk = makeCardio({ id: 2, status: "pending", duration_minutes: 40 });             // entered but not completed
    const skipped = makeCardio({ id: 3, status: "skipped", duration_minutes: 10 });
    expect(summarize({ exercises: [bench, fly], cardio: [run, walk, skipped] })).toEqual({
      total_exercises: 2, completed_exercises: 1, skipped_exercises: 1, total_sets: 3, completed_sets: 1, cardio_entries: 3, cardio_completed: 1, cardio_minutes: 28 });
  });
  it("a completed cardio entry without a duration adds zero minutes", () => {
    expect(summarize({ exercises: [], cardio: [makeCardio({ id: 1, status: "completed", duration_minutes: null })] }).cardio_minutes).toBe(0);
  });
  it("matches the server's figures for the same data", () => {
    const s = makeSession();
    s.exercises[0].sets[0] = makeSet({ id: 11, set_number: 1, status: "completed" });
    expect(summarize(s).completed_sets).toBe(1);
  });
});

describe("isEmptyLog", () => {
  it("is true until something is marked done", () => {
    expect(isEmptyLog(makeSession())).toBe(true);
    const s = makeSession();
    s.cardio[0].status = "completed";
    expect(isEmptyLog(s)).toBe(false);
    const t = makeSession();
    t.exercises[1].status = "completed";
    expect(isEmptyLog(t)).toBe(false);
    expect(isEmptyLog({ exercises: [], cardio: [] })).toBe(true);
  });
});

describe("elapsedSeconds", () => {
  it("adds the time since the server's figure while running, and never goes backwards", () => {
    expect(elapsedSeconds(600, 1_000_000, true, 1_000_000)).toBe(600);
    expect(elapsedSeconds(600, 1_000_000, true, 1_125_900)).toBe(725);
    expect(elapsedSeconds(600, 1_000_000, true, 999_000)).toBe(600);                         // a clock set back
  });
  it("a finished workout is its stored duration, however long ago", () => {
    expect(elapsedSeconds(4500, 1_000_000, false, 9_999_999_999)).toBe(4500);
  });
});
