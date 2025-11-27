# Electron Setup

This directory contains the Electron main process files for the OIML Builder application.

## Files

- `main.ts` - Main Electron process that creates and manages the browser window
- `preload.ts` - Preload script that safely exposes Electron APIs to the renderer process
- `tsconfig.json` - TypeScript configuration for Electron files

## Development

To run the app in development mode:

```bash
npm run electron:dev
```

This will:

1. Start the Next.js dev server on `http://localhost:3000`
2. Wait for the server to be ready
3. Launch Electron and connect to the dev server

## Building

To build the Electron app:

```bash
npm run electron:build
```

This will:

1. Build the Next.js app
2. Compile the Electron TypeScript files
3. Package everything into a distributable Electron app

## Production Notes

For production builds, you have two options:

1. **Standalone Next.js server** (recommended): Configure Next.js with `output: 'standalone'` in `next.config.ts` and start a local server in the Electron main process
2. **Static export**: Use `output: 'export'` in `next.config.ts` to generate static files that Electron can serve directly

The current setup uses the dev server approach for development. For production, you'll need to implement a local server or switch to static export.
