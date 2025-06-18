FROM python:3.9.7-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install build tools
RUN python -m pip install --no-cache-dir --upgrade pip setuptools wheel

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set environment variables
ENV PORT=10000
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=backend.py
ENV FLASK_ENV=production

# Expose the port
EXPOSE $PORT

# Run the application
CMD gunicorn --bind 0.0.0.0:$PORT --workers 4 --threads 2 --timeout 120 backend:app 