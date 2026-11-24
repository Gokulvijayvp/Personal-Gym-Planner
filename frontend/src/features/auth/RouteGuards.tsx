import { Navigate, Outlet } from "react-router-dom";
import { useIsAdmin, useSession } from "./session";

/** Shown for a moment while the server is asked "who am I?", so a signed-in user never flashes the Login page. */
function Checking() {
  return <div className="auth-checking" role="status" aria-busy="true" aria-label="Checking your sign-in" />;
}

/** App pages: signed-out visitors go to Login. */
export function RequireAuth() {
  const s = useSession();
  if (s.status === "loading") return <Checking />;
  return s.status === "in" ? <Outlet /> : <Navigate to="/login" replace />;
}
/** Login / Sign up / Verify: someone already signed in on this device goes straight to Home. */
export function PublicOnly() {
  const s = useSession();
  if (s.status === "loading") return <Checking />;
  return s.status === "in" ? <Navigate to="/" replace /> : <Outlet />;
}
/** Pages only the admin may open (Settings). A normal user who types the address is sent Home. */
export function AdminOnly() {
  return useIsAdmin() ? <Outlet /> : <Navigate to="/" replace />;
}
