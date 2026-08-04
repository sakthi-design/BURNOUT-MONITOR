from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from typing import Any

import logging

try:
    import bcrypt  # type: ignore
except ImportError as exc:
    raise ImportError("Bcrypt is a required dependency for production-ready password hashing. Run pip install -r requirements.txt") from exc

from .config import JWT_ALGORITHM, JWT_SECRET, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS

logger = logging.getLogger("burnout_auth")
if JWT_SECRET == "dev-secret-change-me":
    logger.warning("SECURITY WARNING: JWT_SECRET is set to default development key! Set a secure JWT_SECRET environment variable in production.")


def hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    return f"bcrypt${hashed}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False
    if stored_hash.startswith("bcrypt$"):
        if bcrypt is None:
            return False
        return bcrypt.checkpw(password.encode("utf-8"), stored_hash[len("bcrypt$"):].encode("utf-8"))
    if stored_hash.startswith("scrypt$"):
        _, salt_hex, digest_hex = stored_hash.split("$", 2)
        salt = bytes.fromhex(salt_hex)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
        return hmac.compare_digest(digest.hex(), digest_hex)
    return False


def validate_password_strength(password: str) -> str | None:
    if len(password) < 8:
        return "Password must be at least 8 characters long"
    if not re.search(r"[A-Z]", password):
        return "Password must contain an uppercase letter"
    if not re.search(r"[0-9]", password):
        return "Password must contain a number"
    if not re.search(r"[^A-Za-z0-9]", password):
        return "Password must contain a special character"
    return None


def validate_email(email: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _base64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_jwt(payload: dict[str, Any], ttl_seconds: int = ACCESS_TOKEN_TTL_SECONDS) -> str:
    now = int(time.time())
    jwt_payload = dict(payload)
    jwt_payload["iat"] = now
    jwt_payload["exp"] = now + ttl_seconds
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    header_segment = _base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_segment = _base64url_encode(json.dumps(jwt_payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_segment}.{payload_segment}".encode("utf-8")
    signature = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_segment}.{payload_segment}.{_base64url_encode(signature)}"


def verify_jwt(token: str) -> dict[str, Any] | None:
    try:
        header_segment, payload_segment, signature = token.split(".")
    except ValueError:
        return None
    expected_signature = _base64url_encode(hmac.new(JWT_SECRET.encode("utf-8"), f"{header_segment}.{payload_segment}".encode("utf-8"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected_signature):
        return None
    payload = json.loads(_base64url_decode(payload_segment))
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload
