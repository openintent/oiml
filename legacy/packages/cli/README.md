# @osl/cli

OSL CLI for initializing and managing OSL projects.

## Installation

```bash
npm install -g @osl/cli
```

Or use with npx (no installation required):

```bash
npx @osl/cli init
```

## Usage

### Initialize a new OSL project

```bash
osl init
```

Or with npx:

```bash
npx @osl/cli init
```

This command will:

- Detect your project type (Next.js, Express, etc.)
- Create a `.osl` directory
- Generate a `project.yaml` configuration file
- Create an `intents` directory

Note: The OSL Agents implementation guide (AGENTS.md) is now available via the MCP tool `get_agents_guide` instead of being copied to each project. Agents can fetch it when needed.

### Options

- `-y, --yes`: Skip prompts and use defaults

### Create a new intent

```bash
osl create INT-123
```

This command will:

- Create a folder `.osl/intents/INT-123/`
- Generate an `intent.yaml` file inside the folder
- Include default OSL structure with ai_context and provenance

## Development

```bash
# Build the CLI
pnpm build

# Development mode with watch
pnpm dev
```
