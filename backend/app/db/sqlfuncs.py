"""SQL functions that are spelled differently on SQLite and PostgreSQL, so the same query works on both."""
from sqlalchemy import Integer
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql import expression


class epoch_seconds(expression.FunctionElement):
    """Whole seconds since 1970-01-01 of a (naive UTC) timestamp column."""
    type = Integer()
    inherit_cache = True
    name = "epoch_seconds"


@compiles(epoch_seconds, "sqlite")
def _sqlite(element, compiler, **kw):
    return f"CAST(strftime('%s', {compiler.process(element.clauses, **kw)}) AS INTEGER)"


@compiles(epoch_seconds, "postgresql")
def _postgres(element, compiler, **kw):
    return f"CAST(EXTRACT(EPOCH FROM {compiler.process(element.clauses, **kw)}) AS BIGINT)"
