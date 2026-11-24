from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.common import UtcDateTime


def _email(v: str) -> str:
    v = v.strip().lower()
    local, _, domain = v.partition("@")
    if len(v) > 254 or not local or "." not in domain or " " in v or "@" in domain:
        raise ValueError("Enter a valid email address.")
    return v


class LoginOtpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")      # an unexpected field (for example "role") is an error, never silently ignored
    email: str
    _norm = field_validator("email")(_email)


class SignupOtpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")      # an unexpected field (for example "role") is an error, never silently ignored
    email: str
    full_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=128)       # 128 also keeps the slow password hash from being used to overload the server
    _norm = field_validator("email")(_email)

    @model_validator(mode="after")
    def _password_rules(self):
        if not self.password.strip():
            raise ValueError("Choose a password that is not just spaces.")
        if self.password.strip().lower() == self.email:
            raise ValueError("The password can't be your email address.")
        return self

    @field_validator("full_name", "phone")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class VerifyOtpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")      # an unexpected field (for example "role") is an error, never silently ignored
    email: str
    code: str = Field(pattern=r"^\d{6}$")
    _norm = field_validator("email")(_email)


class PasswordLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")      # an unexpected field (for example "role") is an error, never silently ignored
    email: str
    password: str = Field(min_length=1, max_length=200)
    _norm = field_validator("email")(_email)


class OtpSent(BaseModel):
    message: str
    resend_in_seconds: int


class UserRead(BaseModel):
    id: int
    email: str
    full_name: str | None
    role: str
    created_at: UtcDateTime
    model_config = {"from_attributes": True}
