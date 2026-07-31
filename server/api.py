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

from app_tracker import get_app_by_id
from db import SessionLocal
from models import User, DeviceUser, Application, Event, AppLimit, Downtime, BlockException, WebsiteEvent, WebsiteLimit
from auth import create_jwt_token, login_required, admin_required
import manual_block
import streaming
import trayapp_ws
import browser_ws

api = Blueprint("api", __name__)


@api.get("/health")
def health():
    """Unauthenticated - just lets a client check the server is reachable before
    committing to a URL (see react-client ApiUrlSetup.jsx)."""
    return jsonify({"status": "ok"})


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
        "isActive": streaming.is_trayapp_connected(d.id),
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

        # The Event table only has *finished* sessions - whatever's focused right
        # now hasn't been written yet (won't be until the next switch). Inject it
        # as a synthetic event from when it became current through to now, clamped
        # into the requested range same as everything else above, so totals/charts
        # don't lag behind reality by however long the current session has run.
        current_session = trayapp_ws.get_open_app_session(device_user_id)
        if current_session and current_session.get("exeName"):
            session_start = current_session.get("startTime")
            if isinstance(session_start, (int, float)):
                clamped_start = max(int(session_start), start_time)
                clamped_end = min(now_ms(), end_time)
                if clamped_start < clamped_end:
                    app_row = (
                        session.query(Application)
                        .filter(Application.exeName == current_session.get("exeName"))
                        .order_by(Application.id.desc())
                        .first()
                    )
                    events_json.append({
                        "startTime": clamped_start,
                        "endTime": clamped_end,
                        "appId": app_row.id if app_row else None,
                        "exeName": current_session.get("exeName"),
                        "fileDescription": current_session.get("fileDescription") or (app_row.fileDescription if app_row else None),
                        "current": True,
                    })

        return jsonify({"events": events_json})
    finally:
        session.close()


@api.get("/website-history")
@login_required
def website_history():
    """Website events for one device-user overlapping [startTime, endTime].

    Uses the same overlap+clamp approach as /api/screentime so a browser session
    that started the previous day but ran into this range is credited only for
    the portion inside the requested day. This lets the React client request a
    single calendar day (local midnight -> next midnight) and get clean totals.
    """
    device_user_id = request.args.get("deviceUserId", type=int)
    start_time = request.args.get("startTime", type=int)
    end_time = request.args.get("endTime", type=int)

    if device_user_id is None or start_time is None or end_time is None:
        return jsonify({"error": "deviceUserId, startTime and endTime are required"}), 400

    session = SessionLocal()
    try:
        events = (
            session.query(WebsiteEvent)
            .filter(
                WebsiteEvent.deviceUserID == device_user_id,
                WebsiteEvent.startTime <= end_time,
                WebsiteEvent.endTime >= start_time,
            )
            .order_by(WebsiteEvent.startTime)
            .all()
        )

        # The still-open tab's WebsiteEvent row only gets its endTime pushed
        # forward once a minute (on each website_heartbeat), so it can read up to
        # that long stale. If this device-user currently has a tab open, patch
        # that same row's endTime up to "now" instead of waiting for the next
        # heartbeat - same row, not an extra one, so nothing double-counts.
        open_session = browser_ws.get_open_website_session(device_user_id)
        open_row_id = open_session.get("id") if open_session else None

        events_json = []
        for e in events:
            is_current = open_row_id is not None and e.id == open_row_id
            events_json.append({
                "startTime": max(e.startTime, start_time),
                "endTime": min(now_ms(), end_time) if is_current else min(e.endTime, end_time),
                "tabUrl": e.tabUrl,
                "tabTitle": e.tabTitle,
                **({"current": True} if is_current else {}),
            })
            if is_current:
                open_row_id = None  # matched - the fallback below is now a no-op

        # Edge case: the open row's stored endTime was just outside the overlap
        # filter above (e.g. very stale) - fetch and inject it directly so a
        # currently-open tab is never silently missing from "today"'s view.
        if open_row_id is not None:
            open_row = session.query(WebsiteEvent).filter(WebsiteEvent.id == open_row_id).first()
            if open_row:
                clamped_start = max(open_row.startTime, start_time)
                clamped_end = min(now_ms(), end_time)
                if clamped_start < clamped_end:
                    events_json.append({
                        "startTime": clamped_start,
                        "endTime": clamped_end,
                        "tabUrl": open_row.tabUrl,
                        "tabTitle": open_row.tabTitle,
                        "current": True,
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


def website_limit_public(l):
    return {
        "domain": l.domain,
        "dailyLimitMinutes": l.dailyLimitMinutes,
        "updatedAt": l.updatedAt,
    }


@api.get("/website-limits")
@login_required
def get_website_limits():
    """Viewable by any signed-in user; only admins may change them (see
    put_website_limit). Same shape/permissions as GET /api/limits, keyed by
    domain instead of appId - see trayapp_ws.handle 'get_website_limits' for the
    trayapp-facing sync of this same table."""
    device_user_id = request.args.get("deviceUserId", type=int)
    if device_user_id is None:
        return jsonify({"error": "deviceUserId is required"}), 400

    session = SessionLocal()
    try:
        rows = session.query(WebsiteLimit).filter(WebsiteLimit.deviceUserID == device_user_id).all()
        return jsonify({"limits": [website_limit_public(l) for l in rows]})
    finally:
        session.close()


@api.put("/website-limits")
@admin_required
def put_website_limit():
    data = request.get_json(silent=True) or {}
    device_user_id = data.get("deviceUserId")
    domain = (data.get("domain") or "").strip().lower()
    daily_limit_minutes = data.get("dailyLimitMinutes")

    if device_user_id is None or not domain:
        return jsonify({"error": "deviceUserId and domain are required"}), 400

    session = SessionLocal()
    try:
        existing = (
            session.query(WebsiteLimit)
            .filter(WebsiteLimit.deviceUserID == device_user_id, WebsiteLimit.domain == domain)
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
            return jsonify({"limit": website_limit_public(existing)})

        limit = WebsiteLimit(
            createdAt=now_ms(),
            updatedAt=now_ms(),
            deviceUserID=device_user_id,
            domain=domain,
            dailyLimitMinutes=daily_limit_minutes,
        )
        session.add(limit)
        session.commit()
        session.refresh(limit)
        return jsonify({"limit": website_limit_public(limit)}), 201
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


def _manual_block_public(device_user_id):
    end_time = manual_block.get_end_time(device_user_id)
    return {"blocked": end_time is not None, "endTime": end_time}


def _push_manual_block(device_user_id):
    """Tells the trayapp right away if it's currently connected - it also asks on
    every (re)connect itself (see trayapp_ws.py get_manual_block), so a device
    that's offline right now still picks this up the moment it reconnects."""
    ws = streaming.get_trayapp_ws(device_user_id)
    if ws is None:
        return
    payload = _manual_block_public(device_user_id)
    payload["type"] = "manual_block"
    try:
        ws.send(json.dumps(payload))
    except Exception:
        pass


@api.get("/manual-block")
@login_required
def get_manual_block():
    """Viewable by any signed-in user; only admins may change it (see below)."""
    device_user_id = request.args.get("deviceUserId", type=int)
    if device_user_id is None:
        return jsonify({"error": "deviceUserId is required"}), 400

    return jsonify(_manual_block_public(device_user_id))


@api.post("/manual-block")
@admin_required
def set_manual_block():
    data = request.get_json(silent=True) or {}
    device_user_id = data.get("deviceUserId")
    minutes = data.get("minutes")

    if device_user_id is None or minutes is None:
        return jsonify({"error": "deviceUserId and minutes are required"}), 400
    if not isinstance(minutes, (int, float)) or minutes <= 0:
        return jsonify({"error": "minutes must be a positive number"}), 400

    end_time_ms = now_ms() + int(minutes * 60 * 1000)
    manual_block.set_block(device_user_id, end_time_ms)
    _push_manual_block(device_user_id)

    return jsonify(_manual_block_public(device_user_id))


@api.delete("/manual-block")
@admin_required
def delete_manual_block():
    device_user_id = request.args.get("deviceUserId", type=int)
    if device_user_id is None:
        return jsonify({"error": "deviceUserId is required"}), 400

    manual_block.clear_block(device_user_id)
    _push_manual_block(device_user_id)

    return jsonify(_manual_block_public(device_user_id))


def block_exception_public(row, app):
    return {
        "id": row.id,
        "deviceUserId": row.deviceUserID,
        "appId": row.appID,
        "exeName": app.exeName if app else None,
        "fileDescription": app.fileDescription if app else None,
    }


@api.get("/block-exceptions")
@login_required
def get_block_exceptions():
    """Viewable by any signed-in user; only admins may change them (see below).
    Apps in this list are exempt from every enforcement (downtime, screen-time
    limit, manual block) - synced by the trayapp on connect (see AlwaysAllowedApps.cs)."""
    device_user_id = request.args.get("deviceUserId", type=int)
    if device_user_id is None:
        return jsonify({"error": "deviceUserId is required"}), 400

    session = SessionLocal()
    try:
        rows = session.query(BlockException).filter(BlockException.deviceUserID == device_user_id).all()
        return jsonify({
            "exceptions": [block_exception_public(row, get_app_by_id(row.appID)) for row in rows]
        })
    finally:
        session.close()


@api.post("/block-exceptions")
@admin_required
def create_block_exception():
    data = request.get_json(silent=True) or {}
    device_user_id = data.get("deviceUserId")
    app_id = data.get("appId")

    if device_user_id is None or app_id is None:
        return jsonify({"error": "deviceUserId and appId are required"}), 400

    session = SessionLocal()
    try:
        existing = (
            session.query(BlockException)
            .filter(BlockException.deviceUserID == device_user_id, BlockException.appID == app_id)
            .first()
        )
        if existing:
            return jsonify({"exception": block_exception_public(existing, get_app_by_id(app_id))})

        row = BlockException(createdAt=now_ms(), deviceUserID=device_user_id, appID=app_id)
        session.add(row)
        session.commit()
        session.refresh(row)
        return jsonify({"exception": block_exception_public(row, get_app_by_id(app_id))}), 201
    finally:
        session.close()


@api.delete("/block-exceptions/<int:exception_id>")
@admin_required
def delete_block_exception(exception_id):
    session = SessionLocal()
    try:
        row = session.query(BlockException).filter(BlockException.id == exception_id).first()
        if not row:
            return jsonify({"error": "block exception not found"}), 404

        session.delete(row)
        session.commit()
        return jsonify({"ok": True})
    finally:
        session.close()


@api.post("/devices/register")
def register_device():
    """Register a device and get an id for WebSocket auth.

    Finds or creates the DeviceUser by deviceID and returns its id as
    'userId' - trayapp connections only need *some* stable integer to key
    the websocket registry by (see trayapp_ws.client_registry), and
    DeviceUser.id already is one. This does NOT create a row in `users` -
    that table is exclusively for web-portal login accounts, and a device
    reporting in has nothing to do with dashboard access (a trayapp machine
    may have no portal user, and a portal user may not run the trayapp at
    all). An earlier version of this endpoint also created a linked User
    row per device-user pair, which polluted the login/account list with
    entries no one could or should log in as - don't reintroduce that.
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

        return jsonify({
            "userId": device_user.id,
            "username": f"{device_id[:8]}@{os_username}",
            "deviceId": device_user.deviceID,
            "deviceName": device_user.deviceName,
        })
    finally:
        session.close()
