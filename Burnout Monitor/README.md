# AI-Powered Employee Burnout Detection and Well-being Monitoring System

A secure, production-ready enterprise application for monitoring employee burnout risk from daily work patterns, self-reported metrics, and feedback sentiment. Integrates machine learning classification (Scikit-Learn Random Forest) with an interactive dashboard, robust JWT authentication, refresh token rotation, and Docker container orchestration.

## Production Features

- **Robust Authentication & Access Controls**:
  - JWT tokens for access (1-hour expiration) and refresh tokens (30-day expiration).
  - **Refresh Token Rotation (RTR)**: Refresh tokens are rotated on every refresh request. Reusing a rotated refresh token triggers immediate session revocation for safety.
  - **Force Password Change**: Default administrator accounts are flagged in the database. Access to core endpoints is restricted (returning `403 Forbidden`) until the admin changes their password from the default seed value.
- **Enterprise-Grade Security (OWASP Top 10 Protected)**:
  - Input sanitization against script and HTML injection (XSS protection).
  - Payloads restricted to a maximum of 1MB to prevent Denial of Service (DoS) attacks.
  - Parameterized database queries to guarantee zero SQL Injection vulnerabilities.
  - Hardened Nginx configurations with strict Content Security Policy (CSP), frame options, and type sniffing constraints.
- **Machine Learning Early Warnings**:
  - Predicts burnout probability and risk category ("Low", "Medium", "High", "Critical").
  - Powered by a Scikit-Learn Random Forest Classifier model pipeline (`burnout_model.pkl`).
  - Implements a deterministic heuristic fallback if the ML model is loading or compiling.
  - Auto-retrains automatically on startup if the model file is missing or has a `scikit-learn` version mismatch.
- **Persistent Audit Logging**:
  - Outputs system logs (API calls, authentication events, prediction logging) to console and a rotating file system handler (`backend/app.log`).
- **Database Persistence**:
  - Utilizes SQLite for local development.
  - Provides a migration schema file for PostgreSQL/MySQL integration in production.

---

## Folder Structure

```text
.
|-- index.html                  # Frontend dashboard interface HTML
|-- Dockerfile                  # API server Docker build instructions
|-- docker-compose.yml          # Container orchestration service setup
|-- nginx.conf                  # Nginx proxy and static assets server config
|-- requirements.txt            # Python backend dependencies
|-- pyproject.toml              # Project tool config
|-- src/
|   |-- app.js                  # Frontend app orchestration
|   `-- styles.css              # Custom CSS variables & visual themes
|-- data/
|   |-- sampleData.js           # Frontend data seed
|   |-- burnout_training.csv    # ML training dataset
|   `-- sample_employees.json   # Employee seed records
|-- backend/
|   |-- __init__.py
|   |-- api_server.py           # HTTP server, routing, endpoints & sanitizers
|   |-- auth.py                 # Hashing (bcrypt), strength checks, JWT verify
|   |-- burnout_engine.py       # ML loading, heuristics, feature engineering
|   |-- train_model.py          # Random Forest trainer & pipeline generator
|   |-- burnout_model.pkl       # Serialized RF model pipeline
|   `-- model_metrics.json      # Model performance statistics
|-- database/
|   |-- schema.sql              # SQLite database layout definition
|   |-- schema_postgresql.sql   # PostgreSQL database layout definition
|   `-- burnout.db              # SQLite development database file
|-- docs/
|   |-- project-report.md       # Project analysis documentation
|   `-- uml-diagrams.md         # Architecture flows and diagrams
`-- tests/
    `-- test_api.py             # Security, Auth, Validation & REST API tests
```

---

## Getting Started

### Local Development

1. **Install Python Dependencies**:
   Ensure you have Python 3.10+ installed:
   ```bash
   pip install -r requirements.txt
   ```

2. **Start the API Server**:
   Start the backend application directly:
   ```bash
   python backend/api_server.py
   ```
   This will initialize the database, seed the default admin account, and verify the ML model file. If the model is missing, it will automatically retrain.

3. **Access the App**:
   Serve the root directory using any local static server (e.g. `npx serve .` or `python -m http.server 8000`), or launch the application via:
   ```text
   http://localhost:8001
   ```

---

## Production Deployment (Docker & Nginx)

Run the entire stack (API, Nginx static file server, and reverse proxy) using Docker Compose:

```bash
docker-compose up --build -d
```

This starts:
- **`burnout-api`**: Python backend running on port `8001` (internal).
- **`burnout-nginx`**: Nginx proxy listening on port `80` (external). It hosts the static HTML/JS frontend and routes requests matching `/api/*` to the backend API container.

---

## API Documentation

### Public Endpoints

#### `POST /api/login`
Authenticates the user and returns access and refresh tokens.
- **Request Body**:
  ```json
  {
    "email": "admin@burnout.local",
    "password": "AdminPassword@123"
  }
  ```
- **Response Payload**:
  ```json
  {
    "success": true,
    "message": "Authenticated",
    "access_token": "...",
    "refresh_token": "...",
    "password_change_required": true
  }
  ```

#### `POST /api/register`
Creates a new user profile.
- **Request Body**:
  ```json
  {
    "email": "hr_staff@company.local",
    "password": "SecurePassword@2026",
    "role": "user"
  }
  ```

#### `POST /api/auth/refresh`
Performs Refresh Token Rotation. Takes a refresh token and returns rotated fresh tokens.
- **Request Body**:
  ```json
  {
    "refresh_token": "..."
  }
  ```

#### `POST /api/auth/logout`
Revokes the refresh token in the database.
- **Request Body**:
  ```json
  {
    "refresh_token": "..."
  }
  ```

---

### Protected Endpoints (Requires `Authorization: Bearer <token>`)

#### `POST /api/auth/change-password`
Changes the user's password and clears the `needs_password_change` enforcement flag.
- **Request Body**:
  ```json
  {
    "current_password": "AdminPassword@123",
    "new_password": "NewSecurePassword@2026!"
  }
  ```

#### `GET /api/employees`
Loads all employee details and metrics alongside pre-calculated ML predictions from the database.

#### `POST /api/employees`
Registers a new employee and runs the ML burnout predictor pipeline. (Admin access only).

#### `POST /api/employees/weekly-update`
Updates an employee's work metrics and runs the ML burnout predictor. (Admin access only).

#### `POST /api/predict`
Runs the ML model predictor for a set of raw metrics (returns prediction detail without database insertion).

---

## Troubleshooting

- **Token Refresh Loop / Logouts**:
  Ensure that you are saving the rotated `refresh_token` returned by `/api/auth/refresh` on the client. Using a refresh token more than once will revoke all active sessions for that user for security.
- **ML Loading Errors**:
  Check `backend/app.log` for sklearn validation errors. The server will automatically run `backend/train_model.py` if python dependencies change.
- **Nginx CORS Errors**:
  If connecting from external domains, ensure they are specified in `CORS_ALLOW_ORIGIN` in the `.env` configuration file.

