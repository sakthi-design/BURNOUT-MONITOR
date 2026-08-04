FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Create directories for DB and logs
RUN mkdir -p database backend && chmod -R 777 database backend

# Expose port
EXPOSE 8001

# Environment variables default
ENV PORT=8001
ENV JWT_SECRET=f7e3ba90022f48d1b11ceca8e332a67e9f3b89b88939cb9ff3d8544a0e1c0704
ENV CORS_ALLOW_ORIGIN=*

# Run API server
CMD ["python", "-u", "backend/api_server.py"]
