"""Share codes: 10 random characters from an alphabet without look-alikes (no 0/O/1/I), shown as XXXXX-XXXXX."""
import secrets

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 10                     # 32^10 = 50 bits: unguessable, and lookups are rate limited as well
SHARE_DAYS = 30


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def pretty(code: str) -> str:
    return f"{code[:5]}-{code[5:]}"


def normalise(code: str) -> str:
    """Case, spaces and dashes do not matter when someone types or pastes a code."""
    return "".join(ch for ch in code.upper() if ch.isalnum())
