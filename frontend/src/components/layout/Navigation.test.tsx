// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppLayout from "./AppLayout";
import MobileNav from "./MobileNav";
import Sidebar from "./Sidebar";
import { resetSession, setSession } from "../../features/auth/session";
import { ADMIN_NAV, CURRENT_ROLE, SETTINGS_ENTRY, USER_NAV, isTabActive, navForRole } from "../../config/navigation";

beforeEach(() => setSession({ email: "admin@example.com", role: "admin" }));
afterEach(() => { cleanup(); resetSession(); });

const at = (path: string, ui: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
const labels = (nav: HTMLElement) => within(nav).getAllByRole("link").map((a) => a.textContent!.trim());

describe("navigation config", () => {
  it("a regular user has exactly four tabs: Home, Workout, Exercises, Progress", () => {
    expect(navForRole("user").map((i) => i.label)).toEqual(["Home", "Workout", "Exercises", "Progress"]);
    expect(navForRole("user").map((i) => i.path)).toEqual(["/", "/workout", "/exercises", "/progress"]);
  });

  it("the app is single-user: the current role is a fixed 'user'", () => {
    expect(CURRENT_ROLE).toBe("user");
    expect(navForRole(CURRENT_ROLE)).toBe(USER_NAV);
  });

  it("admin-only tabs exist only as a future design and never reach a regular user", () => {
    expect(ADMIN_NAV.map((i) => i.label)).toEqual([
      "Admin Dashboard", "Exercise Master", "Muscle Groups & Target Areas", "Equipment & Workout Types", "User Management", "Application Settings",
    ]);
    const userPaths = navForRole("user").map((i) => i.path);
    for (const a of ADMIN_NAV) expect(userPaths).not.toContain(a.path);
    expect(navForRole("user")).toHaveLength(4);
    expect(navForRole("admin")).toHaveLength(4 + ADMIN_NAV.length);       // what an admin role would add later
    expect(ADMIN_NAV.every((i) => i.path.startsWith("/admin"))).toBe(true);
  });

  it("settings is an entry point, not one of the tabs", () => {
    expect(USER_NAV.map((i) => i.path)).not.toContain(SETTINGS_ENTRY.path);
  });

  it("keeps the right tab highlighted on pages that now live inside it", () => {
    const tab = (label: string) => USER_NAV.find((i) => i.label === label)!;
    expect(isTabActive(tab("Home"), "/")).toBe(true);
    expect(isTabActive(tab("Home"), "/workout")).toBe(false);
    for (const p of ["/workout", "/workout/12", "/planner", "/cycles", "/calendar"]) expect(isTabActive(tab("Workout"), p)).toBe(true);
    expect(isTabActive(tab("Exercises"), "/exercises")).toBe(true);
    expect(isTabActive(tab("Progress"), "/progress")).toBe(true);
    expect(isTabActive(tab("Workout"), "/settings")).toBe(false);
    expect(USER_NAV.some((i) => isTabActive(i, "/settings"))).toBe(false);
  });
});

describe("navigation UI", () => {
  it("the sidebar shows only the four tabs plus a small Settings link", () => {
    at("/exercises", <Sidebar />);
    expect(labels(screen.getByRole("navigation", { name: "Main navigation" }))).toEqual(["Home", "Workout", "Exercises", "Progress"]);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("link", { name: "Exercises" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText(/admin/i)).toBeNull();
    for (const gone of ["Calendar", "Weekly Planner", "Exercise Library", "Workout Cycles", "More"]) expect(screen.queryByRole("link", { name: gone })).toBeNull();
  });

  it("the phone bar has four items, no More menu, and highlights Workout on the planner", () => {
    at("/planner", <MobileNav />);
    const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(labels(nav)).toEqual(["Home", "Workout", "Exercises", "Progress"]);
    expect(within(nav).queryByRole("button")).toBeNull();
    expect(within(nav).getByRole("link", { name: "Workout" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("the layout offers Settings from the phone app bar too", () => {
    at("/", <AppLayout />);
    const settings = screen.getAllByRole("link", { name: "Settings" }).map((a) => a.getAttribute("href"));
    expect(settings).toEqual(["/settings", "/settings"]);          // sidebar (desktop) + app bar (phone)
  });

  it("a normal user also has the Settings icon (their own preferences) and Log out", () => {
    setSession({ email: "user@example.com", role: "user" });
    at("/", <AppLayout />);
    const settings = screen.getAllByRole("link", { name: "Settings" }).map((a) => a.getAttribute("href"));
    expect(settings).toEqual(["/settings", "/settings"]);          // sidebar (desktop) + app bar (phone)
    expect(screen.getAllByRole("button", { name: /Log out/ }).length).toBeGreaterThan(0);
  });
});
