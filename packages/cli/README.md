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
- Copy the `OPENINTENT.md` master prompt template

### Options

- `-y, --yes`: Skip prompts and use defaults

## Development

```bash
# Build the CLI
pnpm build

# Development mode with watch
pnpm dev
```

