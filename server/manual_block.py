"""In-memory (never persisted to the database) manual block state: deviceUserId ->
endTime (unix ms). An admin-triggered "block this device for N minutes" - a
server restart clears everything, which is intentional (see conversation)."""

import threading
import time

_lock = threading.Lock()
_blocks = {}  # device_user_id -> end_time_ms


def _now_ms():
    return int(time.time() * 1000)


def _sweep_expired_locked():
    """Removes every entry whose endTime has already passed, not just the one
    being queried - called on every read so stale entries never pile up."""
    now = _now_ms()
    expired = [device_user_id for device_user_id, end_time in _blocks.items() if end_time <= now]
    for device_user_id in expired:
        _blocks.pop(device_user_id, None)


def set_block(device_user_id, end_time_ms):
    with _lock:
        _blocks[device_user_id] = end_time_ms


def clear_block(device_user_id):
    with _lock:
        _blocks.pop(device_user_id, None)


def is_blocked(device_user_id):
    with _lock:
        _sweep_expired_locked()
        return device_user_id in _blocks


def get_end_time(device_user_id):
    with _lock:
        _sweep_expired_locked()
        return _blocks.get(device_user_id)
