# @oiml/cli

OIML CLI for initializing and managing OIML projects.

## Installation

```bash
npm install -g @oiml/cli
```

Or use with npx (no installation required):

```bash
npx @oiml/cli init
```

## Usage

### Initialize a new OIML project

```bash
oiml init
```

Or with npx:

```bash
npx @oiml/cli init
```

This command will:

- Detect your project type (Next.js, Express, etc.)
- Create a `.oiml` directory
- Generate a `project.yaml` configuration file
- Create an `intents` directory
- Copy the `AGENTS.md` master prompt template

### Options

- `-y, --yes`: Skip prompts and use defaults

### Create a new intent

```bash
oiml create INT-123
```

This command will:

- Create a folder `.oiml/intents/INT-123/`
- Generate an `intent.yaml` file inside the folder
- Include default OIML structure with ai_context and provenance

## Development

```bash
# Build the CLI
pnpm build

# Development mode with watch
pnpm dev
```
