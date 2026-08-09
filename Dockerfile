# syntax=docker/dockerfile:1.7

# ---- Build stage ----
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock .npmrc ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

COPY svelte.config.js vite.config.ts tsconfig.json components.json ./
COPY src/ src/
COPY static/ static/
ARG GIT_COMMIT
RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=cache,target=/app/node_modules/.vite \
    GIT_COMMIT=$GIT_COMMIT NODE_ENV=production bun run build

# ---- Runtime stage ----
FROM oven/bun:1-debian AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

COPY --from=build /app/build ./build
COPY server.ts ./
COPY src/ws/index.server.ts ./src/ws/index.server.ts
COPY src/lib/mathex/schemas.ts ./src/lib/mathex/schemas.ts

ENV NODE_ENV=production
ENV PORT=5185
ENV HOST=0.0.0.0
EXPOSE 5185/tcp

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5185/ || exit 1

CMD ["bun", "run", "server.ts"]
