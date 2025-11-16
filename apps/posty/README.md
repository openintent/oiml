# Posty App

A simple application built with Next.js and Prisma, managed through OpenIntent.

## Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Set up your database connection:

```bash
cp .env.example .env
# Edit .env and add your DATABASE_URL
```

3. Run database migrations:

```bash
npx prisma migrate dev
```

4. Start the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

- `app/` - Next.js app directory
- `prisma/` - Prisma schema and migrations
- `.openintent/` - OpenIntent configuration and intents
- `packages/types/` - Shared TypeScript types
- `lib/` - Utility libraries (Prisma client, etc.)

## OpenIntent

This project uses OpenIntent for declarative code generation. See `.openintent/project.yaml` for configuration and `.openintent/intents/` for intent files.
