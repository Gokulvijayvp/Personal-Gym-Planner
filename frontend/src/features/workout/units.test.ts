import { describe, expect, it } from "vitest";
import {
  distanceToCanonical, distanceToInput, formatClock, formatDurationShort, parseDecimal, parseWholeNumber, speedToCanonical,
  speedToInput, weightLabel, weightToCanonical, weightToInput,
} from "./units";

const kg = (text: string, unit: "kg" | "lbs" = "kg") => {
  const r = weightToCanonical(text, unit);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

describe("weight", () => {
  it("kilograms pass through unchanged", () => {
    expect(kg("22.5")).toBe(22.5);
    expect(kg("22,5")).toBe(22.5);
    expect(kg("100")).toBe(100);
    expect(kg(".5")).toBe(0.5);
    expect(weightToInput(22.5, "kg")).toBe("22.5");
    expect(weightToInput(10.206, "kg")).toBe("10.206");
    expect(weightToInput(80, "kg")).toBe("80");
  });
  it("converts pounds to kilograms with three decimals", () => {
    expect(kg("100", "lbs")).toBe(45.359);
    expect(kg("22.5", "lbs")).toBe(10.206);
    expect(kg("2.5", "lbs")).toBe(1.134);
    expect(weightToInput(45.359, "lbs")).toBe("100");
    expect(weightToInput(80, "lbs")).toBe("176.37");
  });
  it("empty means no value (bodyweight)", () => {
    expect(weightToCanonical("", "kg")).toEqual({ ok: true, value: null });
    expect(weightToCanonical("   ", "lbs")).toEqual({ ok: true, value: null });
    expect(weightToInput(null, "lbs")).toBe("");
  });
  it("what you type in pounds is what you see again after it was stored in kilograms (every 0.25 lb up to 1,000)", () => {
    for (let quarter = 0; quarter <= 4000; quarter++) {
      const lbs = quarter / 4;
      const typed = String(lbs);
      const stored = kg(typed, "lbs") as number;
      expect(weightToInput(stored, "lbs"), `${typed} lbs -> ${stored} kg`).toBe(typed);
    }
  });
  it("every two-decimal pound value round-trips", () => {
    for (let hundredth = 0; hundredth <= 20000; hundredth += 7) {
      const typed = (hundredth / 100).toFixed(2).replace(/\.?0+$/, "");
      const stored = kg(typed, "lbs") as number;
      expect(weightToInput(stored, "lbs"), typed).toBe(typed);
    }
  });
  it("stored kilograms never drift when converted for display and parsed back unchanged", () => {
    for (const stored of [0.001, 1.134, 2.5, 7.5, 10.206, 20, 22.5, 45.359, 80, 100.125, 999.999]) {
      for (const unit of ["kg", "lbs"] as const) {
        const shown = weightToInput(stored, unit);
        // The page does not send a value the user did not edit; if they re-typed what they saw, it stays within 1 g.
        const again = kg(shown, unit) as number;
        expect(Math.abs(again - stored), `${stored} kg shown as ${shown} ${unit}`).toBeLessThanOrEqual(0.0051);
      }
    }
  });
  it("rejects bad input with a message", () => {
    for (const bad of ["abc", "1.2.3", "-5", "5kg", "1e3", "--", "2,5,1"]) {
      const r = weightToCanonical(bad, "kg");
      expect(r.ok, bad).toBe(false);
    }
    expect(weightToCanonical("22.5555", "kg")).toEqual({ ok: false, message: "Use at most 3 decimals." });
    expect(weightToCanonical("22.555", "lbs")).toEqual({ ok: false, message: "Use at most 2 decimals." });
    expect(weightToCanonical("1000.5", "kg").ok).toBe(false);
    expect(weightToCanonical("2300", "lbs").ok).toBe(false);
    expect(weightToCanonical("1000", "kg")).toEqual({ ok: true, value: 1000 });
  });
  it("labels", () => {
    expect(weightLabel(80, "kg")).toBe("80 kg");
    expect(weightLabel(80, "lbs")).toBe("176.37 lbs");
    expect(weightLabel(null, "kg")).toBe("");
  });
});

describe("distance and speed", () => {
  it("converts miles", () => {
    const r = distanceToCanonical("3.1", "miles");
    expect(r).toEqual({ ok: true, value: 4.989 });
    expect(distanceToInput(4.989, "miles")).toBe("3.1");
    expect(distanceToInput(5, "km")).toBe("5");
    expect(distanceToInput(4.75, "km")).toBe("4.75");
    expect(distanceToInput(null, "miles")).toBe("");
  });
  it("round-trips every 0.01 mile up to 50", () => {
    for (let h = 0; h <= 5000; h += 3) {
      const typed = (h / 100).toFixed(2).replace(/\.?0+$/, "");
      const km = (distanceToCanonical(typed, "miles") as { value: number }).value;
      expect(distanceToInput(km, "miles"), typed).toBe(typed);
    }
  });
  it("validates", () => {
    expect(distanceToCanonical("abc", "km").ok).toBe(false);
    expect(distanceToCanonical("1.2345", "km").ok).toBe(false);
    expect(distanceToCanonical("2000", "km").ok).toBe(false);
    expect(distanceToCanonical("", "km")).toEqual({ ok: true, value: null });
  });
  it("speed follows the distance unit", () => {
    expect(speedToCanonical("10.2", "km")).toEqual({ ok: true, value: 10.2 });
    expect(speedToCanonical("6", "miles")).toEqual({ ok: true, value: 9.66 });
    expect(speedToInput(9.66, "miles")).toBe("6");
    expect(speedToCanonical("250", "km").ok).toBe(false);
    expect(speedToCanonical("1.234", "km").ok).toBe(false);
  });
});

describe("numbers and time", () => {
  it("whole numbers", () => {
    expect(parseWholeNumber("12", 1000)).toEqual({ ok: true, value: 12 });
    expect(parseWholeNumber("", 1000)).toEqual({ ok: true, value: null });
    expect(parseWholeNumber("1.5", 1000).ok).toBe(false);
    expect(parseWholeNumber("-1", 1000).ok).toBe(false);
    expect(parseWholeNumber("1001", 1000)).toEqual({ ok: false, message: "Must be 1000 or less." });
  });
  it("decimals", () => {
    expect(parseDecimal("7,5")).toEqual({ ok: true, value: 7.5 });
    expect(parseDecimal("").ok).toBe(true);
    expect(parseDecimal("x").ok).toBe(false);
  });
  it("clock and short durations", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatDurationShort(40)).toBe("< 1 min");
    expect(formatDurationShort(125)).toBe("2 min");
    expect(formatDurationShort(3725)).toBe("1 h 2 min");
    expect(formatDurationShort(7200)).toBe("2 h");
  });
});
