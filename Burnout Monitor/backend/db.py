from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from .auth import hash_password
from .config import DB_PATH, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, SCHEMA_FILE


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists():
        DB_PATH.touch()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
        conn.commit()
    finally:
        conn.close()


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def seed_admin_user() -> None:
    with connect_db() as conn:
        existing = conn.execute("SELECT 1 FROM users WHERE email = ?", (DEFAULT_ADMIN_EMAIL,)).fetchone()
        if existing:
            return
        password_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
        conn.execute(
            "INSERT INTO users (email, password_hash, role, is_active, needs_password_change) VALUES (?, ?, ?, 1, 1)",
            (DEFAULT_ADMIN_EMAIL, password_hash, "admin"),
        )
        conn.commit()


def ensure_schema() -> None:
    init_db()
