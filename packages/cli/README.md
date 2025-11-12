# @oiml/cli

OpenIntent CLI for initializing and managing OpenIntent projects.

## Installation

```bash
npm install -g @oiml/cli
```

Or use with npx (no installation required):

```bash
npx @oiml/cli init
```

## Usage

### Initialize a new OpenIntent project

```bash
openintent init
```

Or with npx:

```bash
npx @oiml/cli init
```

This command will:

- Detect your project type (Next.js, Express, etc.)
- Create a `.openintent` directory
- Generate a `project.yaml` configuration file
- Create an `intents` directory
- Copy the `AGENTS.md` master prompt template

### Options

- `-y, --yes`: Skip prompts and use defaults

### Create a new intent

```bash
openintent create INT-123
```

This command will:

- Create a folder `.openintent/intents/INT-123/`
- Generate an `intent.yaml` file inside the folder
- Include default OIML structure with ai_context and provenance

## Development

```bash
# Build the CLI
pnpm build

# Development mode with watch
pnpm dev
```
