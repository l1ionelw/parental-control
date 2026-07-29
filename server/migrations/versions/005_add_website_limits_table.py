"""add website limits table

Revision ID: 005
Revises: 004
Create Date: 2026-07-18 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '005'
down_revision: Union[str, None] = '004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('websiteLimits',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('createdAt', sa.BigInteger(), nullable=False),
    sa.Column('updatedAt', sa.BigInteger(), nullable=False),
    sa.Column('deviceUserID', sa.Integer(), nullable=False),
    sa.Column('domain', sa.String(length=255), nullable=False),
    sa.Column('dailyLimitMinutes', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('websiteLimits')
