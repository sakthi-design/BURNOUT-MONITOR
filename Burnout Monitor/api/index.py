"""Vercel serverless entrypoint for the Burnout Monitor API.

Vercel's Python runtime natively supports ``BaseHTTPRequestHandler`` subclasses
when exposed as ``Handler`` in this module. All routing logic lives in
``backend/api_server.py`` — this file is a zero-logic adapter.

On every cold start Vercel will import this module, which triggers:
  1. The ``sys.path`` setup so ``backend.*`` imports resolve correctly.
  2. ``init_db_once()`` which creates the SQLite schema in ``/tmp/burnout.db``
     and seeds the default admin user.
"""

from __future__ import annotations

import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Ensure the project root (Burnout Monitor/) is on sys.path so that
# ``from backend.xxx import ...`` works when Vercel calls this file from
# the repo root.  The api/ directory is one level below the project root.
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# ---------------------------------------------------------------------------
# Import the HTTP handler and the idempotent DB initializer.
# Importing api_server triggers setup_logging() and init_model() at module
# load time — exactly what we want for a serverless cold start.
# ---------------------------------------------------------------------------
from backend.api_server import BurnoutRequestHandler, init_db_once  # noqa: E402

# Initialise the database (creates schema + admin user) on cold start.
# Subsequent calls in the same container are no-ops due to the global flag.
init_db_once()

# Vercel's Python runtime looks for a class named ``Handler`` that is a
# subclass of ``http.server.BaseHTTPRequestHandler``.
Handler = BurnoutRequestHandler
