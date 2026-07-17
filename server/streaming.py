"""Shared in-memory registry connecting tray-app screen-share connections to the
admin viewers watching them.

Deliberately just a relay: the server never buffers or persists frames - a
trayapp sends a frame, whoever is currently registered as a viewer for that
device gets it forwarded immediately, and that's it. Both trayapp_ws.py and
viewer_ws.py talk to this module rather than to each other directly, since
either side's connection can come and go independently.
"""

import threading

_lock = threading.Lock()

# deviceUserId -> the trayapp's websocket connection, present whenever that
# trayapp is connected at all (not just while actively streaming).
_trayapp_connections = {}

# deviceUserId -> set of viewer websocket connections currently watching it.
_viewers = {}


def register_trayapp(device_user_id, ws):
    with _lock:
        _trayapp_connections[device_user_id] = ws


def unregister_trayapp(device_user_id, ws):
    with _lock:
        if _trayapp_connections.get(device_user_id) is ws:
            _trayapp_connections.pop(device_user_id, None)


def get_trayapp_ws(device_user_id):
    with _lock:
        return _trayapp_connections.get(device_user_id)


def is_trayapp_connected(device_user_id):
    with _lock:
        return device_user_id in _trayapp_connections


def add_viewer(device_user_id, ws):
    with _lock:
        _viewers.setdefault(device_user_id, set()).add(ws)


def remove_viewer(device_user_id, ws):
    with _lock:
        viewers = _viewers.get(device_user_id)
        if not viewers:
            return
        viewers.discard(ws)
        if not viewers:
            _viewers.pop(device_user_id, None)


def get_viewers(device_user_id):
    with _lock:
        return list(_viewers.get(device_user_id, ()))


def has_viewers(device_user_id):
    with _lock:
        return bool(_viewers.get(device_user_id))
