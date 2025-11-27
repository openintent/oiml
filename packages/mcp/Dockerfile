# Multi-stage Dockerfile for OpenIntent MCP Server and Linear Server
# Build from monorepo root context: docker build -f packages/mcp/Dockerfile .
# Runs MCP server on port 3111 and Linear server on port 3112

# Build argument for target platform (defaults to linux/amd64 for CI/deployment)
ARG BUILD_PLATFORM=linux/amd64

# Stage 1: Build the TypeScript application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy monorepo root files (needed for workspace resolution)
COPY package.json ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy workspace packages (needed for workspace:* dependencies)
COPY packages/schema/package.json ./packages/schema/
COPY packages/schema/templates ./packages/schema/templates
COPY packages/schema/schemas ./packages/schema/schemas

# Copy MCP package files
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/mcp/tsconfig.json ./packages/mcp/
COPY packages/mcp/src ./packages/mcp/src

# Install pnpm and dependencies (resolves workspace:* dependencies)
RUN npm install -g pnpm && \
    pnpm install --no-frozen-lockfile

# Build the TypeScript code
WORKDIR /app/packages/mcp
RUN pnpm build

# Stage 2: Runtime
FROM --platform=${BUILD_PLATFORM} node:20-alpine

# Create app directory
WORKDIR /app

# Copy monorepo root files
COPY package.json ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy workspace packages (needed for runtime workspace:* resolution)
COPY packages/schema/package.json ./packages/schema/
COPY packages/schema/templates ./packages/schema/templates
COPY packages/schema/schemas ./packages/schema/schemas

# Copy MCP package files
COPY packages/mcp/package.json ./packages/mcp/

# Install pnpm and production dependencies only
RUN npm install -g pnpm && \
    pnpm install --prod --no-frozen-lockfile

# Copy node_modules from builder to ensure all dependencies are available
# This is needed because pnpm workspace dependencies might not be fully resolved with --prod
COPY --from=builder /app/node_modules ./node_modules

# Copy built applications from builder stage
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist

# Copy assets directory (contains AGENTS.md)
COPY packages/mcp/assets ./packages/mcp/assets

# Copy compatibility matrix
COPY packages/mcp/compatibility ./packages/mcp/compatibility

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3111

# Expose the MCP server port
EXPOSE 3111

# Health check script
COPY packages/mcp/healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/healthcheck.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

# Start script that ensures Docker daemon is available
COPY packages/mcp/docker-entrypoint.sh /usr/local/bin/
COPY packages/mcp/start-servers.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/start-servers.sh

# Set working directory to MCP package
WORKDIR /app/packages/mcp

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["start-servers.sh"]

