import { ApiError } from "./apiError";
import { api } from "./client";
import { setSession } from "../features/auth/session";
import type { SessionUser } from "../features/auth/session";

/**
 * Talks to the FastAPI auth endpoints. The session lives in an httpOnly cookie set by the server: this code never
 * sees it, and the browser sends it automatically with every request. Nothing secret is kept in localStorage.
 */
export interface SignupInput { email: string; password: string; fullName?: string; phone?: string }
export interface OtpSent { message: string; resend_in_seconds: number }

export const authService = {
  requestLoginOtp: (email: string) => api.post<OtpSent>("/auth/login/request-otp", { email }),
  requestSignupOtp: (input: SignupInput) =>
    api.post<OtpSent>("/auth/signup/request-otp", { email: input.email, password: input.password, full_name: input.fullName, phone: input.phone }),
  /** Another code for a sign-up already started. The password stays on the server, so it is not sent again. */
  resendSignupOtp: (email: string) => api.post<OtpSent>("/auth/signup/resend-otp", { email }),
  verifyOtp: (email: string, code: string) => api.post<SessionUser>("/auth/verify-otp", { email, code }),
  loginWithPassword: (email: string, password: string) => api.post<SessionUser>("/auth/login/password", { email, password }),
  logout: () => api.post<void>("/auth/logout"),
  /** The signed-in user, or null when nobody is (a 401). */
  me: async (): Promise<SessionUser | null> => {
    try { return await api.get<SessionUser>("/auth/me"); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
  },
};

/** Called once at startup: ask the server who is signed in, then let the route guards decide. */
export async function initSession(): Promise<void> {
  try { setSession(await authService.me()); } catch { setSession(null); }
}
