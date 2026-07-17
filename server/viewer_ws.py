"""WebSocket handler for admin screen-share viewers (the react-client browser
side). Auth happens on the handshake (a JWT, same as REST), then the viewer can
watch/stop-watching a device; frames arriving from that device's trayapp
connection (see trayapp_ws.py) get relayed here by streaming.py.
"""

import json
import uuid

import jwt

from auth import decode_jwt_token
import streaming


def _authenticate(data):
    """Returns the decoded token payload, or None if invalid/not an admin."""
    token = data.get("token") or ""
    try:
        payload = decode_jwt_token(token)
    except jwt.PyJWTError:
        return None

    if payload.get("type") != "Administrator":
        return None

    return payload


def handle(ws):
    ws_id = str(uuid.uuid4())
    watching_device_user_id = None

    try:
        raw = ws.receive()
        if raw is None:
            return

        data = json.loads(raw)
        if data.get("type") != "handshake":
            print(f"[!] viewer {ws_id} sent non-handshake first message: {data}")
            return

        identity = _authenticate(data)
        if identity is None:
            print(f"[!] viewer {ws_id} failed handshake auth")
            return

        print(f"[+] viewer {ws_id} connected: admin={identity.get('username')}")

        while True:
            raw = ws.receive()
            if raw is None:
                break

            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                print(f"[!] viewer {ws_id} sent invalid JSON: {raw!r}")
                continue

            msg_type = data.get("type")

            if msg_type == "watch_device":
                device_user_id = data.get("deviceUserId")
                if not isinstance(device_user_id, int):
                    continue

                if watching_device_user_id is not None and watching_device_user_id != device_user_id:
                    _stop_watching(watching_device_user_id, ws)

                watching_device_user_id = device_user_id
                streaming.add_viewer(device_user_id, ws)

                online = streaming.is_trayapp_connected(device_user_id)
                if online:
                    trayapp_ws_conn = streaming.get_trayapp_ws(device_user_id)
                    try:
                        trayapp_ws_conn.send(json.dumps({"type": "start_stream"}))
                    except Exception:
                        online = False

                ws.send(json.dumps({
                    "type": "watching",
                    "deviceUserId": device_user_id,
                    "online": online,
                }))
                print(f"[stream] viewer {ws_id} watching deviceUser={device_user_id} (online={online})")

            elif msg_type == "stop_watching":
                if watching_device_user_id is not None:
                    _stop_watching(watching_device_user_id, ws)
                    watching_device_user_id = None

            elif not data:
                continue
            else:
                print(f"[viewer {ws_id}] unhandled message: {data}")

    except Exception as e:
        print(f"[!] viewer {ws_id} error: {e}")
    finally:
        if watching_device_user_id is not None:
            _stop_watching(watching_device_user_id, ws)

        print(f"[-] viewer {ws_id} disconnected")


def _stop_watching(device_user_id, ws):
    streaming.remove_viewer(device_user_id, ws)

    if streaming.has_viewers(device_user_id):
        return

    trayapp_ws_conn = streaming.get_trayapp_ws(device_user_id)
    if trayapp_ws_conn is not None:
        try:
            trayapp_ws_conn.send(json.dumps({"type": "stop_stream"}))
        except Exception:
            pass
