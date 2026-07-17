import json
import re
import threading
import time

from db import SessionLocal
from models import Application, Event

_cache = []
_cache_lock = threading.Lock()
_loaded = False


def get_all_apps():
    with _cache_lock:
        return list(_cache)


def get_app_by_id(app_id):
    with _cache_lock:
        for app in _cache:
            if app.id == app_id:
                return app
    return None

# %userprofile%\... and everything under it (%appdata%, %localappdata%, etc. are
# all subfolders of %userprofile%) - varies by drive letter and by OS username.
_USER_PATH_PATTERN = re.compile(r"^[A-Za-z]:\\Users\\[^\\]+", re.IGNORECASE)
# %programdata% - not under \Users, but still varies by drive letter.
_PROGRAMDATA_PATTERN = re.compile(r"^[A-Za-z]:\\ProgramData\\", re.IGNORECASE)


def _now_ms():
    return int(time.time() * 1000)


def _normalize_path(raw_path):
    if _USER_PATH_PATTERN.match(raw_path):
        return _USER_PATH_PATTERN.sub(r"{drive}\\Users\\{user}", raw_path)
    if _PROGRAMDATA_PATTERN.match(raw_path):
        return _PROGRAMDATA_PATTERN.sub(r"{drive}\\ProgramData\\", raw_path)
    return raw_path


def load_applications():
    global _loaded
    session = SessionLocal()
    try:
        rows = session.query(Application).order_by(Application.exeName).all()
        with _cache_lock:
            _cache.clear()
            _cache.extend(rows)
            _loaded = True
        print(f"[app_tracker] loaded {len(rows)} applications")
    finally:
        session.close()


def _reload_cache():
    session = SessionLocal()
    try:
        rows = session.query(Application).order_by(Application.exeName).all()
        with _cache_lock:
            _cache.clear()
            _cache.extend(rows)
    finally:
        session.close()


def update_application_table(exe_name, file_description, raw_path):
    """Upsert the Application row for (exe_name, file_description, normalized path),
    refresh the in-memory cache, and return the row's id (None if exe_name is empty)."""
    if not exe_name:
        return None

    normalized = _normalize_path(raw_path) if raw_path else ""

    with _cache_lock:
        existing = None
        for app in _cache:
            if (
                app.exeName == exe_name
                and app.fileDescription == (file_description or "")
                and app.path == normalized
            ):
                existing = app
                break

    if existing is None:
        session = SessionLocal()
        try:
            app = Application(
                createdAt=_now_ms(),
                exeName=exe_name,
                fileDescription=file_description or "",
                path=normalized,
                allPaths=json.dumps([raw_path]) if raw_path else "[]",
            )
            session.add(app)
            session.commit()
            session.refresh(app)
            app_id = app.id
            print(f"[app_tracker] added new application: {exe_name}")
        finally:
            session.close()

        _reload_cache()
        return app_id
    else:
        app_id = existing.id

        if not raw_path:
            return app_id

        try:
            paths = json.loads(existing.allPaths) if existing.allPaths else []
        except (json.JSONDecodeError, TypeError):
            paths = []

        if raw_path in paths:
            return app_id

        paths.append(raw_path)
        session = SessionLocal()
        try:
            session.query(Application).filter(Application.id == existing.id).update(
                {"allPaths": json.dumps(paths)}
            )
            session.commit()
            print(f"[app_tracker] updated allPaths for {exe_name}")
        finally:
            session.close()

        _reload_cache()
        return app_id


def record_event(device_user_id, app_id, start_time, end_time):
    """Insert a finished focus-session row (see models.Event)."""
    if device_user_id is None or app_id is None:
        return

    session = SessionLocal()
    try:
        session.add(
            Event(
                createdAt=_now_ms(),
                deviceUserID=device_user_id,
                appID=app_id,
                startTime=start_time,
                endTime=end_time,
            )
        )
        session.commit()
    finally:
        session.close()


load_applications()
