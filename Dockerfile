# Wordo — Node + WebSocket server. Portable to Render / Railway / Fly / any VPS.
FROM node:20-slim

# tzdata so TZ (e.g. Europe/Copenhagen) controls when the daily word rolls over.
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV TZ=Europe/Copenhagen
WORKDIR /app

# Install only runtime deps first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# App code + generated vector data (data/<lang>/...).
COPY . .

EXPOSE 3000
CMD ["node", "server/index.js"]
