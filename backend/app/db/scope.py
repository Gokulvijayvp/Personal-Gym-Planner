"""Per-user data isolation, enforced below the application code.

Every request for private data runs on a database session that carries the signed-in user's id
(`session.info["user_id"]`, set by `get_current_user`). From then on:

* every SELECT / UPDATE / DELETE touching an owned table (a model with `OwnedMixin`) gets `AND user_id = <me>` added
  automatically, including lazy loads, joins and aggregates, so one user can never read, change or delete another
  user's rows even if a route forgets to check, or an id from another account is guessed;
* every new row of an owned table gets `user_id` filled in from the session.

A session without a user id (sign-in code, migrations, tests of internals) is unscoped. All private routes get a scoped
session from the router-level `get_current_user` dependency. A statement can opt out with
`execution_options(unscoped=True)` (used only where a system-wide number is needed).
"""
from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.db.base import Base
from app.models.ownership import OwnedMixin

USER_KEY = "user_id"
_owned: list[type] | None = None


def owned_models() -> list[type]:
    global _owned
    if _owned is None:
        _owned = [m.class_ for m in Base.registry.mappers if issubclass(m.class_, OwnedMixin)]
    return _owned


@event.listens_for(Session, "do_orm_execute")
def _filter_to_current_user(state) -> None:
    uid = state.session.info.get(USER_KEY)
    if uid is None or state.execution_options.get("unscoped"):
        return
    if state.is_column_load or state.is_relationship_load:        # lazy loads inherit the criteria from the statement that loaded the parent
        return
    if state.is_select or state.is_update or state.is_delete:
        stmt = state.statement
        for model in owned_models():
            stmt = stmt.options(with_loader_criteria(model, model.user_id == uid, include_aliases=True))
        state.statement = stmt


@event.listens_for(Session, "before_flush")
def _stamp_new_rows(session: Session, flush_context, instances) -> None:
    uid = session.info.get(USER_KEY)
    if uid is None:
        return
    for obj in session.new:
        if isinstance(obj, OwnedMixin) and obj.user_id is None:
            obj.user_id = uid
