import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Dumbbell, LogOut } from "lucide-react";
import { useLogout } from "../../features/auth/useLogout";
import { SETTINGS_ENTRY } from "../../config/navigation";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";

export default function AppLayout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const logout = useLogout();
  const SettingsIcon = SETTINGS_ENTRY.Icon;

  return (
    <div className="shell">
      <Sidebar />
      {/* Phone only: a slim bar with the brand and the settings icon (settings is not one of the four tabs). */}
      <header className="app-bar">
        <span className="brand-icon"><Dumbbell size={18} /></span>
        <b>Gym Planner</b>
        <Link to={SETTINGS_ENTRY.path} className="app-bar-settings" aria-label="Settings"><SettingsIcon size={20} /></Link>
        <button type="button" className="app-bar-settings app-bar-logout" aria-label="Log out" onClick={logout}><LogOut size={20} /></button>
      </header>
      <main className="main"><Outlet /></main>
      <MobileNav />
    </div>
  );
}
