# Clipfy Render Worker — FFmpeg + yt-dlp + Node
FROM node:20-bookworm-slim

# System deps: ffmpeg, yt-dlp, fonts, deno e PO Token provider do YouTube.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      git \
      python3 \
      python3-pip \
      python3-opencv \
      python3-numpy \
      curl \
      unzip \
      ca-certificates \
      build-essential \
      libcairo2 \
      libcairo2-dev \
      libpango-1.0-0 \
      libpango1.0-dev \
      libjpeg62-turbo \
      libjpeg-dev \
      libgif7 \
      libgif-dev \
      librsvg2-2 \
      librsvg2-dev \
      fonts-dejavu-core \
      fontconfig \
    && python3 -m pip install --break-system-packages --no-cache-dir -U yt-dlp bgutil-ytdlp-pot-provider onnxruntime \
    && python3 -m pip install --break-system-packages --no-cache-dir \
         torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cpu \
    && python3 -m pip install --break-system-packages --no-cache-dir \
         "pyannote.audio==3.3.2" "speechbrain==1.0.2" \
    && mkdir -p /opt/models /opt/hf-cache \
    && curl -fsSL -o /opt/models/yolov10n-face.onnx https://github.com/akanametov/yolo-face/releases/download/1.0.0/yolov10n-face.onnx \
    && ln -sf /usr/local/bin/yt-dlp /usr/bin/yt-dlp \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y \
    && git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider \
    && cd /opt/bgutil-ytdlp-pot-provider/server \
    && npm ci \
    && npx tsc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./
COPY reframe.js ./
COPY face_track.py ./
COPY diarize.py ./

ENV NODE_ENV=production \
    PORT=8080 \
    WORK_DIR=/tmp/clipfy \
    HF_HOME=/opt/hf-cache \
    TRANSFORMERS_CACHE=/opt/hf-cache \
    PYANNOTE_CACHE=/opt/hf-cache

EXPOSE 8080

CMD ["node", "index.js"]
