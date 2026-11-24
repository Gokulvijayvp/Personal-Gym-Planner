import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import AuthShell from "../features/auth/AuthShell";
import OtpInput from "../features/auth/OtpInput";
import { OTP_LENGTH, RESEND_SECONDS } from "../features/auth/authLogic";
import type { VerifyState } from "../features/auth/authLogic";
import { getErrorMessage } from "../services/apiError";
import { setSession } from "../features/auth/session";
import { authService } from "../services/authService";

/** One screen for both Login and Sign up. */
export default function VerifyOtpPage() {
  const state = useLocation().state as VerifyState | null;
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  if (!state?.email) return <Navigate to="/login" replace />;
  const { email, mode } = state;
  const back = mode === "signup" ? "/signup" : "/login";

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (code.length < OTP_LENGTH) { setError(`Enter all ${OTP_LENGTH} digits.`); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const user = await authService.verifyOtp(email, code);
      setSession(user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
      setCode("");
      setBusy(false);
    }
  }

  async function resend() {
    if (left > 0 || busy) return;
    setError(null); setNotice(null);
    try {
      await (mode === "signup" ? authService.resendSignupOtp(email) : authService.requestLoginOtp(email));
      setCode(""); setLeft(RESEND_SECONDS);
      setNotice("A new code is on its way. Check your email.");
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <AuthShell>
      <h1>Verify Your Email</h1>
      <p className="auth-sub">Enter the 6-digit verification code sent to your email address.</p>
      <p className="auth-email">
        <b>{email}</b>
        <button type="button" className="auth-link" onClick={() => navigate(back, { replace: true })}>Change email</button>
      </p>
      <form onSubmit={verify} noValidate className="auth-form">
        <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} disabled={busy} invalid={!!error} describedBy="otp-msg" />
        <div id="otp-msg" aria-live="polite">
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-ok" role="status">{notice}</p>}
        </div>
        <button type="submit" className="btn auth-btn" disabled={busy}>{busy ? "Verifying…" : "Verify"}</button>
      </form>
      <p className="auth-switch">
        {left > 0 ? <>Resend code in <b>0:{String(left).padStart(2, "0")}</b></>
          : <button type="button" className="auth-link" onClick={resend}>Resend OTP</button>}
      </p>
    </AuthShell>
  );
}
