// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BarChart, BarList, DataTable, LineChart } from "./Charts";

afterEach(() => { cleanup(); delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth; });

function narrow(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
}

const WEEKS = ["02 Nov", "09 Nov", "16 Nov", "23 Nov", "30 Nov", "07 Dec", "14 Dec", "21 Dec", "28 Dec", "04 Jan"].map((label, i) => ({
  label, value: [3, 0, 2, 4, 0, 1, 5, 2, 0, 3][i], tooltip: `Week ${label}: ${[3, 0, 2, 4, 0, 1, 5, 2, 0, 3][i]} workouts`, partial: i === 9,
}));

describe("BarChart", () => {
  it("draws one labelled bar slot per period, including the zero ones", () => {
    render(<BarChart data={WEEKS} ariaLabel="Workouts by week" axisTitle="Workouts" />);
    const group = screen.getByRole("group", { name: "Workouts by week" });
    expect(within(group).getAllByRole("img")).toHaveLength(10);
    expect(within(group).getByRole("img", { name: "Week 09 Nov: 0 workouts" })).toBeTruthy();         // a zero week is present, not skipped
    expect(group.querySelectorAll("rect.chart-fill")).toHaveLength(7);                                   // zero weeks draw no bar, only a labelled slot
    expect(within(group).getAllByText("0").length).toBeGreaterThanOrEqual(3);                            // and the 0 is written out
  });

  it("uses a zero-based axis and titles it", () => {
    render(<BarChart data={WEEKS} ariaLabel="x" axisTitle="Workouts" />);
    expect(screen.getByText("Workouts", { selector: "text" })).toBeTruthy();
    const ticks = Array.from(document.querySelectorAll(".chart-tick")).map((t) => t.textContent);
    expect(ticks[0]).toBe("0");
    expect(ticks.length).toBeGreaterThan(2);
  });

  it("shows the exact value of a bar on hover, focus and tap", () => {
    render(<BarChart data={WEEKS} ariaLabel="x" axisTitle="Workouts" />);
    expect(screen.getByRole("status").textContent).toMatch(/Hover, tap or focus/);
    const bar = screen.getByRole("img", { name: "Week 16 Nov: 2 workouts" });
    fireEvent.mouseEnter(bar);
    expect(screen.getByRole("status").textContent).toBe("Week 16 Nov: 2 workouts");
    fireEvent.mouseLeave(bar);
    fireEvent.focus(screen.getByRole("img", { name: "Week 23 Nov: 4 workouts" }));
    expect(screen.getByRole("status").textContent).toBe("Week 23 Nov: 4 workouts");
    fireEvent.click(screen.getByRole("img", { name: "Week 02 Nov: 3 workouts" }));
    expect(screen.getByRole("status").textContent).toBe("Week 02 Nov: 3 workouts");
  });

  it("every bar can be reached with the keyboard", () => {
    render(<BarChart data={WEEKS} ariaLabel="x" axisTitle="Workouts" />);
    for (const bar of screen.getAllByRole("img")) expect(bar.getAttribute("tabindex")).toBe("0");
  });

  it("flags partial periods and explains the hatching", () => {
    render(<BarChart data={WEEKS} ariaLabel="x" axisTitle="Workouts" />);
    expect(screen.getByText(/Hatched bars are partial periods/)).toBeTruthy();
    cleanup();
    render(<BarChart data={WEEKS.map((w) => ({ ...w, partial: false }))} ariaLabel="x" axisTitle="Workouts" />);
    expect(screen.queryByText(/Hatched bars/)).toBeNull();
  });

  it("on a phone-width container it thins the x labels instead of overlapping them", () => {
    render(<BarChart data={WEEKS} ariaLabel="wide" axisTitle="Workouts" />);
    const wide = document.querySelectorAll(".chart-label").length;
    cleanup();
    narrow(320);
    render(<BarChart data={WEEKS} ariaLabel="narrow" axisTitle="Workouts" />);
    const labels = Array.from(document.querySelectorAll(".chart-label")).map((l) => l.textContent);
    expect(labels.length).toBeLessThan(wide);
    expect(labels[labels.length - 1]).toBe("04 Jan");                                                    // the latest date is always labelled
    expect(document.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[2]).toBe("320");           // sized to the container, no sideways scroll
    expect(screen.getAllByRole("img")).toHaveLength(10);                                                   // every bar is still present
  });

  it("never gets narrower than a readable minimum", () => {
    narrow(120);
    render(<BarChart data={WEEKS} ariaLabel="x" axisTitle="Workouts" />);
    expect(Number(document.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[2])).toBeGreaterThanOrEqual(260);
  });

  it("formats axis ticks and value labels with the supplied formatter", () => {
    render(<BarChart data={[{ label: "a", value: 12000, tooltip: "t" }]} ariaLabel="x" axisTitle="kg" format={(n) => `${n / 1000}k`} />);
    expect(screen.getAllByText("12k").length).toBeGreaterThan(0);
  });
});

const POINTS = [
  { x: "2026-10-22", y: 62.5, tooltip: "22 Oct: 62.5 kg × 8" }, { x: "2026-11-02", y: 70, tooltip: "02 Nov: 70 kg × 6" }, { x: "2026-11-16", y: 80, tooltip: "16 Nov: 80 kg × 4" },
];

describe("LineChart", () => {
  it("draws a line through every point with exact tooltips", () => {
    render(<LineChart points={POINTS} ariaLabel="Weight by date" axisTitle="kg" xLabel={(x) => x.slice(5)} />);
    expect(document.querySelector("path.chart-line")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(3);
    fireEvent.focus(screen.getByRole("img", { name: "02 Nov: 70 kg × 6" }));
    expect(screen.getByRole("status").textContent).toBe("02 Nov: 70 kg × 6");
  });

  it("says plainly that the axis does not start at zero", () => {
    render(<LineChart points={POINTS} ariaLabel="x" axisTitle="kg" xLabel={(x) => x} />);
    expect(screen.getByText(/The vertical axis starts at 60, not zero/)).toBeTruthy();
  });

  it("spaces points by real dates, not evenly", () => {
    render(<LineChart points={POINTS} ariaLabel="x" axisTitle="kg" xLabel={(x) => x} />);
    const xs = Array.from(document.querySelectorAll("circle.chart-dot")).map((c) => Number(c.getAttribute("cx")));
    expect(xs[1] - xs[0]).toBeLessThan(xs[2] - xs[1]);                                                    // 11 days then 14 days
    expect(xs[0]).toBeLessThan(xs[1]); expect(xs[1]).toBeLessThan(xs[2]);
  });

  it("a reps axis shows each whole number once, never a rounded half", () => {
    const flat = [{ x: "2026-11-01", y: 5, tooltip: "a" }, { x: "2026-11-08", y: 5, tooltip: "b" }, { x: "2026-11-15", y: 5, tooltip: "c" }];
    render(<LineChart points={flat} ariaLabel="x" axisTitle="Reps" integer format={(n) => String(Math.round(n))} xLabel={(x) => x} />);
    const ticks = Array.from(document.querySelectorAll(".chart-tick")).map((t) => t.textContent);
    expect(ticks).toEqual(["4", "5", "6"]);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("one point is a dot with an honest note, not a fake line", () => {
    render(<LineChart points={[POINTS[0]]} ariaLabel="x" axisTitle="kg" xLabel={(x) => x} />);
    expect(document.querySelector("path.chart-line")).toBeNull();
    expect(document.querySelectorAll("circle.chart-dot")).toHaveLength(1);
    expect(screen.getByText(/Only one training date so far/)).toBeTruthy();
  });

  it("a flat series still has a usable axis", () => {
    render(<LineChart points={[{ x: "2026-11-01", y: 70, tooltip: "a" }, { x: "2026-11-08", y: 70, tooltip: "b" }]} ariaLabel="x" axisTitle="kg" xLabel={(x) => x} />);
    expect(document.querySelectorAll(".chart-tick").length).toBeGreaterThan(1);
  });

  it("thins date labels on a narrow screen but keeps every point", () => {
    const many = Array.from({ length: 24 }, (_, i) => ({ x: `2026-10-${String(i + 1).padStart(2, "0")}`, y: 60 + i, tooltip: `p${i}` }));
    narrow(320);
    render(<LineChart points={many} ariaLabel="x" axisTitle="kg" xLabel={(x) => x.slice(8)} />);
    expect(screen.getAllByRole("img")).toHaveLength(24);
    expect(document.querySelectorAll(".chart-label").length).toBeLessThan(8);
  });
});

describe("BarList", () => {
  it("sizes bars relative to the largest value and shows exact figures", () => {
    render(<BarList ariaLabel="Volume by exercise" items={[
      { label: "Squat", value: 7000, valueLabel: "7,000 kg", sub: "12 sets" }, { label: "Bench", value: 3500, valueLabel: "3,500 kg" }, { label: "Empty", value: 0, valueLabel: "0 kg" }]} />);
    const rows = within(screen.getByRole("list", { name: "Volume by exercise" })).getAllByRole("listitem");
    const widths = rows.map((r) => (r.querySelector(".bl-fill") as HTMLElement).style.width);
    expect(widths).toEqual(["100%", "50%", "0%"]);
    expect(within(rows[0]).getByText("7,000 kg")).toBeTruthy();
    expect(within(rows[0]).getByText("12 sets")).toBeTruthy();
  });
  it("a tiny non-zero value is still visible", () => {
    render(<BarList ariaLabel="x" items={[{ label: "Big", value: 10000, valueLabel: "a" }, { label: "Tiny", value: 1, valueLabel: "b" }]} />);
    const fill = document.querySelectorAll(".bl-fill")[1] as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeGreaterThanOrEqual(2);
  });
  it("handles all-zero data without dividing by zero", () => {
    render(<BarList ariaLabel="x" items={[{ label: "A", value: 0, valueLabel: "0" }]} />);
    expect((document.querySelector(".bl-fill") as HTMLElement).style.width).toBe("0%");
  });
});

describe("DataTable", () => {
  it("offers the exact numbers as an accessible table", () => {
    render(<DataTable caption="Workouts by week" columns={["Week", "Workouts"]} rows={[["02 Nov", 3], ["09 Nov", 0]]} />);
    const table = screen.getByRole("table", { hidden: true });
    expect(within(table).getAllByRole("columnheader", { hidden: true }).map((h) => h.textContent)).toEqual(["Week", "Workouts"]);
    expect(within(table).getByRole("rowheader", { name: "09 Nov", hidden: true })).toBeTruthy();
    expect(screen.getByText("View as a table")).toBeTruthy();
  });
});
