# Challenge engine backend.
#
# Uses Debian slim (glibc) rather than Alpine so the native `better-sqlite3`
# prebuilt binary installs without a compiler. The build context MUST be the
# repository ROOT so the shared/ contract types are available:
#
#   docker build -f server/Dockerfile -t bitunix-challenge-backend .

# ---- Dependencies (cached layer) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci

# ---- Runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8090
ENV DATA_DIR=/data
WORKDIR /app/server

# Installed deps (includes the tsx runtime + native better-sqlite3 binary).
COPY --from=deps /app/server/node_modules ./node_modules
# Backend source and shared contract types (resolved via @shared -> ../shared).
COPY server/ ./
COPY shared/ /app/shared/

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8090)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "src/index.ts"]
