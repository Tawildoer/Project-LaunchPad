# Use Python 3.13 slim image
FROM python:3.13-slim

# Set working directory inside container
WORKDIR /app

# Copy dependency file and install packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code (optional, for when no volume mount)
COPY src/ .

# Expose a port for browser frontend to connect
EXPOSE 5000

# Default command to run backend
CMD ["python", "src/main.py"]