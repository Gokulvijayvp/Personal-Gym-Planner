from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CSRF_COOKIE, SESSION_COOKIE, get_current_session, get_current_user
from app.core import rate_limit, security
from app.core.config import settings
from app.db.session import get_db
from app.models.user import AuthSession, User
from app.schemas.auth import LoginOtpRequest, OtpSent, PasswordLoginRequest, SignupOtpRequest, UserRead, VerifyOtpRequest
from app.services import auth_service as service

router = APIRouter(prefix="/auth", tags=["Authentication"])

SENT = "If this email can sign in, we sent a 6-digit code to it."


def _cookie_args() -> dict:
    return {"secure": settings.cookie_secure, "samesite": settings.cookie_samesite, "path": "/", "max_age": settings.session_max_days * 86400}


def _set_cookies(response: Response, session_token: str, csrf_token: str) -> None:
    response.set_cookie(SESSION_COOKIE, session_token, httponly=True, **_cookie_args())      # JavaScript can never read this one
    response.set_cookie(CSRF_COOKIE, csrf_token, httponly=False, **_cookie_args())           # readable on purpose: the page copies it into a header


def _clear_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _throttle_otp_request(request: Request, email: str) -> None:
    rate_limit.hit(f"otp-ip:{rate_limit.client_ip(request)}", settings.rate_otp_request_per_ip_hour, 3600)
    rate_limit.hit(f"otp-email:{email}", settings.rate_otp_request_per_email_hour, 3600, "Too many codes requested for this email. Try again later.")


@router.post("/signup/request-otp", response_model=OtpSent)
def signup_request_otp(data: SignupOtpRequest, request: Request, db: Session = Depends(get_db)) -> OtpSent:
    _throttle_otp_request(request, data.email)
    wait = service.request_otp(db, "signup", data.email, data.full_name, data.phone, data.password)
    return OtpSent(message=SENT, resend_in_seconds=wait)


@router.post("/signup/resend-otp", response_model=OtpSent)
def signup_resend_otp(data: LoginOtpRequest, request: Request, db: Session = Depends(get_db)) -> OtpSent:
    """Another code for a sign-up already started (the password stays on the server)."""
    _throttle_otp_request(request, data.email)
    return OtpSent(message=SENT, resend_in_seconds=service.resend_signup_otp(db, data.email))


@router.post("/login/request-otp", response_model=OtpSent)
def login_request_otp(data: LoginOtpRequest, request: Request, db: Session = Depends(get_db)) -> OtpSent:
    _throttle_otp_request(request, data.email)
    wait = service.request_otp(db, "login", data.email)
    return OtpSent(message=SENT, resend_in_seconds=wait)


@router.post("/verify-otp", response_model=UserRead)
def verify_otp(data: VerifyOtpRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    rate_limit.hit(f"verify-ip:{rate_limit.client_ip(request)}", settings.rate_verify_per_ip_15min, 900)
    rate_limit.hit(f"verify-email:{data.email}", settings.rate_verify_per_email_15min, 900, "Too many tries. Wait a few minutes and ask for a new code.")
    login = service.verify_otp(db, data.email, data.code, request.headers.get("user-agent"))
    _set_cookies(response, login.session_token, login.csrf_token)
    return login.user


@router.post("/login/password", response_model=UserRead)
def login_password(data: PasswordLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    rate_limit.hit(f"pw-ip:{rate_limit.client_ip(request)}", settings.rate_password_per_ip_15min, 900)
    rate_limit.hit(f"pw-email:{data.email}", settings.rate_password_per_email_15min, 900, "Too many sign-in attempts. Wait 15 minutes and try again.")
    login = service.login_with_password(db, data.email, data.password, request.headers.get("user-agent"))
    _set_cookies(response, login.session_token, login.csrf_token)
    return login.user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    """Open on purpose (a signed-out browser may call it); it only ever ends the session named by the caller's own cookie.
    The Origin check in the app middleware stops other sites from forcing it."""
    service.logout(db, request.cookies.get(SESSION_COOKIE))
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_cookies(out)
    return out


@router.get("/me", response_model=UserRead)
def me(request: Request, response: Response, user: User = Depends(get_current_user),
       session: AuthSession = Depends(get_current_session), db: Session = Depends(get_db)) -> User:
    """Who am I? Also repairs a missing CSRF cookie so a signed-in browser can always write again."""
    cookie = request.cookies.get(CSRF_COOKIE, "")
    if not cookie or not security.same(security.hash_token(cookie), session.csrf_hash):
        response.set_cookie(CSRF_COOKIE, service.reissue_csrf(db, session), httponly=False, **_cookie_args())
    return user
