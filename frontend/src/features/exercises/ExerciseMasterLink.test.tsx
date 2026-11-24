// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExerciseCard from "./ExerciseCard";
import ExerciseFormModal from "./ExerciseFormModal";
import { MUSCLE_GROUPS, WORKOUT_TYPES, makeExercise } from "./testData";
import { exerciseMasterService } from "../../services/exerciseMasterService";

vi.mock("../../services/exerciseMasterService", () => ({
  exerciseMasterService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), cardioActivities: vi.fn() },
}));
vi.mock("../../services/exerciseService", () => ({ exerciseService: { create: vi.fn(), update: vi.fn() }, masterDataService: {} }));
const masters = vi.mocked(exerciseMasterService);
const stamp = { is_active: true, created_at: "2026-11-19T10:00:00Z", updated_at: "2026-11-19T10:00:00Z", usage_count: 0 };

beforeEach(() => {
  window.scrollTo = vi.fn() as never;
  masters.list.mockResolvedValue({ items: [{ id: 1, name: "Hammer Curl", icon_motion: "curl", ...stamp }], motions: { curl: "Curl" } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Library card icon", () => {
  it("shows the animated icon of the linked master when there is no image", () => {
    const { container } = render(<ExerciseCard exercise={makeExercise({ exercise_master: { id: 1, name: "Barbell Bench Press", icon_motion: "press" } })}
      onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />);
    expect(screen.getByTestId("exercise-icon")).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("data-motion")).toBe("press");
  });
  it("uses the generic icon when the exercise has no master, and the photo when it has one", () => {
    const { container, rerender } = render(<ExerciseCard exercise={makeExercise()} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />);
    expect(container.querySelector("svg")?.getAttribute("data-motion")).toBe("generic");
    rerender(<ExerciseCard exercise={makeExercise({ media_url: "https://example.com/a.jpg" })} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} />);
    expect(screen.queryByTestId("exercise-icon")).toBeNull();
  });
});

describe("Library form name suggestions", () => {
  const open = () => render(<ExerciseFormModal muscleGroups={MUSCLE_GROUPS} workoutTypes={WORKOUT_TYPES} onClose={vi.fn()} onSaved={vi.fn()} />);

  it("offers master names as suggestions and shows the icon of a matching name", async () => {
    const { container } = open();
    await waitFor(() => expect(container.ownerDocument.querySelector("datalist option")?.getAttribute("value")).toBe("Hammer Curl"));
    await userEvent.type(screen.getByLabelText(/Exercise name/), "hammer CURL");
    expect(screen.getByTestId("name-master").textContent).toMatch(/From the exercise master/);
  });

  it("says a new name will be added to the master", async () => {
    open();
    await userEvent.type(screen.getByLabelText(/Exercise name/), "Brand New Move");
    expect(screen.getByTestId("name-master").textContent).toMatch(/added to the exercise master/);
  });

  it("still works when the master list cannot be loaded", async () => {
    masters.list.mockRejectedValue(new Error("offline"));
    open();
    await userEvent.type(screen.getByLabelText(/Exercise name/), "Cable Row");
    expect((screen.getByLabelText(/Exercise name/) as HTMLInputElement).value).toBe("Cable Row");
    expect(document.querySelector("datalist")).toBeNull();
  });
});
