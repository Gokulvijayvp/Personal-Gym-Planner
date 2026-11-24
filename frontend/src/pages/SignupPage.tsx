import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthShell from "../features/auth/AuthShell";
import { validateEmail, validatePassword, validatePhone } from "../features/auth/authLogic";
import type { VerifyState } from "../features/auth/authLogic";
import { getErrorMessage } from "../services/apiError";
import { authService } from "../services/authService";

export default function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string; phone?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next = {
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password, email) ?? undefined,
      confirm: password !== confirm ? "The two passwords don't match." : undefined,
      phone: validatePhone(phone) ?? undefined,
    };
    if (next.email || next.password || next.confirm || next.phone) { setErrors(next); return; }
    setBusy(true); setErrors({});
    try {
      const clean = email.trim();
      await authService.requestSignupOtp({ email: clean, password, fullName: name.trim() || undefined, phone: phone.trim() || undefined });
      navigate("/verify", { state: { email: clean, mode: "signup" } satisfies VerifyState });
    } catch (err) {
      setErrors({ form: getErrorMessage(err) });
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1>Create Your Account</h1>
      <p className="auth-sub">Start building your fitness journey.</p>
      <form onSubmit={submit} noValidate className="auth-form">
        {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
        <div className="field">
          <label htmlFor="su-name">Full Name <span className="optional">(optional)</span></label>
          <input id="su-name" type="text" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="su-email">Email Address <span className="req" aria-hidden>*</span></label>
          <input id="su-email" type="email" inputMode="email" autoComplete="email" required placeholder="name@example.com"
            value={email} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? "su-email-err" : undefined} />
          {errors.email && <p id="su-email-err" className="auth-error" role="alert">{errors.email}</p>}
        </div>
        <div className="field">
          <label htmlFor="su-password">Password <span className="req" aria-hidden>*</span></label>
          <input id="su-password" type={show ? "text" : "password"} autoComplete="new-password" required value={password}
            onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined, confirm: undefined })); }}
            aria-invalid={!!errors.password} aria-describedby="su-password-hint" />
          {errors.password ? <p id="su-password-hint" className="auth-error" role="alert">{errors.password}</p>
            : <p id="su-password-hint" className="auth-hint">At least 8 characters. You can log in with it or with an emailed code.</p>}
        </div>
        <div className="field">
          <label htmlFor="su-confirm">Confirm Password <span className="req" aria-hidden>*</span></label>
          <input id="su-confirm" type={show ? "text" : "password"} autoComplete="new-password" required value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setErrors((x) => ({ ...x, confirm: undefined })); }}
            aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? "su-confirm-err" : undefined} />
          {errors.confirm && <p id="su-confirm-err" className="auth-error" role="alert">{errors.confirm}</p>}
          <label className="qs-radio auth-show"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /><span>Show passwords</span></label>
        </div>
        <div className="field">
          <label htmlFor="su-phone">Phone Number <span className="optional">(optional)</span></label>
          <input id="su-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone}
            onChange={(e) => { setPhone(e.target.value); setErrors((x) => ({ ...x, phone: undefined })); }}
            aria-invalid={!!errors.phone} aria-describedby="su-phone-hint" />
          {errors.phone ? <p id="su-phone-hint" className="auth-error" role="alert">{errors.phone}</p>
            : <p id="su-phone-hint" className="auth-hint">Not used yet. Reserved for a future feature.</p>}
        </div>
        <button type="submit" className="btn auth-btn" disabled={busy}>{busy ? "Please wait…" : "Create Account"}</button>
      </form>
      <p className="auth-switch">Already have an account? <Link to="/login">Login</Link></p>
    </AuthShell>
  );
}
