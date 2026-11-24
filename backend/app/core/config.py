import re
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


class Settings(BaseSettings):
    app_name: str = "Personal Gym Planner API"
    app_env: str = "development"
    app_debug: bool = True
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./data/gym_planner.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    timezone: str = "Asia/Kolkata"
    media_dir: str | None = None   # where uploaded pictures/videos live; default: "media" next to the database file
    # --- authentication: email code + server-side session in an httpOnly cookie ---
    secret_key: str = "dev-only-change-me-dev-only-change-me"   # keys the OTP hashes and CSRF tokens: set a long random value in production
    session_days: int = 30             # idle lifetime: every use renews it
    session_max_days: int = 180        # absolute lifetime: after this the owner signs in again
    otp_minutes: int = 5               # how long an emailed code works (the email says so)
    otp_resend_seconds: int = 60
    otp_max_attempts: int = 5
    cookie_secure: bool = False        # must be True in production (HTTPS only)
    cookie_samesite: str = "lax"
    email_backend: str = "console"     # "resend" sends real email; "console" only logs the code (development only)
    resend_api_key: str | None = None      # secret: server-side only, never sent to the frontend or logged
    resend_from_email: str | None = None   # e.g. "Gym Planner <no-reply@your-domain>"
    # --- the one permanent Admin ---
    admin_email: str | None = None     # ONLY this email can ever hold the Admin role. Required in production.
    # --- rate limits (per IP only flood protection; the per-email and per-code limits are what protect accounts) ---
    rate_otp_request_per_ip_hour: int = 60
    rate_otp_request_per_email_hour: int = 5
    rate_verify_per_ip_15min: int = 150
    rate_verify_per_email_15min: int = 15
    rate_password_per_ip_15min: int = 100
    rate_password_per_email_15min: int = 5
    trust_proxy: bool = False          # True only behind your own reverse proxy: then X-Forwarded-For gives the client IP
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def admin_email_normalised(self) -> str | None:
        v = (self.admin_email or "").strip().lower()
        return v or None

    def admin_email_problem(self) -> str | None:
        """None when ADMIN_EMAIL is set to a valid address, otherwise what is wrong."""
        v = self.admin_email_normalised
        if v is None:
            return "ADMIN_EMAIL is not set"
        if len(v) > 254 or not _EMAIL.match(v):
            return "ADMIN_EMAIL is not a valid email address"
        return None

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [x.strip().rstrip("/") for x in self.cors_origins.split(",") if x.strip()]
        if "*" in origins:       # a wildcard with credentials would let any website use the owner's cookie
            raise RuntimeError("CORS_ORIGINS must list exact origins, never '*'.")
        return origins

    def check_production(self) -> None:
        """Refuse to start a production server with development-grade secrets or insecure cookies."""
        if not self.is_production:
            return
        problems = []
        if self.secret_key.startswith(("dev-only", "change-me")) or len(self.secret_key) < 32:
            problems.append("SECRET_KEY must be a random string of at least 32 characters")
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE must be true (HTTPS only)")
        if self.app_debug:
            problems.append("APP_DEBUG must be false")
        if self.email_backend.lower() != "resend":
            problems.append("EMAIL_BACKEND must be 'resend' (sign-in codes have to be emailed)")
        elif not (self.resend_api_key and self.resend_from_email):
            problems.append("RESEND_API_KEY and RESEND_FROM_EMAIL must be set")
        problem = self.admin_email_problem()
        if problem:
            problems.append(f"{problem} (set it to the one Admin's email address)")
        if problems:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(problems) + ".")

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
