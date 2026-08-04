PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  is_active INTEGER NOT NULL DEFAULT 1,
  needs_password_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  designation TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  age INTEGER,
  gender TEXT,
  experience_years REAL,
  salary_level INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (age IS NULL OR (age BETWEEN 18 AND 65)),
  CHECK (experience_years IS NULL OR (experience_years BETWEEN 0 AND 40))
);

CREATE TABLE IF NOT EXISTS work_metrics (
  metric_id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL,
  metric_month TEXT NOT NULL,
  work_hours REAL NOT NULL,
  overtime_hours REAL NOT NULL,
  leave_days INTEGER NOT NULL,
  task_load INTEGER NOT NULL,
  completion_rate INTEGER NOT NULL,
  meeting_hours REAL NOT NULL,
  job_satisfaction INTEGER NOT NULL,
  stress_level INTEGER NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
  CHECK (task_load BETWEEN 0 AND 100),
  CHECK (completion_rate BETWEEN 0 AND 100),
  CHECK (job_satisfaction BETWEEN 0 AND 100),
  CHECK (stress_level BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS feedback_entries (
  feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL,
  feedback_text TEXT NOT NULL,
  sentiment_label TEXT,
  positive_score INTEGER,
  negative_score INTEGER,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anonymous INTEGER DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS burnout_predictions (
  prediction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL,
  burnout_score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  top_driver TEXT,
  prediction_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wellness_recommendations (
  recommendation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  assigned_to TEXT,
  due_date TEXT,
  FOREIGN KEY (prediction_id) REFERENCES burnout_predictions(prediction_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_metrics_employee_month
  ON work_metrics(employee_id, metric_month);

CREATE INDEX IF NOT EXISTS idx_predictions_risk
  ON burnout_predictions(risk_level, prediction_date);
