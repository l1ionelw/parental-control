"""JWT auth helpers: token creation and the @login_required decorator.

Development only: the secret is a hardcoded default (override with the HAVEN_SECRET
env var). Passwords are compared in plaintext for now (see models.User).
"""

import functools
import os
import time

import jwt
from flask import request, jsonify, g

SECRET_KEY = os.environ.get("HAVEN_SECRET", "dev-secret-change-me")
JWT_ALGO = "HS256"
JWT_EXP_SECONDS = 60 * 60 * 24 * 7  # 7 days


def create_jwt_token(user):
    """Build a signed JWT for a User row."""
    now = int(time.time())
    payload = {
        "sub": str(user.id),          # JWT 'sub' must be a string
        "username": user.username,
        "type": user.type,
        "iat": now,
        "exp": now + JWT_EXP_SECONDS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGO)


def decode_jwt_token(token):
    return jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGO])


def login_required(fn):
    """Protect a route: requires a valid `Authorization: Bearer <token>` header.
    On success, stashes the identity on flask.g (g.user_id / username / user_type)."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "missing or invalid Authorization header"}), 401

        token = header[len("Bearer "):].strip()
        try:
            payload = decode_jwt_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "invalid token"}), 401

        g.user_id = int(payload["sub"])
        g.username = payload.get("username")
        g.user_type = payload.get("type")
        return fn(*args, **kwargs)

    return wrapper
