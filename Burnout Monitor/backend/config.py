import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# On Vercel the filesystem is read-only except /tmp.
# VERCEL=1 is automatically set by the Vercel build environment.
_ON_VERCEL = os.getenv("VERCEL") == "1"

DB_PATH = Path("/tmp/burnout.db") if _ON_VERCEL else ROOT / "database" / "burnout.db"
LOG_PATH = Path("/tmp/app.log") if _ON_VERCEL else ROOT / "backend" / "app.log"
SCHEMA_FILE = ROOT / "database" / "schema.sql"
MODEL_PATH = ROOT / "backend" / "burnout_model.pkl"
TRAINING_DATA = ROOT / "data" / "burnout_training.csv"
OPENAPI_DOC = ROOT / "docs" / "openapi.json"

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_SECONDS = int(os.getenv("ACCESS_TOKEN_TTL_SECONDS", "3600"))
REFRESH_TOKEN_TTL_SECONDS = int(os.getenv("REFRESH_TOKEN_TTL_SECONDS", "2592000"))
DEFAULT_ADMIN_EMAIL = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@burnout.local")
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "AdminPassword@123")
CORS_ALLOW_ORIGIN = os.getenv("CORS_ALLOW_ORIGIN", "*")

