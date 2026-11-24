import { Link, useLocation } from "react-router-dom";
import { CURRENT_ROLE, isTabActive, navForRole } from "../../config/navigation";

/** Bottom bar: exactly the four tabs a user can see (more only if an admin role ever exists). */
export default function MobileNav() {
  const { pathname } = useLocation();
  const items = navForRole(CURRENT_ROLE);
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {items.map((item) => {
        const active = isTabActive(item, pathname);
        return (
          <Link key={item.path} to={item.path} className={active ? "selected" : ""} aria-current={active ? "page" : undefined}>
            <item.Icon size={21} /><small>{item.label}</small>
          </Link>
        );
      })}
    </nav>
  );
}
