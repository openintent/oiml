# OIML MCP Server

Model Context Protocol server for OpenIntent Markup Language (OIML) validation and operations.

## Features

- **Schema Validation**: Validate OIML intent files against schemas
- **Project Validation**: Validate project configuration files
- **Registry Integration**: Fetch and cache schemas from GitHub Container Registry
- **Schema Cache Management**: List, clear, and manage cached schemas
- **Multiple Schema Versions**: Support for different schema versions

## Installation

### Option 1: Local Development

```bash
pnpm install
pnpm build
```

### Option 2: Docker

```bash
# Build the image
docker build -t oiml-mcp-server .

# Run with Docker
docker run -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  oiml-mcp-server

# Or use docker-compose
docker-compose up -d
```

### Option 3: Google Cloud Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive deployment guides including:
- Cloud Run (serverless)
- Google Kubernetes Engine (GKE)
- Compute Engine (VMs)

## Usage

### Start the Server

**Local Development:**
```bash
pnpm start
# Or for development with auto-reload
pnpm dev
```

**Docker:**
```bash
docker-compose up -d
```

**Server Endpoints:**
- Main endpoint: `http://localhost:3000/mcp`
- Health check: `http://localhost:3000/health`
- Service info: `http://localhost:3000/`

## MCP Tools

All validation tools accept file content directly (no file system access required). This allows the tools to work in any environment, whether local or remote.

### 1. validate_intent

Validate an OIML intent file against the schema from GitHub Container Registry. The schema version is automatically read from the intent file's `version` field.

**Parameters:**
- `content` (string, required): Raw content of the OIML file
- `format` (enum, required): Format of the content (`json` or `yaml`)

**Example:**

```typescript
{
  "content": "$schema: oiml://schemas/oiml.intent/0.1.0/schema.json\ntype: oiml.intent\nversion: 0.1.0\n...",
  "format": "yaml"
}
```

**Response (Success):**
```json
{
  "valid": true,
  "message": "File is valid according to OIML Intent Schema v0.1.0",
  "schemaVersion": "0.1.0"
}
```

**Response (Validation Error):**
```json
{
  "valid": false,
  "errors": [
    "intents.0.entity: Required",
    "intents.0.fields: Array must contain at least 1 element(s)"
  ],
  "schemaVersion": "0.1.0"
}
```

**How it works:**
1. Reads and parses the intent file
2. Extracts the `version` field (e.g., `"0.1.0"`)
3. Fetches `ghcr.io/openintent/schemas/oiml.intent:<version>` from GHCR
4. Caches the schema locally for subsequent validations
5. Validates the file against the fetched schema

### 2. validate_project

Validate a project.yaml file against the OIML project schema.

**Parameters:**
- `content` (string, required): Raw content of the project.yaml file
- `format` (enum, required): Format of the content (`json` or `yaml`)

**Example:**
```typescript
{
  "content": "type: oiml.project\nversion: 0.1.0\nname: my-project\n...",
  "format": "yaml"
}
```

### 3. load_project

Load and parse an OIML project configuration file.

**Parameters:**
- `project_path` (string, optional): Path to project.yaml. If not provided, searches using standard resolution logic.

**Response:**
```json
{
  "path": "/path/to/.openintent/project.yaml",
  "raw": "...",
  "parsed": {...},
  "sha": "abc123..."
}
```

### 4. manage_schema_cache

Manage cached schemas from GitHub Container Registry.

**Parameters:**
- `action` (enum, required): Action to perform
  - `list`: Show all cached schemas
  - `clear`: Remove a specific cached schema
  - `clear-all`: Remove all cached schemas
- `schemaName` (string, optional): Schema name (required for `clear` action)
- `schemaVersion` (string, optional): Schema version (required for `clear` action)

**Examples:**

```typescript
// List cached schemas
{
  "action": "list"
}

// Clear specific schema
{
  "action": "clear",
  "schemaName": "oiml.intent",
  "schemaVersion": "0.1.0"
}

// Clear all cached schemas
{
  "action": "clear-all"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Found 2 cached schema(s)",
  "cached_schemas": [
    {
      "name": "oiml.intent",
      "version": "0.1.0",
      "path": "/Users/username/.oiml/schema-cache/oiml.intent_0.1.0",
      "size": "85.42 KB"
    }
  ]
}
```

## Schema Registry Integration

### How It Works

1. **First Request**: When `useRegistry: true` is set, the server:
   - Pulls the schema image from `ghcr.io/openintent/schemas/<name>:<version>`
   - Extracts schema files to `~/.oiml/schema-cache/`
   - Dynamically loads the Zod schema
   - Uses it for validation

2. **Subsequent Requests**: Schema is loaded from local cache (instant)

3. **Cache Location**: `~/.oiml/schema-cache/<schema-name>_<version>/`

### Prerequisites

- Docker must be installed and running
- Schema must be published to GHCR (see [Publishing Guide](../packages/schema/schemas/PUBLISHING.md))
- For private registries, Docker must be logged in to GHCR

### Benefits

- **Version Pinning**: Use specific schema versions for validation
- **Registry Distribution**: Schemas are distributed as immutable OCI artifacts
- **Offline Support**: Cached schemas work without network access
- **Multi-Version**: Support multiple schema versions simultaneously

## Configuration

### Environment Variables

- `OI_PROJECT_PATH`: Path to project.yaml file
- `OI_REPO_ROOT`: Repository root (server will look for `.openintent/project.yaml`)

### Project Resolution

The server searches for `project.yaml` in this order:

1. `OI_PROJECT_PATH` environment variable
2. `$OI_REPO_ROOT/.openintent/project.yaml`
3. Current directory and parent directories (walking up the tree)
4. Fallback to `./openintent/project.yaml`

## Docker Support

The MCP server requires Docker for registry integration. Ensure Docker is installed and running:

```bash
# Check Docker is available
docker --version

# Test pulling a schema
docker pull ghcr.io/openintent/schemas/oiml.intent:0.1.0
```

## Development

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Run in development mode
pnpm dev

# Run built version
pnpm start
```

## API Endpoint

The server exposes a single HTTP endpoint:

- **POST** `/mcp` - MCP protocol handler

All MCP tool calls go through this endpoint.

## Example Client Usage

```typescript
import fs from 'fs';

// Read file content (or get it from any source - API, database, etc.)
const fileContent = fs.readFileSync('/path/to/intent.yaml', 'utf8');

const response = await fetch('http://localhost:4000/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'validate_intent',
      arguments: {
        content: fileContent,
        format: 'yaml'
      }
    }
  })
});

const result = await response.json();
console.log(result);
// Output: { valid: true, message: "File is valid according to OIML Intent Schema v0.1.0", schemaVersion: "0.1.0" }
```

## Troubleshooting

### Schema Not Found in Registry

```
Error: Failed to fetch schema from registry
```

**Solution**: Ensure the schema is published to GHCR. See [Publishing Guide](../packages/schema/schemas/PUBLISHING.md).

### Docker Permission Denied

```
Error: permission denied while trying to connect to the Docker daemon
```

**Solution**: Ensure Docker is running and your user has permission to use Docker.

### Cache Issues

Clear the schema cache:

```typescript
{
  "action": "clear-all"
}
```

Or manually:
```bash
rm -rf ~/.oiml/schema-cache
```

## License

MPL-2.0

