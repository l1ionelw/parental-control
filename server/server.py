import json
import threading
import uuid

from flask import Flask
from flask_sock import Sock

app = Flask(__name__)
sock = Sock(app)

# ws_id -> {"machine_name": str, "user_name": str, "ws": WebSocket}
clients = {}
clients_lock = threading.Lock()


@sock.route("/ws")
def ws_handler(ws):
    ws_id = str(uuid.uuid4())
    machine_name = None
    user_name = None

    try:
        # first message must be the handshake
        raw = ws.receive()
        if raw is None:
            return

        data = json.loads(raw)
        if data.get("type") == "handshake":
            machine_name = data.get("machineName")
            user_name = data.get("userName")
            with clients_lock:
                clients[ws_id] = {
                    "machine_name": machine_name,
                    "user_name": user_name,
                    "ws": ws,
                }
            print(f"[+] {ws_id} = {machine_name}\\{user_name}")
        else:
            print(f"[!] {ws_id} sent non-handshake first message: {data}")

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
                with clients_lock:
                    info = clients.get(ws_id, {})

                prev = data.get("previous") or {}
                start = data.get("startTime")
                end = data.get("endTime")
                duration = (
                    f"{(end - start) / 1000.0:.1f}s"
                    if isinstance(start, (int, float)) and isinstance(end, (int, float))
                    else "?"
                )

                print(
                    f"[{info.get('machine_name')}] window_changed -> "
                    f"exe={prev.get('exeName')} "
                    f"friendly={prev.get('fileDescription')} "
                    f"path={prev.get('path')} "
                    f"used for {duration} (start={start} end={end})"
                )
            elif not data:
                # empty payload, likely a stray/ping connection - ignore quietly
                continue
            else:
                print(f"[{ws_id}] unhandled message: {data}")
                
    except Exception as e:
        print(f"[!] {ws_id} error: {e}")
    finally:
        with clients_lock:
            clients.pop(ws_id, None)
        print(f"[-] {ws_id} disconnected")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)