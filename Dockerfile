FROM python:3.9.16-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install build tools
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies with specific order
RUN pip install --no-cache-dir numpy==1.20.3 && \
    pip install --no-cache-dir scipy==1.7.3 && \
    pip install --no-cache-dir scikit-learn==0.24.2 && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set environment variables
ENV PORT=10000
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=backend.py
ENV FLASK_ENV=production
ENV PYTHONPATH=/app
ENV PYTHONHASHSEED=1
ENV PYTHONIOENCODING=utf-8
ENV MPLCONFIGDIR=/tmp/matplotlib

# Expose the port
EXPOSE ${PORT}

# Run the application with specific worker configuration
CMD gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 2 --timeout 120 --worker-class gthread --preload backend:app 