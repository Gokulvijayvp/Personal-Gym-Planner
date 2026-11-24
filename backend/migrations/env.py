from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
from app.core.config import settings
from app.db.session import normalise_url
from app.db.base import Base
from app.models import *  # noqa: F401,F403

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
DB_URL = normalise_url(settings.database_url)
config.set_main_option("sqlalchemy.url", DB_URL.replace("%", "%%"))
target_metadata = Base.metadata

def include_object(obj, name, type_, reflected, compare_to):
    """SQLite cannot reflect the ON DELETE option of a column added in place, so comparing the owner-column foreign keys there
    would report a difference that is not real. PostgreSQL reports them fully and is compared as normal."""
    if DB_URL.startswith("sqlite") and type_ == "foreign_key_constraint" and list(obj.column_keys) == ["user_id"]:
        return False
    return True


def run_migrations_offline():
    context.configure(
        url=DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_object,
        render_as_batch=DB_URL.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
