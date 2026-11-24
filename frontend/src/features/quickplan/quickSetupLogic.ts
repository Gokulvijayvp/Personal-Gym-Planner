import type { CatalogueItem } from "../../types/catalogue";

/** What one weekday should become. Empty (not rest, no muscles) means "leave this day alone". */
export interface DayPlan {
  rest: boolean;
  muscles: string[];
  /** Catalogue keys the user ticked by hand. While undefined, the automatic picks are used. */
  picks?: string[];
}

export type Scope = "this" | "following" | "all";

export const emptyDay = (): DayPlan => ({ rest: false, muscles: [] });
export const emptyWeek = (): DayPlan[] => Array.from({ length: 7 }, emptyDay);
export const isConfigured = (d: DayPlan) => d.rest || d.muscles.length > 0;

type PresetDay = string[] | "rest";
export interface Preset { id: string; label: string; hint: string; days: PresetDay[] }

const LEGS = ["Quadriceps", "Hamstrings", "Glutes", "Calves"];

/** Monday to Sunday. Muscle names that the catalogue does not have are simply skipped when applied. */
export const PRESETS: Preset[] = [
  { id: "split", label: "One muscle a day", hint: "Chest, Back, Shoulders, Arms, Legs, Abs", days: [
    ["Chest"], ["Back"], ["Shoulders"], ["Biceps", "Triceps"], LEGS, ["Abs / Core"], "rest"] },
  { id: "ppl", label: "Push / Pull / Legs", hint: "6 days, Sunday rest", days: [
    ["Chest", "Shoulders", "Triceps"], ["Back", "Biceps"], LEGS,
    ["Chest", "Shoulders", "Triceps"], ["Back", "Biceps"], LEGS, "rest"] },
  { id: "ul", label: "Upper / Lower", hint: "4 days a week", days: [
    ["Chest", "Back", "Shoulders", "Biceps", "Triceps"], LEGS, "rest",
    ["Chest", "Back", "Shoulders", "Biceps", "Triceps"], LEGS, "rest", "rest"] },
  { id: "fullbody", label: "Full body 3 days", hint: "Monday, Wednesday, Friday", days: [
    ["Chest", "Back", "Quadriceps", "Shoulders"], "rest", ["Chest", "Back", "Hamstrings", "Shoulders"], "rest",
    ["Chest", "Back", "Glutes", "Abs / Core"], "rest", "rest"] },
];

export function applyPreset(preset: Preset, available: string[]): DayPlan[] {
  return preset.days.map((d) => d === "rest"
    ? { rest: true, muscles: [] }
    : { rest: false, muscles: d.filter((m) => available.includes(m)) });
}

/** The first `perMuscle` catalogue exercises of each chosen muscle, in the catalogue's own order. */
export function autoPicks(items: CatalogueItem[], muscles: string[], perMuscle: number): string[] {
  if (perMuscle <= 0) return [];
  return muscles.flatMap((m) => items.filter((i) => i.muscle_group === m).slice(0, perMuscle).map((i) => i.key));
}

/** Keys that will really be added for a day, kept in muscle order. */
export function effectivePicks(day: DayPlan, items: CatalogueItem[], perMuscle: number): string[] {
  if (day.rest) return [];
  const chosen = day.picks ?? autoPicks(items, day.muscles, perMuscle);
  const byKey = new Map(items.map((i) => [i.key, i]));
  return day.muscles.flatMap((m) => chosen.filter((k) => byKey.get(k)?.muscle_group === m));
}

export const dayTitle = (muscles: string[]): string => muscles.join(" + ").slice(0, 120);

/** The weeks (other than `current`) that get a copy of the week that was just built. */
export function otherWeeks(scope: Scope, current: number, total: number): number[] {
  if (scope === "this") return [];
  const out: number[] = [];
  for (let w = scope === "all" ? 1 : current + 1; w <= total; w++) if (w !== current) out.push(w);
  return out;
}

export function describeScope(scope: Scope, current: number, total: number, wholeWeek: boolean): string {
  const unit = wholeWeek ? "week" : "day";
  if (scope === "this") return `this ${unit} only`;
  const n = otherWeeks(scope, current, total).length + 1;
  return `${n} ${n === 1 ? "week" : "weeks"} of the plan`;
}
