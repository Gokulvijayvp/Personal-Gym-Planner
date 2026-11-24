export const OTP_LENGTH = 6;
export const RESEND_SECONDS = 60;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Returns an error message, or null when the email looks valid. */
export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter your email address.";
  if (!EMAIL.test(v)) return "Enter a valid email address, like name@example.com.";
  return null;
}

/** Phone is optional (a future feature): empty is fine, otherwise 7-15 digits with optional + and separators. */
export function validatePhone(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const digits = v.replace(/[\s\-().]/g, "");
  return /^\+?\d{7,15}$/.test(digits) ? null : "Enter a valid phone number or leave it empty.";
}

export type VerifyMode = "login" | "signup";
export interface VerifyState { email: string; mode: VerifyMode }

export const MIN_PASSWORD = 8;

/** Rules match the server: 8-128 characters, not just spaces, not the email address. Returns a message or null. */
export function validatePassword(value: string, email: string): string | null {
  if (!value) return "Choose a password.";
  if (value.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (value.length > 128) return "Use 128 characters or fewer.";
  if (!value.trim()) return "The password can't be just spaces.";
  if (value.trim().toLowerCase() === email.trim().toLowerCase()) return "The password can't be your email address.";
  return null;
}
