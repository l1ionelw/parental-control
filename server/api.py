"""REST API blueprint, mounted at /api.

Endpoints:
  POST /api/register  -> create a Standard account, returns a JWT (auto-login)
  POST /api/login     -> validate credentials, returns a JWT
  GET  /api/devices   -> (protected) list device-users

No routes are protected except /devices. New accounts are always type "Standard";
promote to "Administrator" by editing the DB directly during development.
"""

import time

from flask import Blueprint, request, jsonify, g

from db import SessionLocal
from models import User, DeviceUser
from auth import create_jwt_token, login_required

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
