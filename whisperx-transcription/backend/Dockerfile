# One image, two services: the API runs it on CPU, the worker runs it with the
# GPU attached. Keeping them identical means the worker can import the same
# db/storage modules the API writes through.
# Must stay on torch 2.8.x with cuDNN 9: whisperx requires torch~=2.8.0, and the
# ctranslate2 it pulls needs cuDNN 9. The old 2.3.0-cuda12.1-cudnn8 image was
# also on Ubuntu 22.04, whose FFmpeg 4.4 headers could not build PyAV.
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/data/models

# Runtime only. No toolchain or FFmpeg headers are needed: requirements.txt
# pins av to a version that ships a manylinux wheel, so nothing is compiled.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Overridden per service in docker-compose.yml.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
