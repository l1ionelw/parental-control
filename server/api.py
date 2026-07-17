"""REST API blueprint, mounted at /api.

Endpoints:
  POST /api/register  -> create a Standard account, returns a JWT (auto-login)
  POST /api/login     -> validate credentials, returns a JWT
  GET  /api/devices   -> (protected) list device-users
  GET  /api/apps      -> (protected) list all known applications

New accounts are always type "Standard"; promote to "Administrator" by editing
the DB directly during development.
"""

import json
import time

from flask import Blueprint, request, jsonify, g

from db import SessionLocal
from models import User, DeviceUser, Application, Event, AppLimit, Downtime
from auth import create_jwt_token, login_required, admin_required

api = Blueprint("api", __name__)


def now_ms():
    return int(time.time() * 1000)


def user_public(u):
    return {"id": u.id, "username": u.username, "type": u.type, "createdAt": u.createdAt}


def device_public(d):
    return {
        "id": d.id,
        "deviceName": d.deviceName,
        "osUsername": d.osUsername,
        "deviceID": d.deviceID,
        "createdAt": d.createdAt,
    }


@api.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "username and password are required"}), 400

    session = SessionLocal()
    try:
        if session.query(User).filter(User.username == username).first():
            return jsonify({"error": "username already taken"}), 409

        user = User(
            createdAt=now_ms(),
            username=username,
            password=password,   # plaintext for now
            type="Standard",     # everyone starts Standard
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        return jsonify({"token": create_jwt_token(user), "user": user_public(user)}), 201
    finally:
        session.close()


@api.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user or user.password != password:
            return jsonify({"error": "invalid username or password"}), 401

        return jsonify({"token": create_jwt_token(user), "user": user_public(user)})
    finally:
        session.close()


@api.get("/devices")
@login_required
def devices():
    # NOTE: users are not yet linked to device-users, so this returns all devices.
    # Per-user filtering needs a users<->deviceUser link (deferred by design).
    session = SessionLocal()
    try:
        rows = session.query(DeviceUser).order_by(DeviceUser.deviceName).all()
        return jsonify({"devices": [device_public(d) for d in rows]})
    finally:
        session.close()


def app_public(a):
    try:
        all_paths = json.loads(a.allPaths) if a.allPaths else []
    except (json.JSONDecodeError, TypeError):
        all_paths = []

    return {
        "id": a.id,
        "exeName": a.exeName,
        "fileDescription": a.fileDescription,
        "path": a.path,
        "allPaths": all_paths,
        "createdAt": a.createdAt,
    }


@api.get("/apps")
@login_required
def apps():
    from app_tracker import get_all_apps
    rows = get_all_apps()
    return jsonify({"apps": [app_public(a) for a in rows]})


@api.get("/screentime")
@login_required
def screentime():
    """Usage events for one device-user overlapping [startTime, endTime].

    Uses an overlap filter (startTime <= range end AND endTime >= range start) so a
    session that started the previous day but ran past midnight into this range is
    still picked up. Each returned event is then clamped to [startTime, endTime], so
    a session spanning the boundary is split between two days' worth of requests
    instead of being credited whole to one side.
    """
    device_user_id = request.args.get("deviceUserId", type=int)
    start_time = request.args.get("startTime", type=int)
    end_time = request.args.get("endTime", type=int)

    if device_user_id is None or start_time is None or end_time is None:
        return jsonify({"error": "deviceUserId, startTime and endTime are required"}), 400

    session = SessionLocal()
    try:
        events = (
            session.query(Event)
            .filter(
                Event.deviceUserID == device_user_id,
                Event.startTime <= end_time,
                Event.endTime >= start_time,
            )
            .order_by(Event.startTime)
            .all()
        )

        app_ids = {e.appID for e in events}
        apps = (
            {a.id: a for a in session.query(Application).filter(Application.id.in_(app_ids)).all()}
            if app_ids
            else {}
        )

        events_json = []
        for e in events:
            app = apps.get(e.appID)
            clamped_start = max(e.startTime, start_time)
            clamped_end = min(e.endTime, end_time)
            events_json.append({
                "startTime": clamped_start,
                "endTime": clamped_end,
                "appId": e.appID,
                "exeName": app.exeName if app else None,
                "fileDescription": app.fileDescription if app else None,
            })

        return jsonify({"events": events_json})
    finally:
        session.close()


def limit_public(l):
    return {
        "appId": l.appID,
        "dailyLimitMinutes": l.dailyLimitMinutes,
        "updatedAt": l.updatedAt,
    }


@api.get("/limits")
@login_required
def get_limits():
    """Viewable by any signed-in user; only admins may change them (see put_limit)."""
    device_user_id = request.args.get("deviceUserId", type=int)
    if device_user_id is None:
        return jsonify({"error": "deviceUserId is required"}), 400

    session = SessionLocal()
    try:
        rows = session.query(AppLimit).filter(AppLimit.deviceUserID == device_user_id).all()
        return jsonify({"limits": [limit_public(l) for l in rows]})
    finally:
        session.close()


@api.put("/limits")
@admin_required
def put_limit():
    data = request.get_json(silent=True) or {}
    device_user_id = data.get("deviceUserId")
    app_id = data.get("appId")
    daily_limit_minutes = data.get("dailyLimitMinutes")

    if device_user_id is None or app_id is None:
        return jsonify({"error": "deviceUserId and appId are required"}), 400

    session = SessionLocal()
    try:
        existing = (
            session.query(AppLimit)
            .filter(AppLimit.deviceUserID == device_user_id, AppLimit.appID == app_id)
            .first()
        )

        if daily_limit_minutes is None:
            # No limit specified -> clear any existing one.
            if existing:
                session.delete(existing)
                session.commit()
            return jsonify({"limit": None})

        if existing:
            existing.dailyLimitMinutes = daily_limit_minutes
            existing.updatedAt = now_ms()
            session.commit()
            session.refresh(existing)
            return jsonify({"limit": limit_public(existing)})

        limit = AppLimit(
            createdAt=now_ms(),
            updatedAt=now_ms(),
            deviceUserID=device_user_id,
            appID=app_id,
            dailyLimitMinutes=daily_limit_minutes,
        )
        session.add(limit)
        session.commit()
        session.refresh(limit)
        return jsonify({"limit": limit_public(limit)}), 201
    finally:
        session.close()


def downtime_public(d):
    return {
        "id": d.id,
        "deviceUserId": d.deviceUserID,
        "startMinute": d.startMinute,
        "endMinute": d.endMinute,
        "enabled": d.enabled,
        "updatedAt": d.updatedAt,
    }


def _validate_downtime_range(start_minute, end_minute):
    if start_minute is None or end_minute is None:
        return "startMinute and endMinute are required"
    if not (0 <= start_minute < 1440) or not (0 <= end_minute < 1440):
        return "startMinute and endMinute must be in [0, 1440)"
    return None


@api.get("/downtime")
@login_required
def get_downtime():
    """Viewable by any signed-in user; only admins may change them (see below).
    A device can have multiple downtime windows, so this returns a list."""
    device_user_id = request.args.get("deviceUserId", type=int)
    if device_user_id is None:
        return jsonify({"error": "deviceUserId is required"}), 400

    session = SessionLocal()
    try:
        rows = (
            session.query(Downtime)
            .filter(Downtime.deviceUserID == device_user_id)
            .order_by(Downtime.startMinute)
            .all()
        )
        return jsonify({"downtimes": [downtime_public(d) for d in rows]})
    finally:
        session.close()


@api.post("/downtime")
@admin_required
def create_downtime():
    """Adds a new downtime window for a device (devices may have several)."""
    data = request.get_json(silent=True) or {}
    device_user_id = data.get("deviceUserId")
    start_minute = data.get("startMinute")
    end_minute = data.get("endMinute")
    enabled = data.get("enabled", True)

    if device_user_id is None:
        return jsonify({"error": "deviceUserId is required"}), 400

    error = _validate_downtime_range(start_minute, end_minute)
    if error:
        return jsonify({"error": error}), 400

    session = SessionLocal()
    try:
        row = Downtime(
            createdAt=now_ms(),
            updatedAt=now_ms(),
            deviceUserID=device_user_id,
            startMinute=start_minute,
            endMinute=end_minute,
            enabled=bool(enabled),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return jsonify({"downtime": downtime_public(row)}), 201
    finally:
        session.close()


@api.put("/downtime/<int:downtime_id>")
@admin_required
def update_downtime(downtime_id):
    data = request.get_json(silent=True) or {}
    start_minute = data.get("startMinute")
    end_minute = data.get("endMinute")
    enabled = data.get("enabled", True)

    error = _validate_downtime_range(start_minute, end_minute)
    if error:
        return jsonify({"error": error}), 400

    session = SessionLocal()
    try:
        row = session.query(Downtime).filter(Downtime.id == downtime_id).first()
        if not row:
            return jsonify({"error": "downtime not found"}), 404

        row.startMinute = start_minute
        row.endMinute = end_minute
        row.enabled = bool(enabled)
        row.updatedAt = now_ms()
        session.commit()
        session.refresh(row)
        return jsonify({"downtime": downtime_public(row)})
    finally:
        session.close()


@api.delete("/downtime/<int:downtime_id>")
@admin_required
def delete_downtime(downtime_id):
    session = SessionLocal()
    try:
        row = session.query(Downtime).filter(Downtime.id == downtime_id).first()
        if not row:
            return jsonify({"error": "downtime not found"}), 404

        session.delete(row)
        session.commit()
        return jsonify({"ok": True})
    finally:
        session.close()


@api.post("/devices/register")
def register_device():
    """Register a device and get a user_id for WebSocket auth.
    
    Creates or finds DeviceUser by deviceID, creates a linked User account
    (username = deviceID[:8] + osUsername), returns user_id.
    """
    data = request.get_json(silent=True) or {}
    device_id = (data.get("deviceId") or "").strip()
    device_name = (data.get("deviceName") or "").strip()
    os_username = (data.get("osUsername") or "").strip()

    if not device_id or not os_username:
        return jsonify({"error": "deviceId and osUsername are required"}), 400

    session = SessionLocal()
    try:
        # Find or create DeviceUser
        device_user = session.query(DeviceUser).filter(DeviceUser.deviceID == device_id).first()
        if not device_user:
            device_user = DeviceUser(
                createdAt=now_ms(),
                deviceID=device_id,
                osUsername=os_username,
                deviceName=device_name or os_username,
            )
            session.add(device_user)
            session.commit()
            session.refresh(device_user)
        else:
            # Update device name if provided
            if device_name:
                device_user.deviceName = device_name
                session.commit()

        # Create or find linked User account
        # Username format: device_id[:8] + "@" + os_username (unique per device-user pair)
        user_username = f"{device_id[:8]}@{os_username}"
        user = session.query(User).filter(User.username == user_username).first()
        if not user:
            user = User(
                createdAt=now_ms(),
                username=user_username,
                password="",  # no password - device auth only
                type="Standard",
            )
            session.add(user)
            session.commit()
            session.refresh(user)

        return jsonify({
            "userId": user.id,
            "username": user.username,
            "deviceId": device_user.deviceID,
            "deviceName": device_user.deviceName,
        })
    finally:
        session.close()
