"""Sign-up collects a password: hold its hash on the pending code until the email is verified.

Revision ID: e4a5b6c7d8e9
Revises: d3f4a5b6c7d8
Create Date: 2026-11-23

* ADD COLUMN otp_codes.password_hash (nullable; no existing data changes)
"""
from alembic import op
import sqlalchemy as sa

revision = "e4a5b6c7d8e9"
down_revision = "d3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("otp_codes", sa.Column("password_hash", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("otp_codes") as batch:
        batch.drop_column("password_hash")
