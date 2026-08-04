-- PostgreSQL Schema for Burnout Monitor

-- Create enum for user roles if not exists
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL,
  is_active INT NOT NULL DEFAULT 1,
  needs_password_change INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  expires_at BIGINT NOT NULL,
  is_revoked INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  department VARCHAR(100) NOT NULL,
  designation VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  age INT,
  gender VARCHAR(50),
  experience_years NUMERIC(4,2),
  salary_level INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_age CHECK (age IS NULL OR (age BETWEEN 18 AND 65)),
  CONSTRAINT check_experience CHECK (experience_years IS NULL OR (experience_years BETWEEN 0 AND 40))
);

CREATE TABLE IF NOT EXISTS work_metrics (
  metric_id SERIAL PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  metric_month VARCHAR(10) NOT NULL,
  work_hours NUMERIC(4,2) NOT NULL,
  overtime_hours NUMERIC(4,2) NOT NULL,
  leave_days INT NOT NULL,
  task_load INT NOT NULL,
  completion_rate INT NOT NULL,
  meeting_hours NUMERIC(4,2) NOT NULL,
  job_satisfaction INT NOT NULL,
  stress_level INT NOT NULL,
  CONSTRAINT fk_employee_metrics FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
  CONSTRAINT check_task_load CHECK (task_load BETWEEN 0 AND 100),
  CONSTRAINT check_completion CHECK (completion_rate BETWEEN 0 AND 100),
  CONSTRAINT check_satisfaction CHECK (job_satisfaction BETWEEN 0 AND 100),
  CONSTRAINT check_stress CHECK (stress_level BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS feedback_entries (
  feedback_id SERIAL PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  feedback_text TEXT NOT NULL,
  sentiment_label VARCHAR(50),
  positive_score INT,
  negative_score INT,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anonymous INT DEFAULT 0,
  CONSTRAINT fk_employee_feedback FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS burnout_predictions (
  prediction_id SERIAL PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  burnout_score INT NOT NULL,
  risk_level VARCHAR(50) NOT NULL,
  top_driver VARCHAR(100),
  prediction_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_employee_predictions FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wellness_recommendations (
  recommendation_id SERIAL PRIMARY KEY,
  prediction_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending',
  assigned_to VARCHAR(255),
  due_date VARCHAR(50),
  CONSTRAINT fk_prediction_recommendation FOREIGN KEY (prediction_id) REFERENCES burnout_predictions(prediction_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_metrics_employee_month
  ON work_metrics(employee_id, metric_month);

CREATE INDEX IF NOT EXISTS idx_predictions_risk
  ON burnout_predictions(risk_level, prediction_date);
