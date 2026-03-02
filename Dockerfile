FROM node:20-slim

# Install build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    wget \
    xz-utils \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install FFmpeg 7 static build from BtbN (GitHub releases)
RUN wget -q https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz -O /tmp/ffmpeg.tar.xz \
    && tar xf /tmp/ffmpeg.tar.xz -C /tmp \
    && cp /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg /usr/local/bin/ \
    && cp /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffprobe /usr/local/bin/ \
    && rm -rf /tmp/ffmpeg* \
    && ffmpeg -version | head -1

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application code
COPY server.js ./
COPY lib/ ./lib/
COPY db/ ./db/
COPY routes/ ./routes/
COPY my-ui/build/ ./my-ui/build/
COPY IsiPrime-WebOS-Native/ ./IsiPrime-WebOS-Native/

# Create directories for data persistence
RUN mkdir -p /app/data /app/logs

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "server.js"]
