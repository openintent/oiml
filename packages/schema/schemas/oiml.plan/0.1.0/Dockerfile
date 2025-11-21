# Dockerfile for OIML Plan Schema v0.1.0
# This packages the schema artifacts for distribution via GitHub Container Registry

FROM scratch

# Copy schema artifacts
COPY schema.json /schema.json
COPY schema.zod.js /schema.zod.js
COPY metadata.json /metadata.json

# Metadata labels
LABEL org.opencontainers.image.title="OIML Implementation Plan Schema"
LABEL org.opencontainers.image.description="Open Intent Modeling Language (OIML) Implementation Plan Schema v0.1.0 - Agent's intended changes before execution"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.vendor="OIML"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/openintent/oiml"
LABEL org.opencontainers.image.documentation="https://oiml.dev"

# Schema-specific metadata
LABEL dev.oiml.schema.name="oiml.plan"
LABEL dev.oiml.schema.version="0.1.0"
LABEL dev.oiml.schema.engines.ajv="8.0.0"
LABEL dev.oiml.schema.engines.zod="3.24.0"



