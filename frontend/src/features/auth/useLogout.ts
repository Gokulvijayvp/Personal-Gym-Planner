import { useNavigate } from "react-router-dom";
import { authService } from "../../services/authService";
import { clearSession } from "./session";

/** Tells the server to end this login (it clears the cookies), then returns to Login. Always works, even offline. */
export function useLogout() {
  const navigate = useNavigate();
  return async () => {
    try { await authService.logout(); } catch { /* the local sign-out below must always happen */ }
    clearSession();
    navigate("/login", { replace: true });
  };
}
