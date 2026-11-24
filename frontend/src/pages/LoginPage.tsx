import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthShell from "../features/auth/AuthShell";
import { validateEmail } from "../features/auth/authLogic";
import type { VerifyState } from "../features/auth/authLogic";
import { getErrorMessage } from "../services/apiError";
import { setSession } from "../features/auth/session";
import { authService } from "../services/authService";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = validateEmail(email);
    if (problem) { setError(problem); return; }
    if (usePassword && !password) { setError("Enter your password."); return; }
    setBusy(true); setError(null);
    try {
      const clean = email.trim();
      if (usePassword) {
        setSession(await authService.loginWithPassword(clean, password));      // the server sets the httpOnly cookie
        navigate("/", { replace: true });
        return;
      }
      await authService.requestLoginOtp(clean);
      navigate("/verify", { state: { email: clean, mode: "login" } satisfies VerifyState });
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1>Welcome Back</h1>
      <p className="auth-sub">Continue your fitness journey.</p>
      <form onSubmit={submit} noValidate className="auth-form">
        <div className="field">
          <label htmlFor="login-email">Email Address</label>
          <input id="login-email" type="email" inputMode="email" autoComplete="email" autoFocus placeholder="name@example.com"
            value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }}
            aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} />
          {error && <p id="login-error" className="auth-error" role="alert">{error}</p>}
        </div>
        {usePassword && (
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }} />
          </div>
        )}
        <button type="submit" className="btn auth-btn" disabled={busy}>
          {busy ? "Please wait…" : usePassword ? "Log in" : "Continue with Email"}
        </button>
        <button type="button" className="auth-link auth-alt" onClick={() => { setUsePassword((v) => !v); setPassword(""); setError(null); }}>
          {usePassword ? "Use an emailed code instead" : "Use a password instead"}
        </button>
      </form>
      <p className="auth-switch">Don't have an account? <Link to="/signup">Sign Up</Link></p>
    </AuthShell>
  );
}
