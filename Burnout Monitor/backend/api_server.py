"""Production-ready API server for the burnout project."""

from __future__ import annotations

import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


import json
import logging
import os
import sqlite3
import time
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from backend.auth import create_jwt, hash_password, validate_email, validate_password_strength, verify_jwt, verify_password

from backend.burnout_engine import predict_burnout
from backend.config import CORS_ALLOW_ORIGIN, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, LOG_PATH
from backend.db import connect_db, init_db, seed_admin_user

from logging.handlers import RotatingFileHandler
import re

def setup_logging() -> None:
    log_file = LOG_PATH
    log_file.parent.mkdir(parents=True, exist_ok=True)
    
    formatter = logging.Formatter(
        "[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    
    file_handler = RotatingFileHandler(log_file, maxBytes=5*1024*1024, backupCount=3, encoding="utf-8")
    file_handler.setFormatter(formatter)
    
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)

setup_logging()
logger = logging.getLogger("burnout_api")

DATA_FILE = ROOT / "data" / "sample_employees.json"

# Idempotent DB init used by Vercel serverless entrypoint
_db_initialized = False


def init_db_once() -> None:
    """Initialize the database exactly once (safe to call on every cold start)."""
    global _db_initialized
    if _db_initialized:
        return
    try:
        init_db()
        seed_admin_user()
        _db_initialized = True
    except Exception:
        logger.exception("Failed to initialize database")


def _json_error(message: str, status: int = 400, details: dict[str, object] | None = None) -> dict[str, object]:
    payload: dict[str, object] = {"success": False, "error": message, "status": status}
    if details:
        payload["details"] = details
    return payload


def _json_success(message: str, status: int = 200, **payload: object) -> dict[str, object]:
    result: dict[str, object] = {"success": True, "message": message, "status": status}
    result.update(payload)
    return result


def _parse_json_body(handler: BaseHTTPRequestHandler) -> dict[str, object]:
    content_length = int(handler.headers.get("Content-Length", "0"))
    if content_length <= 0:
        return {}
    raw = handler.rfile.read(content_length)
    if not raw:
        return {}
    try:
        body = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid JSON payload") from exc
    if not isinstance(body, dict):
        raise ValueError("JSON body must be an object")
    return body


def _sanitize_string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _sanitize_payload_xss(payload: object) -> None:
    if isinstance(payload, dict):
        for k, v in payload.items():
            if isinstance(v, str):
                if re.search(r"<script\b[^>]*>|javascript:|onclick=|onerror=", v, re.IGNORECASE):
                    raise ValueError("Potential script injection detected")
                if re.search(r"<[^>]+>", v):
                    raise ValueError("HTML tags not allowed in inputs")
            elif isinstance(v, (dict, list)):
                _sanitize_payload_xss(v)
    elif isinstance(payload, list):
        for item in payload:
            _sanitize_payload_xss(item)


def _validate_metrics_payload(payload: dict[str, object]) -> None:
    for key in ("work_hours", "overtime_hours", "leave_days", "meeting_hours", "task_load", "completion_rate", "job_satisfaction", "stress_level"):
        if payload.get(key) is not None:
            value = payload.get(key)
            if not isinstance(value, (int, float)):
                raise ValueError(f"{key} must be numeric")
            if float(value) < 0:
                raise ValueError(f"{key} cannot be negative")
            if key in {"task_load", "completion_rate", "job_satisfaction", "stress_level"} and not (0 <= float(value) <= 100):
                raise ValueError(f"{key} must be between 0 and 100")


def _validate_employee_payload(payload: dict[str, object]) -> None:
    required_fields = ["name", "department", "designation", "email"]
    for field in required_fields:
        if not _sanitize_string(payload.get(field)):
            raise ValueError(f"{field} is required")
    if not validate_email(_sanitize_string(payload.get("email"))):
        raise ValueError("Invalid email format")
    if payload.get("age") is not None:
        age = payload.get("age")
        if not isinstance(age, (int, float)) or age < 18 or age > 65:
            raise ValueError("age must be between 18 and 65")
    if payload.get("experience") is not None:
        experience = payload.get("experience")
        if not isinstance(experience, (int, float)) or experience < 0 or experience > 40:
            raise ValueError("experience must be between 0 and 40")
    _validate_metrics_payload(payload)


def _serialize_employee(row: sqlite3.Row) -> dict[str, object]:
    has_pred = "burnout_score" in row.keys() if hasattr(row, "keys") else False
    pred_data = None
    if has_pred and row["burnout_score"] is not None:
        pred_data = {
            "score": row["burnout_score"],
            "risk": row["risk_level"],
            "topDriver": {
                "name": row["top_driver"]
            },
            "recommendations": [
                [row["rec_title"], row["rec_description"]]
            ] if row["rec_title"] else []
        }

    return {
        "id": row["employee_id"],
        "name": row["name"],
        "department": row["department"],
        "designation": row["designation"],
        "email": row["email"],
        "age": row["age"],
        "gender": row["gender"],
        "experience": row["experience_years"],
        "salary_level": row["salary_level"],
        "work_hours": row["work_hours"],
        "overtime_hours": row["overtime_hours"],
        "leave_days": row["leave_days"],
        "task_load": row["task_load"],
        "completion_rate": row["completion_rate"],
        "meeting_hours": row["meeting_hours"],
        "job_satisfaction": row["job_satisfaction"],
        "stress_level": row["stress_level"],
        "feedback": row["feedback_text"] or "",
        "prediction": pred_data
    }


def load_employees() -> list[dict[str, object]]:
    with connect_db() as conn:
        rows = conn.execute(
            """
            SELECT e.employee_id, e.name, e.department, e.designation, e.email, e.age,
                   e.gender, e.experience_years, e.salary_level,
                   wm.work_hours, wm.overtime_hours, wm.leave_days, wm.task_load,
                   wm.completion_rate, wm.meeting_hours, wm.job_satisfaction, wm.stress_level,
                   fe.feedback_text,
                   bp.burnout_score, bp.risk_level, bp.top_driver,
                   wr.title AS rec_title, wr.description AS rec_description
            FROM employees e
            LEFT JOIN work_metrics wm ON wm.employee_id = e.employee_id
              AND wm.metric_id = (SELECT MAX(metric_id) FROM work_metrics WHERE employee_id = e.employee_id)
            LEFT JOIN feedback_entries fe ON fe.employee_id = e.employee_id
              AND fe.feedback_id = (SELECT MAX(feedback_id) FROM feedback_entries WHERE employee_id = e.employee_id)
            LEFT JOIN burnout_predictions bp ON bp.employee_id = e.employee_id
              AND bp.prediction_id = (SELECT MAX(prediction_id) FROM burnout_predictions WHERE employee_id = e.employee_id)
            LEFT JOIN wellness_recommendations wr ON wr.prediction_id = bp.prediction_id
            ORDER BY e.name
            """
        ).fetchall()
    return [_serialize_employee(row) for row in rows]


def create_employee(payload: dict[str, object]) -> dict[str, object]:
    _validate_employee_payload(payload)
    prediction = predict_burnout(payload)
    employee_id = str(payload.get("id") or f"EMP-{int(time.time())}")
    metric_month = date.today().isoformat()
    with connect_db() as conn:
        existing = conn.execute("SELECT 1 FROM employees WHERE employee_id = ?", (employee_id,)).fetchone()
        if existing:
            raise ValueError("Employee id already exists")
        conn.execute(
            """
            INSERT INTO employees (
                employee_id, name, department, designation, email, age, gender,
                experience_years, salary_level
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                employee_id,
                _sanitize_string(payload.get("name")),
                _sanitize_string(payload.get("department")),
                _sanitize_string(payload.get("designation")),
                _sanitize_string(payload.get("email")),
                payload.get("age"),
                payload.get("gender") or "—",
                payload.get("experience"),
                payload.get("salary_level"),
            ),
        )
        conn.execute(
            """
            INSERT INTO work_metrics (
                employee_id, metric_month, work_hours, overtime_hours, leave_days,
                task_load, completion_rate, meeting_hours, job_satisfaction, stress_level
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                employee_id,
                metric_month,
                payload.get("work_hours", 8.0),
                payload.get("overtime_hours", 0.0),
                payload.get("leave_days", 2),
                payload.get("task_load", 50),
                payload.get("completion_rate", 75),
                payload.get("meeting_hours", 5.0),
                payload.get("job_satisfaction", 60),
                payload.get("stress_level", 40),
            ),
        )
        conn.execute(
            """
            INSERT INTO feedback_entries (
                employee_id, feedback_text, sentiment_label, positive_score, negative_score
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                employee_id,
                _sanitize_string(payload.get("feedback", "")),
                prediction.sentiment.label,
                prediction.sentiment.positive,
                prediction.sentiment.negative,
            ),
        )
        cursor = conn.execute(
            """
            INSERT INTO burnout_predictions (
                employee_id, burnout_score, risk_level, top_driver
            ) VALUES (?, ?, ?, ?)
            """,
            (
                employee_id,
                prediction.score,
                prediction.risk,
                prediction.top_driver.name,
            ),
        )
        conn.execute(
            """
            INSERT INTO wellness_recommendations (
                prediction_id, title, description, status
            ) VALUES (?, ?, ?, ?)
            """,
            (
                cursor.lastrowid,
                prediction.recommendations[0]["title"] if prediction.recommendations else "Check-in",
                prediction.recommendations[0]["description"] if prediction.recommendations else "Review workload and support recovery.",
                "Pending",
            ),
        )
        conn.commit()
    return _json_success("Employee saved", 201, employee={"id": employee_id, "name": _sanitize_string(payload.get("name"))})


def update_employee(payload: dict[str, object]) -> dict[str, object]:
    employee_id = _sanitize_string(payload.get("id"))
    name = _sanitize_string(payload.get("name"))
    department = _sanitize_string(payload.get("department"))
    designation = _sanitize_string(payload.get("designation"))
    email = _sanitize_string(payload.get("email"))
    age = payload.get("age")
    experience = payload.get("experience")
    
    if not employee_id:
        raise ValueError("Employee ID is required")
    if not name or not department or not designation or not email:
        raise ValueError("name, department, designation, and email are required")
    if not validate_email(email):
        raise ValueError("Invalid email format")
    if age is not None:
        if not isinstance(age, (int, float)) or age < 18 or age > 65:
            raise ValueError("age must be between 18 and 65")
    if experience is not None:
        if not isinstance(experience, (int, float)) or experience < 0 or experience > 40:
            raise ValueError("experience must be between 0 and 40")

    with connect_db() as conn:
        existing = conn.execute("SELECT 1 FROM employees WHERE employee_id = ?", (employee_id,)).fetchone()
        if not existing:
            raise ValueError("Employee does not exist")
            
        duplicate_email = conn.execute("SELECT 1 FROM employees WHERE email = ? AND employee_id != ?", (email, employee_id)).fetchone()
        if duplicate_email:
            raise ValueError("Email already in use by another employee")
            
        conn.execute(
            """
            UPDATE employees
            SET name = ?, department = ?, designation = ?, email = ?, age = ?, experience_years = ?
            WHERE employee_id = ?
            """,
            (name, department, designation, email, age, experience, employee_id)
        )
        conn.commit()
    return _json_success("Employee profile updated", 200)


def add_weekly_update(payload: dict[str, object]) -> dict[str, object]:
    employee_id = _sanitize_string(payload.get("id"))
    if not employee_id:
        raise ValueError("Employee ID is required")
        
    for key in ("work_hours", "overtime_hours", "leave_days", "meeting_hours", "task_load", "completion_rate", "job_satisfaction", "stress_level"):
        value = payload.get(key)
        if value is None:
            raise ValueError(f"{key} is required")
        if not isinstance(value, (int, float)):
            raise ValueError(f"{key} must be numeric")
        if key in {"task_load", "completion_rate", "job_satisfaction", "stress_level"} and not (0 <= float(value) <= 100):
            raise ValueError(f"{key} must be between 0 and 100")
            
    with connect_db() as conn:
        existing = conn.execute("SELECT 1 FROM employees WHERE employee_id = ?", (employee_id,)).fetchone()
        if not existing:
            raise ValueError("Employee does not exist")
            
        prediction = predict_burnout(payload)
        metric_month = date.today().isoformat()
        
        existing_metric = conn.execute(
            "SELECT metric_id FROM work_metrics WHERE employee_id = ? AND metric_month = ?",
            (employee_id, metric_month)
        ).fetchone()
        
        if existing_metric:
            conn.execute(
                """
                UPDATE work_metrics
                SET work_hours = ?, overtime_hours = ?, leave_days = ?, task_load = ?,
                    completion_rate = ?, meeting_hours = ?, job_satisfaction = ?, stress_level = ?
                WHERE metric_id = ?
                """,
                (
                    payload.get("work_hours"),
                    payload.get("overtime_hours"),
                    payload.get("leave_days"),
                    payload.get("task_load"),
                    payload.get("completion_rate"),
                    payload.get("meeting_hours"),
                    payload.get("job_satisfaction"),
                    payload.get("stress_level"),
                    existing_metric["metric_id"]
                )
            )
        else:
            conn.execute(
                """
                INSERT INTO work_metrics (
                    employee_id, metric_month, work_hours, overtime_hours, leave_days,
                    task_load, completion_rate, meeting_hours, job_satisfaction, stress_level
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    employee_id,
                    metric_month,
                    payload.get("work_hours"),
                    payload.get("overtime_hours"),
                    payload.get("leave_days"),
                    payload.get("task_load"),
                    payload.get("completion_rate"),
                    payload.get("meeting_hours"),
                    payload.get("job_satisfaction"),
                    payload.get("stress_level")
                )
            )
        conn.execute(
            """
            INSERT INTO feedback_entries (
                employee_id, feedback_text, sentiment_label, positive_score, negative_score
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                employee_id,
                _sanitize_string(payload.get("feedback", "")),
                prediction.sentiment.label,
                prediction.sentiment.positive,
                prediction.sentiment.negative,
            ),
        )
        cursor = conn.execute(
            """
            INSERT INTO burnout_predictions (
                employee_id, burnout_score, risk_level, top_driver
            ) VALUES (?, ?, ?, ?)
            """,
            (
                employee_id,
                prediction.score,
                prediction.risk,
                prediction.top_driver.name,
            ),
        )
        conn.execute(
            """
            INSERT INTO wellness_recommendations (
                prediction_id, title, description, status
            ) VALUES (?, ?, ?, ?)
            """,
            (
                cursor.lastrowid,
                prediction.recommendations[0]["title"] if prediction.recommendations else "Check-in",
                prediction.recommendations[0]["description"] if prediction.recommendations else "Review workload and support recovery.",
                "Pending",
            ),
        )
        conn.commit()
        
    return _json_success("Weekly metrics updated", 200, prediction=prediction.to_dict())


def register_user(payload: dict[str, object]) -> dict[str, object]:
    email = _sanitize_string(payload.get("email"))
    password = _sanitize_string(payload.get("password"))
    role = _sanitize_string(payload.get("role") or "user")
    if not email or not password:
        raise ValueError("email and password are required")
    if not validate_email(email):
        raise ValueError("Invalid email format")
    if role not in {"user", "admin"}:
        raise ValueError("role must be user or admin")
    password_error = validate_password_strength(password)
    if password_error:
        raise ValueError(password_error)
    with connect_db() as conn:
        existing = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise ValueError("User already exists")
        password_hash = hash_password(password)
        conn.execute(
            "INSERT INTO users (email, password_hash, role, is_active) VALUES (?, ?, ?, 1)",
            (email, password_hash, role),
        )
        conn.commit()
    return _json_success("User registered", 201, user={"email": email, "role": role})


def authenticate_user(payload: dict[str, object]) -> dict[str, object]:
    email = _sanitize_string(payload.get("email"))
    password = _sanitize_string(payload.get("password"))
    if not email or not password:
        raise ValueError("email and password are required")
    with connect_db() as conn:
        row = conn.execute("SELECT user_id, email, password_hash, role, is_active, needs_password_change FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        raise ValueError("Invalid credentials")
    if not row["is_active"]:
        raise ValueError("Account disabled")
    if not verify_password(password, row["password_hash"]):
        raise ValueError("Invalid credentials")
    access_token = create_jwt({"sub": row["email"], "role": row["role"], "needs_password_change": row["needs_password_change"]})
    refresh_token = create_jwt({"sub": row["email"], "role": row["role"], "type": "refresh"}, ttl_seconds=60 * 60 * 24 * 30)
    
    expires_at = int(time.time()) + (60 * 60 * 24 * 30)
    with connect_db() as conn:
        conn.execute(
            "INSERT INTO refresh_tokens (token, email, expires_at, is_revoked) VALUES (?, ?, ?, 0)",
            (refresh_token, row["email"], expires_at)
        )
        conn.commit()
        
    return _json_success(
        "Authenticated", 
        200, 
        access_token=access_token, 
        refresh_token=refresh_token, 
        user={"email": row["email"], "role": row["role"]},
        password_change_required=bool(row["needs_password_change"])
    )


def refresh_access_token(payload: dict[str, object]) -> dict[str, object]:
    refresh_token = _sanitize_string(payload.get("refresh_token"))
    if not refresh_token:
        raise ValueError("refresh_token is required")
    decoded = verify_jwt(refresh_token)
    if not decoded or decoded.get("type") != "refresh":
        raise ValueError("Invalid or expired refresh token")
        
    email = decoded["sub"]
    role = decoded["role"]
    
    with connect_db() as conn:
        row = conn.execute("SELECT token_id, is_revoked, expires_at FROM refresh_tokens WHERE token = ?", (refresh_token,)).fetchone()
        if not row:
            raise ValueError("Invalid refresh token")
        if row["is_revoked"] or row["expires_at"] < int(time.time()):
            conn.execute("UPDATE refresh_tokens SET is_revoked = 1 WHERE email = ?", (email,))
            conn.commit()
            raise ValueError("Invalid or expired refresh token")
            
        conn.execute("UPDATE refresh_tokens SET is_revoked = 1 WHERE token_id = ?", (row["token_id"],))
        
        user_row = conn.execute("SELECT needs_password_change FROM users WHERE email = ?", (email,)).fetchone()
        needs_change = user_row["needs_password_change"] if user_row else 0
        
        new_access_token = create_jwt({"sub": email, "role": role, "needs_password_change": needs_change})
        new_refresh_token = create_jwt({"sub": email, "role": role, "type": "refresh"}, ttl_seconds=60 * 60 * 24 * 30)
        
        expires_at = int(time.time()) + (60 * 60 * 24 * 30)
        conn.execute(
            "INSERT INTO refresh_tokens (token, email, expires_at, is_revoked) VALUES (?, ?, ?, 0)",
            (new_refresh_token, email, expires_at)
        )
        conn.commit()
        
    return _json_success("Token refreshed", 200, access_token=new_access_token, refresh_token=new_refresh_token)


def logout_user(payload: dict[str, object]) -> dict[str, object]:
    refresh_token = _sanitize_string(payload.get("refresh_token"))
    if refresh_token:
        with connect_db() as conn:
            conn.execute("UPDATE refresh_tokens SET is_revoked = 1 WHERE token = ?", (refresh_token,))
            conn.commit()
    return _json_success("Logged out successfully", 200)


def change_password(user_email: str, payload: dict[str, object]) -> dict[str, object]:
    current_password = _sanitize_string(payload.get("current_password"))
    new_password = _sanitize_string(payload.get("new_password"))
    if not current_password or not new_password:
        raise ValueError("Current password and new password are required")
        
    with connect_db() as conn:
        row = conn.execute("SELECT password_hash, role FROM users WHERE email = ?", (user_email,)).fetchone()
        if not row:
            raise ValueError("User not found")
        if not verify_password(current_password, row["password_hash"]):
            raise ValueError("Incorrect current password")
        strength_error = validate_password_strength(new_password)
        if strength_error:
            raise ValueError(strength_error)
            
        new_hash = hash_password(new_password)
        conn.execute(
            "UPDATE users SET password_hash = ?, needs_password_change = 0 WHERE email = ?",
            (new_hash, user_email)
        )
        conn.execute("UPDATE refresh_tokens SET is_revoked = 1 WHERE email = ?", (user_email,))
        conn.commit()
        
        access_token = create_jwt({"sub": user_email, "role": row["role"], "needs_password_change": 0})
        refresh_token = create_jwt({"sub": user_email, "role": row["role"], "type": "refresh"}, ttl_seconds=60 * 60 * 24 * 30)
        
        expires_at = int(time.time()) + (60 * 60 * 24 * 30)
        conn.execute(
            "INSERT INTO refresh_tokens (token, email, expires_at, is_revoked) VALUES (?, ?, ?, 0)",
            (refresh_token, user_email, expires_at)
        )
        conn.commit()
        
    return _json_success("Password changed successfully", 200, access_token=access_token, refresh_token=refresh_token)


def get_user_from_auth(header_value: str | None) -> tuple[dict[str, object] | None, str | None]:
    if not header_value or not header_value.startswith("Bearer "):
        return None, None
    token = header_value[len("Bearer "):].strip()
    payload = verify_jwt(token)
    if not payload:
        return None, "invalid_token"
    if payload.get("type") == "refresh":
        return None, "refresh_not_allowed"
    return payload, None


class BurnoutRequestHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)


    def end_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        allowed_origins = [o.strip() for o in CORS_ALLOW_ORIGIN.split(",")]
        if "*" in allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin if origin else "*")
        elif origin == "null" or origin in allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        else:
            self.send_header("Access-Control-Allow-Origin", allowed_origins[0])
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/health":
            self.write_json(_json_success("Healthy", 200, service="burnout-api"))
            return
        if path == "/api/employees":
            user_payload, token_error = get_user_from_auth(self.headers.get("Authorization"))
            if not user_payload:
                self.write_json(_json_error("Authentication required", 401), status=401)
                return
            if user_payload.get("needs_password_change"):
                self.write_json(_json_error("Password change required", 403, {"needs_password_change": True}), status=403)
                return
            if user_payload.get("role") not in {"admin", "user"}:
                self.write_json(_json_error("Forbidden", 403), status=403)
                return
            employees = load_employees()
            if not employees and DATA_FILE.exists():
                employees = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            self.write_json(_json_success("Employees loaded", 200, employees=employees))
            return
        if path == "/api/model/metrics":
            user_payload, token_error = get_user_from_auth(self.headers.get("Authorization"))
            if not user_payload:
                self.write_json(_json_error("Authentication required", 401), status=401)
                return
            if user_payload.get("needs_password_change"):
                self.write_json(_json_error("Password change required", 403, {"needs_password_change": True}), status=403)
                return
            metrics_file = ROOT / "backend" / "model_metrics.json"
            if metrics_file.exists():
                try:
                    metrics_data = json.loads(metrics_file.read_text(encoding="utf-8"))
                    self.write_json(_json_success("Metrics loaded", 200, metrics=metrics_data))
                except Exception:
                    self.write_json(_json_error("Error loading model metrics", 500), status=500)
            else:
                self.write_json(_json_error("Model metrics not found", 404), status=404)
            return
        if path == "/api/openapi.json":
            spec = {
                "openapi": "3.0.0",
                "info": {"title": "Burnout API", "version": "1.0.0"},
                "paths": {
                    "/api/health": {"get": {"responses": {"200": {"description": "ok"}}}},
                    "/api/register": {"post": {"responses": {"201": {"description": "created"}}}},
                    "/api/login": {"post": {"responses": {"200": {"description": "ok"}}}},
                    "/api/auth/refresh": {"post": {"responses": {"200": {"description": "ok"}}}},
                    "/api/auth/logout": {"post": {"responses": {"200": {"description": "ok"}}}},
                    "/api/auth/change-password": {"post": {"responses": {"200": {"description": "ok"}}}},
                    "/api/employees": {"get": {"responses": {"200": {"description": "ok"}}}, "post": {"responses": {"201": {"description": "created"}}}},
                    "/api/employees/update": {"post": {"responses": {"200": {"description": "ok"}}}},
                    "/api/employees/weekly-update": {"post": {"responses": {"200": {"description": "ok"}}}},
                    "/api/predict": {"post": {"responses": {"200": {"description": "ok"}}}},
                    "/api/model/metrics": {"get": {"responses": {"200": {"description": "ok"}}}},
                },
            }
            self.write_json(spec)
            return
        
        # Serve static files
        if not path.startswith("/api/"):
            if path == "/":
                file_path = ROOT / "index.html"
            else:
                rel_path = path.lstrip("/")
                file_path = (ROOT / rel_path).resolve()
            
            try:
                file_path.relative_to(ROOT)
            except ValueError:
                self.send_error(403, "Access Forbidden")
                return
                
            if file_path.is_file():
                ext = file_path.suffix.lower()
                content_type = "text/plain"
                if ext == ".html":
                    content_type = "text/html; charset=utf-8"
                elif ext == ".js":
                    content_type = "application/javascript; charset=utf-8"
                elif ext == ".css":
                    content_type = "text/css; charset=utf-8"
                elif ext == ".json":
                    content_type = "application/json; charset=utf-8"
                
                try:
                    data = file_path.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as e:
                    self.send_error(500, f"Internal Server Error: {e}")
                return
        
        self.write_json(_json_error("Not found", 404), status=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > 1024 * 1024:  # 1MB limit
            self.write_json(_json_error("Payload Too Large", 413), status=413)
            return
            
        try:
            payload = _parse_json_body(self)
            _sanitize_payload_xss(payload)
        except ValueError as exc:
            self.write_json(_json_error(str(exc), 400), status=400)
            return
            
        if path == "/api/register":
            try:
                response = register_user(payload)
                self.write_json(response, status=201)
            except ValueError as exc:
                self.write_json(_json_error(str(exc), 409), status=409)
            except Exception as exc:
                logger.exception("Registration failed")
                self.write_json(_json_error("Internal server error", 500), status=500)
            return
        if path == "/api/login":
            try:
                response = authenticate_user(payload)
                self.write_json(response, status=200)
            except ValueError as exc:
                self.write_json(_json_error(str(exc), 401), status=401)
            except Exception as exc:
                logger.exception("Login failed")
                self.write_json(_json_error("Internal server error", 500), status=500)
            return
        if path == "/api/auth/refresh":
            try:
                response = refresh_access_token(payload)
                self.write_json(response, status=200)
            except ValueError as exc:
                self.write_json(_json_error(str(exc), 401), status=401)
            except Exception:
                self.write_json(_json_error("Internal server error", 500), status=500)
            return
        if path == "/api/auth/logout":
            try:
                response = logout_user(payload)
                self.write_json(response, status=200)
            except Exception:
                self.write_json(_json_error("Internal server error", 500), status=500)
            return

        user_payload, token_error = get_user_from_auth(self.headers.get("Authorization"))
        if not user_payload:
            self.write_json(_json_error("Authentication required", 401), status=401)
            return

        if path == "/api/auth/change-password":
            try:
                response = change_password(user_payload["sub"], payload)
                self.write_json(response, status=200)
            except ValueError as exc:
                self.write_json(_json_error(str(exc), 400), status=400)
            except Exception:
                logger.exception("Password change failed")
                self.write_json(_json_error("Internal server error", 500), status=500)
            return

        if user_payload.get("needs_password_change"):
            self.write_json(_json_error("Password change required", 403, {"needs_password_change": True}), status=403)
            return

        if path == "/api/employees":
            try:
                if user_payload.get("role") != "admin":
                    self.write_json(_json_error("Forbidden: Admin access required", 403), status=403)
                    return
                response = create_employee(payload)
                self.write_json(response, status=201)
            except ValueError as exc:
                self.write_json(_json_error(str(exc), 422), status=422)
            except sqlite3.Error as exc:
                logger.exception("Employee insert failed")
                self.write_json(_json_error("Database error", 500), status=500)
            return
        if path == "/api/employees/update":
            try:
                if user_payload.get("role") != "admin":
                    self.write_json(_json_error("Forbidden: Admin access required", 403), status=403)
                    return
                response = update_employee(payload)
                self.write_json(response, status=200)
            except ValueError as exc:
                self.write_json(_json_error(str(exc), 422), status=422)
            except sqlite3.Error as exc:
                logger.exception("Employee update failed")
                self.write_json(_json_error("Database error", 500), status=500)
            return
        if path == "/api/employees/weekly-update":
            try:
                if user_payload.get("role") != "admin":
                    self.write_json(_json_error("Forbidden: Admin access required", 403), status=403)
                    return
                response = add_weekly_update(payload)
                self.write_json(response, status=200)
            except ValueError as exc:
                self.write_json(_json_error(str(exc), 422), status=422)
            except sqlite3.Error as exc:
                logger.exception("Weekly update failed")
                self.write_json(_json_error("Database error", 500), status=500)
            return
        if path == "/api/predict":
            try:
                _validate_metrics_payload(payload)
                prediction = predict_burnout(payload).to_dict()
                self.write_json(_json_success("Prediction generated", 200, prediction=prediction))
            except ValueError as exc:
                self.write_json(_json_error(str(exc), 422), status=422)
            except Exception as exc:
                logger.exception("Prediction failed")
                self.write_json(_json_error("Internal server error", 500), status=500)
            return

        self.send_error(404, "Not found")

    def write_json(self, payload: object, status: int = 200) -> None:
        encoded = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    init_db()
    seed_admin_user()
    
    port_str = os.environ.get("PORT", "8001")
    try:
        port = int(port_str)
    except ValueError:
        port = 8001
        
    server = ThreadingHTTPServer(("0.0.0.0", port), BurnoutRequestHandler)
    logger.info(f"Burnout app running at http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
