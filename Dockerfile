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

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt && \
    python -c "import numpy; print('NumPy version:', numpy.__version__)" && \
    python -c "import scipy; print('SciPy version:', scipy.__version__)" && \
    python -c "import sklearn; print('scikit-learn version:', sklearn.__version__)"

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