FROM python:3.12-slim

WORKDIR /app

# Install uv for fast, reproducible installs from the lockfile.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy the project files needed to install deps.
COPY pyproject.toml uv.lock ./
COPY app/ ./app/

# Install the locked production dependencies into the system Python.
# --system avoids needing a venv; the lockfile pins psycopg[binary] etc.
RUN uv pip install --system --no-cache .

# Render injects PORT; default to 8000 for local docker runs.
ENV PORT=8000
EXPOSE 8000

# Bind to $PORT (Render) without --reload (production).
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
