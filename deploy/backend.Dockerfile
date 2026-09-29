# Paneltec Safety Portal: API server (self-hosted)
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/opt/shims

RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr poppler-utils fonts-dejavu-core libgl1 libglib2.0-0 \
        build-essential curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/requirements.txt /tmp/requirements.txt
# Emergent-only packages are swapped for deploy/shims (AI goes straight to Anthropic).
RUN grep -viE "emergentintegrations|litellm|assets\.emergent|emergentagent" /tmp/requirements.txt > /tmp/req.txt \
    && pip install -r /tmp/req.txt

COPY deploy/shims /opt/shims
COPY backend /app/backend
RUN rm -f /app/backend/.env && mkdir -p /app/backend/uploads /app/backend/static/downloads

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8001/api/health >/dev/null || exit 1
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--proxy-headers", "--forwarded-allow-ips", "*"]
