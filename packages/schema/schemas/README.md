# OIML Schema Registry

This directory contains versioned schema artifacts that are published to GitHub Container Registry (GHCR).

## Available Schemas

### oiml.intent

Intent definitions for the Open Intent Modeling Language.

**Versions:**
- `0.1.0` - Initial release

## Publishing to GitHub Container Registry

Schemas are distributed as OCI artifacts (container images) via GitHub Container Registry.

### Automatic Publishing (CI/CD)

Schemas are automatically published when changes are pushed to `main`:

1. The GitHub Actions workflow detects changes in `packages/schema/schemas/`
2. Builds a Docker image for each changed schema version
3. Pushes to `ghcr.io/<org>/schemas/<schema-name>:<version>`

### Manual Publishing

#### Option 1: Via GitHub Actions

Go to Actions → "Publish Schemas to GHCR" → Run workflow

Inputs:
- `schema_name`: e.g., `oiml.intent`
- `schema_version`: e.g., `0.1.0`

#### Option 2: Via Script

```bash
cd packages/schema
export GITHUB_TOKEN=<your-token>
export GITHUB_ACTOR=<your-username>
./scripts/publish-schema.sh oiml.intent 0.1.0
```

#### Option 3: Manual Docker Commands

```bash
cd packages/schema/schemas/oiml.intent/0.1.0

# Build
docker build -t ghcr.io/<org>/schemas/oiml.intent:0.1.0 .

# Login
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_ACTOR --password-stdin

# Push
docker push ghcr.io/<org>/schemas/oiml.intent:0.1.0
```

## Consuming Schemas

### Pull from Registry

```bash
# Pull specific version
docker pull ghcr.io/openintent/schemas/oiml.intent:0.1.0

# Extract files
docker create --name temp ghcr.io/openintent/schemas/oiml.intent:0.1.0
docker cp temp:/schema.json ./schema.json
docker cp temp:/schema.zod.js ./schema.zod.js
docker cp temp:/metadata.json ./metadata.json
docker rm temp
```

### Use in CI/CD

```yaml
# Example: Use in GitHub Actions
- name: Fetch OIML Schema
  run: |
    docker pull ghcr.io/openintent/schemas/oiml.intent:0.1.0
    docker create --name schema ghcr.io/openintent/schemas/oiml.intent:0.1.0
    docker cp schema:/schema.json ./schema.json
    docker rm schema
```

### Use with OCI Tools

```bash
# Using oras (OCI Registry as Storage)
oras pull ghcr.io/openintent/schemas/oiml.intent:0.1.0

# Using crane
crane export ghcr.io/openintent/schemas/oiml.intent:0.1.0 - | tar -xv
```

## Image Structure

Each schema image contains:

```
/
├── schema.json      # JSON Schema (Draft-07)
├── schema.zod.js    # Zod schema definitions
└── metadata.json    # Schema metadata
```

## Metadata

Each image includes OCI labels:

- `org.opencontainers.image.title`: Schema title
- `org.opencontainers.image.version`: Schema version
- `org.opencontainers.image.created`: Build timestamp
- `org.opencontainers.image.revision`: Git commit SHA
- `dev.oiml.schema.name`: Schema name
- `dev.oiml.schema.version`: Schema version
- `dev.oiml.schema.engines.ajv`: Minimum AJV version
- `dev.oiml.schema.engines.zod`: Minimum Zod version

## Adding a New Schema Version

1. Create the version directory:
   ```bash
   mkdir -p schemas/<name>/<version>
   ```

2. Add the schema files:
   - `schema.zod.js` (source of truth)
   - `metadata.json`
   - `Dockerfile`

3. Generate JSON Schema:
   ```bash
   pnpm run generate:schemas
   ```

4. Commit and push (triggers automatic publish)

## Schema Versioning

We follow semantic versioning (semver):

- **MAJOR**: Breaking changes to schema structure
- **MINOR**: Backward-compatible additions
- **PATCH**: Backward-compatible fixes

Each version is immutable once published.

## Registry URL Pattern

```
ghcr.io/<org>/schemas/<schema-name>:<version>
```

Examples:
- `ghcr.io/openintent/schemas/oiml.intent:0.1.0`
- `ghcr.io/openintent/schemas/oiml.intent:latest`

## Security

Schema images are signed and can be verified:

```bash
# Verify signature (if cosign is set up)
cosign verify ghcr.io/openintent/schemas/oiml.intent:0.1.0
```

## License

All schemas are licensed under MPL-2.0.















