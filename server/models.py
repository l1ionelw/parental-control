"""
SQLAlchemy models for the parental-control server (SQLite).

Design notes (intentional):
  * No foreign keys and no indexes. Cross-table references (events.deviceUserID,
    events.appID) are plain integers resolved by manual lookup in application code.
    This keeps the SQLite file trivial to hand-edit. Indexes/constraints come later.
  * All timestamps are Unix epoch MILLISECONDS stored as BigInteger (BIGINT). A plain
    32-bit INT would overflow (~2.1e9) well below current unix-ms (~1.75e12).
  * String lengths are given so the schema also works if ported to MySQL; SQLite
    ignores them.
"""

from sqlalchemy import Column, Integer, BigInteger, String, Text
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class DeviceUser(Base):
    """A (device, OS account) pairing. Identity for manual lookup is the pair
    (deviceID, osUsername); deviceName is informational and may be updated in place."""

    __tablename__ = "deviceUser"

    id = Column(Integer, primary_key=True, autoincrement=True)
    createdAt = Column(BigInteger, nullable=False)      # unix ms
    deviceID = Column(String(64), nullable=False)       # SHA-256 hex of CPU+motherboard
    osUsername = Column(String(255), nullable=False)    # logged-in OS account running the app
    deviceName = Column(String(255), nullable=False)    # device name reported by the app (mutable)


class User(Base):
    """Standalone application/dashboard accounts. Not linked to devices or events."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    createdAt = Column(BigInteger, nullable=False)      # unix ms
    username = Column(String(255), nullable=False)
    password = Column(String(255), nullable=False)      # plaintext for now (known tech debt)
    type = Column(String(32), nullable=False)           # "Administrator" | "Standard" (validated in app code)


class Event(Base):
    """A finished focus session for one device-user on one application."""

    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    createdAt = Column(BigInteger, nullable=False)      # unix ms (row insert time)
    deviceUserID = Column(Integer, nullable=False)      # -> deviceUser.id (no FK; manual lookup)
    appID = Column(Integer, nullable=False)             # -> applications.id (no FK; manual lookup)
    startTime = Column(BigInteger, nullable=False)      # unix ms
    endTime = Column(BigInteger, nullable=False)        # unix ms


class Application(Base):
    """A distinct executable. Manual dedup key is (exeName, fileDescription, path),
    where 'path' is normalized (drive letter and C:\\Users\\<name> replaced with
    placeholders). 'allPaths' accumulates the raw real paths seen for telemetry."""

    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    createdAt = Column(BigInteger, nullable=False)      # unix ms
    exeName = Column(String(255), nullable=False)
    fileDescription = Column(String(512), nullable=False)
    path = Column(String(1024), nullable=False)         # normalized: {drive}\Users\{user}\...
    allPaths = Column(Text, nullable=False, default="") # newline-delimited raw paths (parse to list)
