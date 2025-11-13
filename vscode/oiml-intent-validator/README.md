# OIML Intent Validator

A Visual Studio Code extension that validates OpenIntent Modeling Language (OIML) `intent.yaml` files in real-time.

## Features

- ✅ **Real-time validation** - Validates as you type
- ✅ **Error highlighting** - Red squiggly lines under validation errors
- ✅ **Problems panel** - All errors shown in VSCode's Problems panel
- ✅ **Hover tooltips** - Detailed error messages on hover
- ✅ **Command palette** - Manual validation commands
- ✅ **Workspace validation** - Validate all intent files at once

## Usage

### Automatic Validation

The extension automatically validates any file named `intent.yaml` when you:
- Open the file
- Edit the file (real-time)
- Save the file

### Manual Validation

Use the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux):

- **OIML: Validate Current File** - Validate the currently active file
- **OIML: Validate All Intent Files in Workspace** - Validate all intent.yaml files in your workspace

## Configuration

Configure the extension in your VSCode settings:

```json
{
  "oiml.validateOnSave": true,
  "oiml.validateOnType": true,
  "oiml.filePattern": "**/intent.yaml"
}
```

### Settings

- `oiml.validateOnSave` (boolean, default: `true`) - Automatically validate on file save
- `oiml.validateOnType` (boolean, default: `true`) - Automatically validate as you type
- `oiml.filePattern` (string, default: `"**/intent.yaml"`) - Glob pattern to match OIML intent files

## Schema Version

This extension validates against OIML Intent Schema version **0.1.0**.

## Development

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)

### Setup

```bash
cd oiml-vscode
pnpm install
pnpm run build
```

### Testing

Press `F5` in VSCode to launch the extension in a new Extension Development Host window.

### Building

```bash
pnpm run build
```

### Packaging

```bash
pnpm install -g @vscode/vsce
pnpm run package
```

This creates a `.vsix` file that can be installed in VSCode.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.











