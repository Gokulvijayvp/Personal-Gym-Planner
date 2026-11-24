"""Token and code helpers. Nothing here touches the database."""
import base64
import hashlib
import hmac
import secrets

from app.core.config import settings


def new_otp() -> str:
    """Six random digits from the OS secure generator."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(email: str, code: str) -> str:
    """Keyed hash: six digits are guessable, so a plain hash could be brute-forced if the DB ever leaked."""
    return hmac.new(settings.secret_key.encode(), f"otp:{email}:{code}".encode(), hashlib.sha256).hexdigest()


def new_token() -> str:
    """A random, unguessable value for the session cookie or the CSRF token (256 bits)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Only this hash is stored. The tokens are already random, so a plain SHA-256 is enough."""
    return hashlib.sha256(token.encode()).hexdigest()


def same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# --- passwords: scrypt (memory-hard, standard library), a random salt per password, constant-time comparison ---
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"scrypt${_N}${_R}${_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    """False for no/odd hash. Always does the same amount of work so timing does not reveal whether an account exists."""
    try:
        _, n, r, p, salt, digest = (stored or DUMMY_HASH).split("$")
        calc = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(digest)) and stored is not None
    except (ValueError, TypeError):
        return False


DUMMY_HASH = hash_password(secrets.token_urlsafe(16))      # compared against when the account has no password
