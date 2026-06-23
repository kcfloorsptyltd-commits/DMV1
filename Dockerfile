# Multi-stage Dockerfile to build native modules (better-sqlite3) on Alpine
# Builder stage: installs build deps and runs npm ci (or npm install as fallback)
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package manifests first to leverage Docker caching
COPY package.json package-lock.json* ./

# Install build dependencies required for native addon compilation
RUN apk add --no-cache build-base python3 linux-headers sqlite-dev

# Install production dependencies. Prefer npm ci for reproducible builds; fall back to npm install if lockfile missing.
RUN npm ci --production || npm install --production

# Copy application source and run any build step if present
COPY . .
RUN npm run build --if-present || true

# Runtime stage: slim image with runtime libs
FROM node:20-alpine AS runtime
WORKDIR /usr/src/app

# Ensure runtime has sqlite libs available for better-sqlite3
RUN apk add --no-cache sqlite-libs

# Copy node_modules and app from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app .

ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "src/app.js"]
