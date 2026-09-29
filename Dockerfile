# Build stage: compile the client bundle.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: prod deps + built client + TS server (run via tsx).
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./

# SQLite lives here — map this to a NAS folder that's in the cloud-backup pipeline.
VOLUME /app/data
ENV DB_PATH=/app/data/dp-erp.db
# Nightly verified backup inside the app (ADR 0008, docs/BACKUP.md) — on the same volume.
ENV BACKUP_DIR=/app/data/backups
ENV BACKUP_HOUR=2
# Shop time zone (backup hour, local dates). The owner should change this if the
# shop is not on US Central time; docker-compose.yml sets it too.
ENV TZ=America/Chicago
# The Docker image serves on 3000 (the production default elsewhere is port 80).
ENV PORT=3000

EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
