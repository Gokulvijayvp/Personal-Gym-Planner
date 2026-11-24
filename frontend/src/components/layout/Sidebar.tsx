import { Link, useLocation } from "react-router-dom";
import { Dumbbell, LogOut } from "lucide-react";
import { useLogout } from "../../features/auth/useLogout";
import { CURRENT_ROLE, SETTINGS_ENTRY, isTabActive, navForRole } from "../../config/navigation";

export default function Sidebar() {
  const { pathname } = useLocation();
  const items = navForRole(CURRENT_ROLE);
  const logout = useLogout();
  const SettingsIcon = SETTINGS_ENTRY.Icon;
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-icon"><Dumbbell /></span>
        <div><b>Gym Planner</b><small>PERSONAL FITNESS</small></div>
      </div>
      <nav aria-label="Main navigation">
        {items.map((item) => (
          <Link key={item.path} to={item.path} aria-current={isTabActive(item, pathname) ? "page" : undefined}
            className={isTabActive(item, pathname) ? "nav active" : "nav"}>
            <item.Icon size={19} />{item.label}
          </Link>
        ))}
      </nav>
      <div className="side-bottom">
        <Link to={SETTINGS_ENTRY.path} className={pathname.startsWith("/settings") ? "side-settings active" : "side-settings"}
          aria-label="Settings" aria-current={pathname.startsWith("/settings") ? "page" : undefined}>
          <SettingsIcon size={17} aria-hidden /> Settings
        </Link>
        <button type="button" className="side-logout" onClick={logout}><LogOut size={17} aria-hidden /> Log out</button>
      </div>
    </aside>
  );
}
