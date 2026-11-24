// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { validateEmail, validatePhone } from "../features/auth/authLogic";
import { clearSession, getSession, resetSession, setSession } from "../features/auth/session";
import { authService } from "../services/authService";
import { ApiError } from "../services/apiError";

vi.mock("../services/authService", () => ({
  authService: { requestLoginOtp: vi.fn(), requestSignupOtp: vi.fn(), resendSignupOtp: vi.fn(), verifyOtp: vi.fn(), loginWithPassword: vi.fn(), logout: vi.fn(), me: vi.fn() },
  initSession: vi.fn(),
}));
vi.mock("./HomePage", () => ({ default: () => <h1>Home page</h1> }));
vi.mock("./SettingsPage", () => ({ default: () => <h1>Settings page</h1> }));

const auth = vi.mocked(authService);
const USER = { id: 1, email: "me@example.com", full_name: null };
const go = (path: string, state?: unknown) =>
  render(<MemoryRouter initialEntries={[{ pathname: path, state }]}><App /></MemoryRouter>);
const boxes = () => screen.getAllByRole("textbox", { name: /Digit \d/ }) as HTMLInputElement[];
const code = () => boxes().map((b) => b.value).join("");

beforeEach(() => {
  setSession(null);                                   // signed out unless a test signs in
  auth.requestLoginOtp.mockResolvedValue({ message: "sent", resend_in_seconds: 60 });
  auth.requestSignupOtp.mockResolvedValue({ message: "sent", resend_in_seconds: 60 });
  auth.resendSignupOtp.mockResolvedValue({ message: "sent", resend_in_seconds: 60 });
  auth.logout.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); resetSession(); });

describe("validation helpers", () => {
  it("checks email and optional phone", () => {
    expect(validateEmail("")).toMatch(/Enter your email/);
    expect(validateEmail("nope")).toMatch(/valid email/);
    expect(validateEmail(" a@b.co ")).toBeNull();
    expect(validatePhone("")).toBeNull();
    expect(validatePhone("+91 98765-43210")).toBeNull();
    expect(validatePhone("12")).toMatch(/valid phone/);
  });
});

describe("Login page", () => {
  it("renders and links to Sign Up", async () => {
    go("/login");
    expect(screen.getByRole("heading", { name: "Welcome Back" })).toBeTruthy();
    expect(screen.getByText("Continue your fitness journey.")).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "Sign Up" }));
    expect(await screen.findByRole("heading", { name: "Create Your Account" })).toBeTruthy();
  });

  it("shows a message for a bad email and does not move on", async () => {
    go("/login");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Email" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Enter your email/);
    await userEvent.type(screen.getByLabelText("Email Address"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Email" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/valid email/);
    expect(auth.requestLoginOtp).not.toHaveBeenCalled();
  });

  it("goes to the OTP screen with a valid email", async () => {
    go("/login");
    await userEvent.type(screen.getByLabelText("Email Address"), "me@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Email" }));
    expect(await screen.findByRole("heading", { name: "Verify Your Email" })).toBeTruthy();
    expect(screen.getByText("me@example.com")).toBeTruthy();
    expect(auth.requestLoginOtp).toHaveBeenCalledWith("me@example.com");
  });

  it("shows the server's message when there is no such account", async () => {
    auth.requestLoginOtp.mockRejectedValue(new ApiError({ kind: "client", status: 404, message: "No account found for this email. Sign up first." }));
    go("/login");
    await userEvent.type(screen.getByLabelText("Email Address"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Email" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No account found/);
    expect(screen.queryByRole("heading", { name: "Verify Your Email" })).toBeNull();
  });
});

describe("Login with a password", () => {
  it("is optional: the emailed code stays the default", () => {
    go("/login");
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with Email" })).toBeTruthy();
  });

  it("signs in with email and password and goes to Home", async () => {
    auth.loginWithPassword.mockResolvedValue(USER);
    go("/login");
    await userEvent.click(screen.getByRole("button", { name: "Use a password instead" }));
    await userEvent.type(screen.getByLabelText("Email Address"), "me@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("heading", { name: "Home page" })).toBeTruthy();
    expect(auth.loginWithPassword).toHaveBeenCalledWith("me@example.com", "secret-pass");
    expect(auth.requestLoginOtp).not.toHaveBeenCalled();
    expect(getSession().status).toBe("in");
  });

  it("asks for the password and shows the server's error for a wrong one", async () => {
    auth.loginWithPassword.mockRejectedValue(new ApiError({ kind: "client", status: 401, message: "Incorrect email or password." }));
    go("/login");
    await userEvent.click(screen.getByRole("button", { name: "Use a password instead" }));
    await userEvent.type(screen.getByLabelText("Email Address"), "me@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Enter your password/);
    await userEvent.type(screen.getByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Incorrect email or password/);
    expect(getSession().status).toBe("out");
  });

  it("can switch back to the emailed code", async () => {
    go("/login");
    await userEvent.click(screen.getByRole("button", { name: "Use a password instead" }));
    await userEvent.click(screen.getByRole("button", { name: "Use an emailed code instead" }));
    expect(screen.queryByLabelText("Password")).toBeNull();
  });
});

const fillSignup = async (email = "me@example.com", pw = "a-strong-password", confirm = pw) => {
  await userEvent.type(screen.getByLabelText(/Email Address/), email);
  await userEvent.type(screen.getByLabelText(/^Password/), pw);
  await userEvent.type(screen.getByLabelText(/Confirm Password/), confirm);
};

describe("Sign up page", () => {
  it("renders, asks for email and password, and links to Login", async () => {
    go("/signup");
    expect(screen.getByRole("heading", { name: "Create Your Account" })).toBeTruthy();
    expect(screen.getByLabelText(/^Password/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent).join(" ")).toMatch(/Enter your email.*Choose a password/);
    await userEvent.click(screen.getByRole("link", { name: "Login" }));
    expect(await screen.findByRole("heading", { name: "Welcome Back" })).toBeTruthy();
  });

  it("checks password length, matching, and not being the email", async () => {
    go("/signup");
    await fillSignup("me@example.com", "short", "short");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect((await screen.findByText(/at least 8 characters/i, { selector: "p[role=alert]" })).textContent).toMatch(/8/);
    await userEvent.clear(screen.getByLabelText(/^Password/)); await userEvent.clear(screen.getByLabelText(/Confirm Password/));
    await userEvent.type(screen.getByLabelText(/^Password/), "long-enough-pw");
    await userEvent.type(screen.getByLabelText(/Confirm Password/), "different-pw");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect((await screen.findByText(/don't match/)).textContent).toMatch(/match/);
    await userEvent.clear(screen.getByLabelText(/^Password/)); await userEvent.clear(screen.getByLabelText(/Confirm Password/));
    await userEvent.type(screen.getByLabelText(/^Password/), "me@example.com"); await userEvent.type(screen.getByLabelText(/Confirm Password/), "me@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect((await screen.findByText(/can't be your email/)).textContent).toMatch(/email/);
    expect(auth.requestSignupOtp).not.toHaveBeenCalled();
  });

  it("can show the typed passwords", async () => {
    go("/signup");
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).type).toBe("password");
    await userEvent.click(screen.getByLabelText("Show passwords"));
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).type).toBe("text");
  });

  it("rejects a bad phone but accepts an empty one, then sends the password and moves to the code screen", async () => {
    go("/signup");
    await fillSignup();
    await userEvent.type(screen.getByLabelText(/Phone Number/), "12");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect((await screen.findByText(/valid phone/)).textContent).toMatch(/phone/);
    await userEvent.clear(screen.getByLabelText(/Phone Number/));
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect(await screen.findByRole("heading", { name: "Verify Your Email" })).toBeTruthy();
    expect(auth.requestSignupOtp).toHaveBeenCalledWith({ email: "me@example.com", password: "a-strong-password", fullName: undefined, phone: undefined });
  });

  it("shows the server's message when sign-ups are closed", async () => {
    auth.requestSignupOtp.mockRejectedValue(new ApiError({ kind: "client", status: 403, message: "Sign-ups are closed. This is a private app." }));
    go("/signup");
    await fillSignup();
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect((await screen.findByText(/Sign-ups are closed/)).textContent).toMatch(/private/);
  });
});

describe("OTP screen", () => {
  const open = () => go("/verify", { email: "me@example.com", mode: "login" });

  it("sends people without an email back to Login", () => {
    go("/verify");
    expect(screen.getByRole("heading", { name: "Welcome Back" })).toBeTruthy();
  });

  it("moves forward as you type, and Backspace goes back", async () => {
    open();
    await userEvent.keyboard("123");
    expect(code()).toBe("123");
    expect(document.activeElement).toBe(boxes()[3]);
    await userEvent.keyboard("{Backspace}");
    expect(code()).toBe("12");
    expect(document.activeElement).toBe(boxes()[2]);
  });

  it("ignores letters", async () => {
    open();
    await userEvent.keyboard("a1b2");
    expect(code()).toBe("12");
  });

  it("fills every box when a full code is pasted", async () => {
    open();
    boxes()[0].focus();
    await userEvent.paste("654321");
    expect(code()).toBe("654321");
  });

  it("asks for all six digits", async () => {
    open();
    await userEvent.keyboard("12");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/all 6 digits/);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("signs in and goes to the existing Home page when the code is accepted", async () => {
    auth.verifyOtp.mockResolvedValue(USER);
    open();
    boxes()[0].focus();
    await userEvent.paste("123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("heading", { name: "Home page" })).toBeTruthy();
    expect(auth.verifyOtp).toHaveBeenCalledWith("me@example.com", "123456");
    expect(getSession()).toEqual({ status: "in", user: USER });
  });

  it("shows the server's error and clears the boxes when the code is rejected", async () => {
    auth.verifyOtp.mockRejectedValue(new ApiError({ kind: "client", status: 400, message: "That code isn't right. Check it and try again." }));
    open();
    boxes()[0].focus();
    await userEvent.paste("000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/isn't right/);
    await waitFor(() => expect(code()).toBe(""));
    expect(getSession().status).toBe("out");
  });

  it("counts down 60 seconds before Resend appears, then restarts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open();
    expect(screen.getByText("0:60")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend OTP" })).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    fireEvent.click(await screen.findByRole("button", { name: "Resend OTP" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/new code/);
    expect(auth.requestLoginOtp).toHaveBeenCalledWith("me@example.com");
    expect(screen.getByText("0:60")).toBeTruthy();
  });

  it("resends a sign-up code without needing the password again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    go("/verify", { email: "me@example.com", mode: "signup" });
    await vi.advanceTimersByTimeAsync(60_000);
    fireEvent.click(await screen.findByRole("button", { name: "Resend OTP" }));
    await screen.findByRole("status");
    expect(auth.resendSignupOtp).toHaveBeenCalledWith("me@example.com");
    expect(auth.requestSignupOtp).not.toHaveBeenCalled();
  });

  it("lets you change the email", async () => {
    go("/verify", { email: "me@example.com", mode: "signup" });
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(await screen.findByRole("heading", { name: "Create Your Account" })).toBeTruthy();
  });
});

describe("staying signed in (the server cookie decides)", () => {
  it("waits for the server's answer instead of flashing Login", () => {
    resetSession();                                     // still asking /auth/me
    go("/workout");
    expect(screen.getByRole("status", { name: "Checking your sign-in" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Welcome Back" })).toBeNull();
  });

  it("skips Login and Sign up when the server recognises the cookie", async () => {
    setSession(USER);                                   // what initSession does when /auth/me answers with a user
    go("/login");
    expect(await screen.findByRole("heading", { name: "Home page" })).toBeTruthy();
    cleanup();
    go("/signup");
    expect(await screen.findByRole("heading", { name: "Home page" })).toBeTruthy();
  });

  it("sends a signed-out visitor to Login from any app page", () => {
    go("/workout");
    expect(screen.getByRole("heading", { name: "Welcome Back" })).toBeTruthy();
  });

  it("drops to Login when the session ends while using the app", async () => {
    setSession(USER);
    go("/");
    expect(screen.getByRole("heading", { name: "Home page" })).toBeTruthy();
    clearSession();                                     // the API client does this after a failed token refresh
    expect(await screen.findByRole("heading", { name: "Welcome Back" })).toBeTruthy();
  });
});

describe("log out", () => {
  it("ends the login on the server and returns to Login", async () => {
    setSession(USER);
    go("/");
    await userEvent.click(screen.getAllByRole("button", { name: /Log out/ })[0]);
    expect(await screen.findByRole("heading", { name: "Welcome Back" })).toBeTruthy();
    expect(auth.logout).toHaveBeenCalled();
    expect(getSession().status).toBe("out");
  });

  it("still signs out here when the server cannot be reached", async () => {
    auth.logout.mockRejectedValue(new Error("offline"));
    setSession(USER);
    go("/");
    await userEvent.click(screen.getAllByRole("button", { name: /Log out/ })[0]);
    expect(await screen.findByRole("heading", { name: "Welcome Back" })).toBeTruthy();
  });
});

describe("Settings is for every signed-in user", () => {
  it("opens for the admin", () => {
    setSession({ ...USER, role: "admin" });
    go("/settings");
    expect(screen.getByRole("heading", { name: "Settings page" })).toBeTruthy();
  });

  it("opens for a normal user too (their own preferences)", () => {
    setSession({ ...USER, role: "user" });
    go("/settings");
    expect(screen.getByRole("heading", { name: "Settings page" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Settings" }).length).toBeGreaterThan(0);
  });

  it("still needs a sign-in", () => {
    go("/settings");
    expect(screen.getByRole("heading", { name: "Welcome Back" })).toBeTruthy();
  });
});

describe("existing routes", () => {
  it("still serves Home when signed in", () => {
    setSession(USER);
    go("/");
    expect(screen.getByRole("heading", { name: "Home page" })).toBeTruthy();
  });
});
