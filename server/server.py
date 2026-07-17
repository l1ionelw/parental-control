import datetime
import json
import threading
import uuid

from flask import Flask
from flask_sock import Sock

from api import api as api_blueprint
from app_tracker import update_application_table, record_event, get_app_by_id
from db import SessionLocal
from models import DeviceUser, AppLimit, Downtime, Event

app = Flask(__name__)
sock = Sock(app)

# REST API for the react-client frontend.
app.register_blueprint(api_blueprint, url_prefix="/api")

# (device_id, user_id) -> {"username": str, "connections": [ws_id, ...]}
client_registry = {}
registry_lock = threading.Lock()

# ws_id -> {"key": (device_id, user_id), "ws": WebSocket}
active_connections = {}
active_connections_lock = threading.Lock()


def _lookup_device_user_id(device_id):
    """The websocket identity carries deviceId (hardware hash), but events.deviceUserID
    references deviceUser.id - resolve it via the row created by /api/devices/register."""
    session = SessionLocal()
    try:
        device_user = session.query(DeviceUser).filter(DeviceUser.deviceID == device_id).first()
        return device_user.id if device_user else None
    finally:
        session.close()


def _build_app_limits_payload(device_user_id):
    """The trayapp's ScreenTimeEnforcer needs the limit merged with the Application
    row it applies to (exeName/fileDescription/allPaths) so it can match the
    currently running process against it - hence the join here."""
    if device_user_id is None:
        return []

    session = SessionLocal()
    try:
        rows = session.query(AppLimit).filter(AppLimit.deviceUserID == device_user_id).all()
        limits = []
        for l in rows:
            app = get_app_by_id(l.appID)
            if app is None:
                continue
            try:
                all_paths = json.loads(app.allPaths) if app.allPaths else []
            except (json.JSONDecodeError, TypeError):
                all_paths = []
            limits.append({
                "appId": l.appID,
                "exeName": app.exeName,
                "fileDescription": app.fileDescription,
                "path": app.path,
                "allPaths": all_paths,
                "dailyLimitMinutes": l.dailyLimitMinutes,
            })
        return limits
    finally:
        session.close()


def _build_downtime_payload(device_user_id):
    if device_user_id is None:
        return []

    session = SessionLocal()
    try:
        rows = (
            session.query(Downtime)
            .filter(Downtime.deviceUserID == device_user_id)
            .order_by(Downtime.startMinute)
            .all()
        )
        return [
            {
                "id": d.id,
                "startMinute": d.startMinute,
                "endMinute": d.endMinute,
                "enabled": d.enabled,
            }
            for d in rows
        ]
    finally:
        session.close()


def _build_app_usage_payload(device_user_id):
    """Seconds used today per exeName - same overlap+clamp approach as GET
    /api/screentime (a session starting yesterday but running past midnight is
    clamped to the current day), aggregated by exeName instead of returned as a
    raw event list, since that's the key the trayapp matches its limits by."""
    if device_user_id is None:
        return {}

    now = datetime.datetime.now()
    start_of_day = datetime.datetime(now.year, now.month, now.day)
    end_of_day = start_of_day + datetime.timedelta(days=1) - datetime.timedelta(milliseconds=1)
    start_ms = int(start_of_day.timestamp() * 1000)
    end_ms = int(end_of_day.timestamp() * 1000)

    session = SessionLocal()
    try:
        events = (
            session.query(Event)
            .filter(
                Event.deviceUserID == device_user_id,
                Event.startTime <= end_ms,
                Event.endTime >= start_ms,
            )
            .all()
        )

        usage_seconds = {}
        for e in events:
            app = get_app_by_id(e.appID)
            if app is None or not app.exeName:
                continue

            clamped_start = max(e.startTime, start_ms)
            clamped_end = min(e.endTime, end_ms)
            seconds = max(0, (clamped_end - clamped_start) // 1000)
            usage_seconds[app.exeName] = usage_seconds.get(app.exeName, 0) + seconds

        return usage_seconds
    finally:
        session.close()


def print_registry():
    with registry_lock:
        print(f"\n[REGISTRY] {len(client_registry)} device-user pairs, {len(active_connections)} active connections:")
        for (device_id, user_id), entry in client_registry.items():
            conn_count = len(entry["connections"])
            print(f"  {device_id[:16]}... | user={entry['username']}({user_id}) | conns={conn_count}")
        print()


@sock.route("/ws")
def ws_handler(ws):
    ws_id = str(uuid.uuid4())
    device_id = None
    user_id = None
    username = None
    key = None
    device_user_id = None

    try:
        # first message must be the handshake
        raw = ws.receive()
        if raw is None:
            return

        data = json.loads(raw)
        if data.get("type") == "handshake":
            device_id = data.get("deviceId")
            user_id = data.get("userId")
            username = data.get("username")

            if not device_id or user_id is None:
                print(f"[!] {ws_id} handshake missing deviceId or userId")
                return

            key = (device_id, user_id)
            device_user_id = _lookup_device_user_id(device_id)
            if device_user_id is None:
                print(f"[!] {ws_id} no deviceUser row for device={device_id[:16]}... (register first)")

            with registry_lock:
                if key not in client_registry:
                    client_registry[key] = {
                        "username": username,
                        "connections": [],
                    }
                client_registry[key]["connections"].append(ws_id)

            with active_connections_lock:
                active_connections[ws_id] = {"key": key, "ws": ws}

            print(f"[+] {ws_id} connected: device={device_id[:16]}... user={username}({user_id})")
            print_registry()
        else:
            print(f"[!] {ws_id} sent non-handshake first message: {data}")
            return

        while True:
            raw = ws.receive()
            if raw is None:
                break

            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                print(f"[!] {ws_id} sent invalid JSON: {raw!r}")
                continue

            msg_type = data.get("type")

            if msg_type == "window_changed":
                with registry_lock:
                    entry = client_registry.get(key, {})

                prev = data.get("previous") or {}
                start = data.get("startTime")
                end = data.get("endTime")
                duration = (
                    f"{(end - start) / 1000.0:.1f}s"
                    if isinstance(start, (int, float)) and isinstance(end, (int, float))
                    else "?"
                )

                print(
                    f"[{entry.get('username') or 'unknown'}({entry.get('user_id') or '?'})] "
                    f"device={entry.get('device_id', '?')[:16]}... "
                    f"window_changed -> exe={prev.get('exeName')} "
                    f"friendly={prev.get('fileDescription')} "
                    f"path={prev.get('path')} "
                    f"used for {duration} (start={start} end={end})"
                )

                app_id = update_application_table(
                    prev.get("exeName"),
                    prev.get("fileDescription"),
                    prev.get("path"),
                )

                if (
                    app_id is not None
                    and device_user_id is not None
                    and isinstance(start, (int, float))
                    and isinstance(end, (int, float))
                ):
                    record_event(device_user_id, app_id, int(start), int(end))
            elif msg_type == "get_app_limits":
                limits = _build_app_limits_payload(device_user_id)
                ws.send(json.dumps({"type": "app_limits", "limits": limits}))
            elif msg_type == "get_downtime":
                downtimes = _build_downtime_payload(device_user_id)
                ws.send(json.dumps({"type": "downtime", "downtimes": downtimes}))
            elif msg_type == "get_app_usage":
                usage = _build_app_usage_payload(device_user_id)
                ws.send(json.dumps({"type": "app_usage", "usage": usage}))
            elif not data:
                continue
            else:
                print(f"[{ws_id}] unhandled message: {data}")

    except Exception as e:
        print(f"[!] {ws_id} error: {e}")
    finally:
        if key:
            with registry_lock:
                entry = client_registry.get(key)
                if entry and ws_id in entry["connections"]:
                    entry["connections"].remove(ws_id)
                if entry and not entry["connections"]:
                    client_registry.pop(key, None)

        with active_connections_lock:
            active_connections.pop(ws_id, None)

        print(f"[-] {ws_id} disconnected")
        print_registry()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)