"""Browser-extension message handling: website_changed / website_heartbeat /
get_open_website_session. Shares the same /ws connection (and handshake/identity
registry) as trayapp_ws, since a chrome extension and the trayapp both connect
under the same (device_id, user_id) identity - but the tab/website tracking logic
itself is extension-specific and lives here, not in trayapp_ws.
"""

import json
import threading
import time

from db import SessionLocal
from models import WebsiteEvent

# device_user_id -> {"id": WebsiteEvent.id, "tabUrl": str, "tabTitle": str} for the
# currently "open" (not-yet-finished) browser session. The extension keeps this
# row's endTime moving forward via periodic website_heartbeat messages instead of
# only reporting a session once it's over - see handle_website_heartbeat. This is
# server-side (not extension-side) state because the extension's own memory doesn't
# survive its service worker being killed (MV3 tears it down after ~30s idle,
# wiping everything); the server is the durable source of truth the extension
# reconciles against on every reconnect (see handle_get_open_website_session).
open_website_sessions = {}
open_website_sessions_lock = threading.Lock()


def _now_ms():
    return int(time.time() * 1000)


def _log_cache(context, device_user_id):
    """Prints the cache entry for this device-user plus the full cache, so it's
    obvious from the server console what state is being tracked and for whom."""
    with open_website_sessions_lock:
        entry = open_website_sessions.get(device_user_id)
        snapshot = dict(open_website_sessions)
    print(f"[browser_ws] {context} deviceUser={device_user_id} -> {entry}")
    print(f"[browser_ws] full open_website_sessions ({len(snapshot)} entries): {snapshot}")


def _open_website_row(device_user_id, tab_url, tab_title, start_time):
    session = SessionLocal()
    try:
        row = WebsiteEvent(
            createdAt=_now_ms(),
            deviceUserID=device_user_id,
            startTime=start_time,
            endTime=start_time,
            tabUrl=tab_url,
            tabTitle=tab_title,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id
    finally:
        session.close()


def _extend_website_row(row_id, end_time):
    session = SessionLocal()
    try:
        row = session.query(WebsiteEvent).filter(WebsiteEvent.id == row_id).first()
        if row and end_time > row.endTime:
            row.endTime = end_time
            session.commit()
    finally:
        session.close()


def close_open_session(device_user_id, end_time):
    """Extends the cached open row (if any) to end_time and drops it from the
    cache. Called both on an explicit tab switch and on disconnect, so a session
    doesn't stay "open" forever if the extension closes without a final switch."""
    with open_website_sessions_lock:
        cached = open_website_sessions.pop(device_user_id, None)
    if cached and isinstance(end_time, (int, float)):
        print(f"[browser_ws] closing deviceUser={device_user_id} row={cached} endTime={int(end_time)}")
        _extend_website_row(cached["id"], int(end_time))
    else:
        print(f"[browser_ws] close_open_session no-op deviceUser={device_user_id} (nothing cached)")


def _open_new_session(device_user_id, tab, start_time):
    tab_url = (tab or {}).get("url") or ""
    tab_title = (tab or {}).get("title") or ""
    if not tab_url or not isinstance(start_time, (int, float)):
        print(f"[browser_ws] _open_new_session skipped deviceUser={device_user_id} tab={tab} startTime={start_time}")
        return
    row_id = _open_website_row(device_user_id, tab_url, tab_title, int(start_time))
    with open_website_sessions_lock:
        open_website_sessions[device_user_id] = {"id": row_id, "tabUrl": tab_url, "tabTitle": tab_title}
    print(
        f"[browser_ws] opened deviceUser={device_user_id} id={row_id} "
        f"tabUrl={tab_url} tabTitle={tab_title} startTime={int(start_time)}"
    )


def handle_website_changed(device_user_id, data, label):
    """A tab switch or URL change: close whatever session the server had open
    (using its own cached state, not anything the client claims about `before` -
    the server is the source of truth) and open a new one for `after`.

    `label` is a preformatted "who is this" string for logging (e.g.
    "alice(3) device=abcd1234...") - resolved by the caller, which owns the
    connection registry this module doesn't need to know about.
    """
    if device_user_id is None:
        return

    after = data.get("after")
    switch_time = data.get("switchTime")

    print(f"[{label}] website_changed -> url={(after or {}).get('url')} title={(after or {}).get('title')}")

    close_open_session(device_user_id, switch_time)
    _open_new_session(device_user_id, after, switch_time)
    _log_cache("after website_changed", device_user_id)


def handle_website_heartbeat(device_user_id, data):
    """Keeps the currently open session's endTime moving forward while the tab
    stays the same - this is what covers a long, never-switched-away-from tab
    (e.g. hours parked on a YouTube video) that would otherwise never emit an
    event at all. If the heartbeat's tab doesn't match what's cached (extension
    reconnected after a service-worker restart it missed a switch during, or the
    server has nothing cached), open a fresh session instead of dropping it."""
    if device_user_id is None:
        return

    timestamp = data.get("timestamp")
    tab = data.get("tab") or {}

    with open_website_sessions_lock:
        cached = open_website_sessions.get(device_user_id)

    if cached and cached["tabUrl"] == tab.get("url"):
        print(f"[browser_ws] heartbeat extend deviceUser={device_user_id} row={cached} endTime={timestamp}")
        if isinstance(timestamp, (int, float)):
            _extend_website_row(cached["id"], int(timestamp))
    else:
        print(
            f"[browser_ws] heartbeat mismatch deviceUser={device_user_id} "
            f"cached={cached} heartbeatTab={tab} - opening fresh session"
        )
        _open_new_session(device_user_id, tab, timestamp)


def get_open_website_session(device_user_id):
    """Whatever tab this device-user currently has open (id/tabUrl/tabTitle of the
    still-open WebsiteEvent row), per the last website_changed/website_heartbeat
    message - None if nothing's open. Used by api.py to patch that row's endTime
    up to "now" instead of whatever it was as of the last heartbeat (see
    /api/website-history)."""
    with open_website_sessions_lock:
        return open_website_sessions.get(device_user_id)


def handle_get_open_website_session(ws, device_user_id):
    """Lets the extension reconcile against server state on every reconnect
    (including after its service worker was killed and lost all local memory)
    instead of trusting its own possibly-stale idea of what's currently open."""
    cached = get_open_website_session(device_user_id)

    session_payload = {"tabUrl": cached["tabUrl"], "tabTitle": cached["tabTitle"]} if cached else None
    print(f"[browser_ws] get_open_website_session deviceUser={device_user_id} -> {session_payload}")
    ws.send(json.dumps({"type": "open_website_session", "session": session_payload}))
