# Multi-stage Dockerfile for OpenIntent MCP Server
# Includes Docker-in-Docker support for schema fetching from GHCR

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

# Stage 2: Runtime with Docker support
FROM node:20-alpine

# Install Docker CLI and Docker-in-Docker (dind) support
RUN apk add --no-cache \
    docker \
    docker-cli \
    openrc \
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
RUN mkdir -p /root/.openintent/schema-cache && \
    chmod -R 755 /root/.openintent

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

