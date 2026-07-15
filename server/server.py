import json
import threading
import uuid

from flask import Flask
from flask_sock import Sock

from api import api as api_blueprint

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