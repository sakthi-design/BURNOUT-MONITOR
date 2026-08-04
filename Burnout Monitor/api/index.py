"""Vercel WSGI entrypoint for the Burnout Monitor API.

Vercel's Python runtime requires a top-level WSGI callable named
``app`` or ``application``.  This file is a thin WSGI router that
delegates every request to the same business-logic functions already
used by the local ThreadingHTTPServer (backend/api_server.py).

No Flask, no FastAPI — pure stdlib WSGI.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Ensure "Burnout Monitor/" (the project root) is on sys.path so that
# ``from backend.xxx import ...`` works correctly when Vercel runs this
# file from the repo root.
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# ---------------------------------------------------------------------------
# Import all business-logic helpers.  Importing api_server triggers
# setup_logging() and init_model() at module load (cold start).
# ---------------------------------------------------------------------------
from backend.api_server import (  # noqa: E402
    DATA_FILE,
    ROOT,
    _json_error,
    _json_success,
    _sanitize_payload_xss,
    add_weekly_update,
    authenticate_user,
    change_password,
    create_employee,
    get_user_from_auth,
    init_db_once,
    load_employees,
    logout_user,
    refresh_access_token,
    register_user,
    update_employee,
)

# Initialise DB schema + admin seed on cold start (idempotent).
init_db_once()


# ---------------------------------------------------------------------------
# Tiny helpers
# ---------------------------------------------------------------------------

def _respond(start_response: object, status: int, body: dict) -> list[bytes]:
    encoded = json.dumps(body, indent=2).encode("utf-8")
    reason = {200: "OK", 201: "Created", 204: "No Content",
              400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
              404: "Not Found", 409: "Conflict", 413: "Payload Too Large",
              422: "Unprocessable Entity", 500: "Internal Server Error"}.get(status, "Unknown")
    start_response(f"{status} {reason}", [
        ("Content-Type", "application/json"),
        ("Content-Length", str(len(encoded))),
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type, Authorization"),
        ("X-Content-Type-Options", "nosniff"),
    ])
    return [encoded]


def _read_json(environ: dict) -> dict:
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length <= 0:
        return {}
    raw = environ["wsgi.input"].read(length)
    if not raw:
        return {}
    body = json.loads(raw.decode("utf-8"))
    if not isinstance(body, dict):
        raise ValueError("JSON body must be an object")
    return body


# ---------------------------------------------------------------------------
# WSGI application — Vercel looks for a variable named ``app``
# ---------------------------------------------------------------------------

def application(environ: dict, start_response) -> list[bytes]:  # noqa: C901
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = environ.get("PATH_INFO", "/")

    # ── CORS pre-flight ────────────────────────────────────────────────────
    if method == "OPTIONS":
        start_response("204 No Content", [
            ("Access-Control-Allow-Origin", "*"),
            ("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"),
            ("Access-Control-Allow-Headers", "Content-Type, Authorization"),
            ("Content-Length", "0"),
        ])
        return [b""]

    # ── GET routes ─────────────────────────────────────────────────────────
    if method == "GET":
        if path == "/api/health":
            return _respond(start_response, 200,
                            _json_success("Healthy", 200, service="burnout-api"))

        if path == "/api/employees":
            auth_header = environ.get("HTTP_AUTHORIZATION")
            user_payload, _ = get_user_from_auth(auth_header)
            if not user_payload:
                return _respond(start_response, 401, _json_error("Authentication required", 401))
            if user_payload.get("needs_password_change"):
                return _respond(start_response, 403,
                                _json_error("Password change required", 403,
                                            {"needs_password_change": True}))
            employees = load_employees()
            if not employees and DATA_FILE.exists():
                employees = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            return _respond(start_response, 200,
                            _json_success("Employees loaded", 200, employees=employees))

        if path == "/api/model/metrics":
            auth_header = environ.get("HTTP_AUTHORIZATION")
            user_payload, _ = get_user_from_auth(auth_header)
            if not user_payload:
                return _respond(start_response, 401, _json_error("Authentication required", 401))
            metrics_file = ROOT / "backend" / "model_metrics.json"
            if metrics_file.exists():
                try:
                    metrics_data = json.loads(metrics_file.read_text(encoding="utf-8"))
                    return _respond(start_response, 200,
                                    _json_success("Metrics loaded", 200, metrics=metrics_data))
                except Exception:
                    return _respond(start_response, 500, _json_error("Error loading model metrics", 500))
            return _respond(start_response, 404, _json_error("Model metrics not found", 404))

        if path == "/api/openapi.json":
            spec = {
                "openapi": "3.0.0",
                "info": {"title": "Burnout API", "version": "1.0.0"},
                "paths": {
                    "/api/health": {"get": {"responses": {"200": {"description": "ok"}}}},
                    "/api/employees": {"get": {}, "post": {}},
                    "/api/login": {"post": {}},
                    "/api/register": {"post": {}},
                    "/api/predict": {"post": {}},
                },
            }
            return _respond(start_response, 200, spec)

        return _respond(start_response, 404, _json_error("Not found", 404))

    # ── POST / PUT / DELETE routes ─────────────────────────────────────────
    if method in ("POST", "PUT", "DELETE"):
        # Read + validate body
        try:
            cl = int(environ.get("CONTENT_LENGTH") or 0)
            if cl > 1024 * 1024:
                return _respond(start_response, 413, _json_error("Payload Too Large", 413))
            payload = _read_json(environ)
            _sanitize_payload_xss(payload)
        except (ValueError, json.JSONDecodeError) as exc:
            return _respond(start_response, 400, _json_error(str(exc), 400))

        # ── Public auth endpoints ──────────────────────────────────────────
        if path == "/api/register":
            try:
                return _respond(start_response, 201, register_user(payload))
            except ValueError as exc:
                return _respond(start_response, 409, _json_error(str(exc), 409))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        if path == "/api/login":
            try:
                return _respond(start_response, 200, authenticate_user(payload))
            except ValueError as exc:
                return _respond(start_response, 401, _json_error(str(exc), 401))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        if path == "/api/auth/refresh":
            try:
                return _respond(start_response, 200, refresh_access_token(payload))
            except ValueError as exc:
                return _respond(start_response, 401, _json_error(str(exc), 401))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        if path == "/api/auth/logout":
            try:
                return _respond(start_response, 200, logout_user(payload))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        # ── Authenticated endpoints ────────────────────────────────────────
        auth_header = environ.get("HTTP_AUTHORIZATION")
        user_payload, _ = get_user_from_auth(auth_header)
        if not user_payload:
            return _respond(start_response, 401, _json_error("Authentication required", 401))

        if path == "/api/auth/change-password":
            try:
                return _respond(start_response, 200,
                                change_password(user_payload["sub"], payload))
            except ValueError as exc:
                return _respond(start_response, 400, _json_error(str(exc), 400))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        if user_payload.get("needs_password_change"):
            return _respond(start_response, 403,
                            _json_error("Password change required", 403,
                                        {"needs_password_change": True}))

        if path == "/api/employees" and method == "POST":
            if user_payload.get("role") != "admin":
                return _respond(start_response, 403,
                                _json_error("Forbidden: Admin access required", 403))
            try:
                return _respond(start_response, 201, create_employee(payload))
            except ValueError as exc:
                return _respond(start_response, 422, _json_error(str(exc), 422))
            except Exception:
                return _respond(start_response, 500, _json_error("Database error", 500))

        if path == "/api/employees/update":
            if user_payload.get("role") != "admin":
                return _respond(start_response, 403,
                                _json_error("Forbidden: Admin access required", 403))
            try:
                return _respond(start_response, 200, update_employee(payload))
            except ValueError as exc:
                return _respond(start_response, 422, _json_error(str(exc), 422))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        if path == "/api/employees/weekly-update":
            try:
                return _respond(start_response, 200, add_weekly_update(payload))
            except ValueError as exc:
                return _respond(start_response, 422, _json_error(str(exc), 422))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        if path == "/api/employees/delete":
            if user_payload.get("role") != "admin":
                return _respond(start_response, 403,
                                _json_error("Forbidden: Admin access required", 403))
            try:
                employee_id = payload.get("id", "")
                if not employee_id:
                    return _respond(start_response, 422, _json_error("Employee ID is required", 422))
                from backend.db import connect_db
                with connect_db() as conn:
                    conn.execute("DELETE FROM employees WHERE employee_id = ?", (employee_id,))
                    conn.commit()
                return _respond(start_response, 200, _json_success("Employee deleted", 200))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        if path == "/api/predict":
            try:
                from backend.burnout_engine import predict_burnout as _predict
                prediction = _predict(payload).to_dict()
                return _respond(start_response, 200,
                                _json_success("Prediction generated", 200, prediction=prediction))
            except ValueError as exc:
                return _respond(start_response, 422, _json_error(str(exc), 422))
            except Exception:
                return _respond(start_response, 500, _json_error("Internal server error", 500))

        return _respond(start_response, 404, _json_error("Not found", 404))

    return _respond(start_response, 405, _json_error("Method not allowed", 405))


# Vercel looks for ``app`` or ``application`` at the top level.
app = application
