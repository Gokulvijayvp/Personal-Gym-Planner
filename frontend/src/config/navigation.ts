import {
  ChartNoAxesCombined, Dumbbell, House, Library, Settings, ShieldCheck, Layers, Users, SlidersHorizontal, ListTree,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  Icon: LucideIcon;
  /** Other paths that belong to this tab, so it stays highlighted on them (e.g. the planner lives under Workout). */
  alsoActiveOn?: string[];
}

/**
 * The only primary navigation a regular user sees: four obvious destinations.
 * Everything else (planner, cycles, calendar, settings) is reached from inside these tabs or the settings icon.
 */
export const USER_NAV: NavItem[] = [
  { label: "Home", path: "/", Icon: House },
  { label: "Workout", path: "/workout", Icon: Dumbbell, alsoActiveOn: ["/planner", "/cycles", "/calendar"] },
  { label: "Exercises", path: "/exercises", Icon: Library },
  { label: "Progress", path: "/progress", Icon: ChartNoAxesCombined },
];

/**
 * FUTURE: tabs an Admin would additionally see. They are only described here: there is no login, no role
 * storage and no route behind them yet, and `CURRENT_ROLE` below is a fixed constant, not a user setting.
 */
export const ADMIN_NAV: NavItem[] = [
  { label: "Admin Dashboard", path: "/admin", Icon: ShieldCheck },
  { label: "Exercise Master", path: "/admin/exercise-master", Icon: Dumbbell },
  { label: "Muscle Groups & Target Areas", path: "/admin/muscle-groups", Icon: ListTree },
  { label: "Equipment & Workout Types", path: "/admin/equipment", Icon: Layers },
  { label: "User Management", path: "/admin/users", Icon: Users },
  { label: "Application Settings", path: "/admin/settings", Icon: SlidersHorizontal },
];

export type Role = "user" | "admin";

/** This app is single-user and has no accounts, so everyone is a regular user. */
export const CURRENT_ROLE: Role = "user";

/** The tabs a role may see. Admin-only tabs are never returned for a regular user. */
export function navForRole(role: Role): NavItem[] {
  return role === "admin" ? [...USER_NAV, ...ADMIN_NAV] : USER_NAV;
}

/** Entry point for settings: a small icon next to the navigation, not a fifth tab. */
export const SETTINGS_ENTRY: NavItem = { label: "Settings", path: "/settings", Icon: Settings };

/** Is `item` the current tab for `pathname`? "/" only matches exactly; others match their sub-paths too. */
export function isTabActive(item: NavItem, pathname: string): boolean {
  const hit = (p: string) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/"));
  return hit(item.path) || (item.alsoActiveOn ?? []).some(hit);
}
