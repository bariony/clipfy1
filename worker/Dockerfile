# Clipfy Render Worker — FFmpeg + yt-dlp + Node
FROM node:20-bookworm-slim

# System deps: ffmpeg, yt-dlp, fonts, deno (JS runtime exigido pelo yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      curl \
      unzip \
      ca-certificates \
      fonts-dejavu-core \
      fontconfig \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

ENV NODE_ENV=production \
    PORT=8080 \
    WORK_DIR=/tmp/clipfy

EXPOSE 8080

CMD ["node", "index.js"]
