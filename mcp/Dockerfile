# Multi-stage Dockerfile for OpenIntent MCP Server
# Pre-caches schemas from GHCR for Cloud Run compatibility (no Docker-in-Docker needed)

# Stage 1: Build the TypeScript application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# Install pnpm and dependencies
RUN npm install -g pnpm && \
    pnpm install --no-frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build the TypeScript code
RUN pnpm build

# Stage 2: Fetch schemas from GHCR (pre-cache for Cloud Run)
FROM ghcr.io/openintent/schemas/oiml.intent:0.1.0 AS schema-intent-0.1.0
FROM ghcr.io/openintent/schemas/oiml.project:0.1.0 AS schema-project-0.1.0

# Stage 3: Runtime (no Docker needed - schemas are pre-cached)
FROM node:20-alpine

# Install basic utilities (no Docker needed since schemas are pre-cached)
RUN apk add --no-cache \
    git \
    curl \
    ca-certificates

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# Install pnpm and production dependencies only
RUN npm install -g pnpm && \
    pnpm install --prod --no-frozen-lockfile

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create schema cache directory
RUN mkdir -p /root/.openintent/schema-cache/oiml.intent_0.1.0 && \
    mkdir -p /root/.openintent/schema-cache/oiml.project_0.1.0 && \
    chmod -R 755 /root/.openintent

# Copy pre-cached schemas from GHCR images
COPY --from=schema-intent-0.1.0 / /root/.openintent/schema-cache/oiml.intent_0.1.0/
COPY --from=schema-project-0.1.0 / /root/.openintent/schema-cache/oiml.project_0.1.0/

# Set environment variables
ENV NODE_ENV=production
ENV SCHEMA_CACHE_DIR=/root/.openintent/schema-cache
ENV PORT=3000

# Expose the MCP server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start script that ensures Docker daemon is available
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]

