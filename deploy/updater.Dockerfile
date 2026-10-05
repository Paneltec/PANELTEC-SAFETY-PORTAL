FROM python:3.11-slim
WORKDIR /updater
COPY deploy/paneltec_updater.py /updater/paneltec_updater.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "/updater/paneltec_updater.py"]
