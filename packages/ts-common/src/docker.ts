import type { GeneratedFile, IR } from "@osl/core";
import type { PackageManager } from "./package-manager.js";

export interface DockerOptions {
  packageManager: PackageManager;
  /** The port the app listens on inside the container */
  port: number;
  /** Shell commands that build the app (vite build, next build) */
  build: string[];
  /** The command that starts the app, as exec-form JSON */
  start: string[];
  /** Whether a worker service (OSL_ROLE=worker) makes sense */
  worker: boolean;
}

/** Dockerfile, .dockerignore and docker-compose.yml: scaffolds the user owns. */
export function dockerFiles(ir: IR, options: DockerOptions): GeneratedFile[] {
  const pm = options.packageManager;
  const prepare =
    pm === "pnpm"
      ? "RUN corepack enable && corepack prepare pnpm@latest --activate"
      : pm === "bun"
        ? "RUN npm install -g bun"
        : "";
  const lock = pm === "pnpm" ? "pnpm-lock.yaml*" : pm === "bun" ? "bun.lock*" : "package-lock.json*";
  const install =
    pm === "pnpm" ? "pnpm install --frozen-lockfile" : pm === "bun" ? "bun install --frozen-lockfile" : "npm ci";
  const dockerfile = `# Built by OSL once; yours to change. Two stages: build with every dependency, run the built app.
FROM node:24-slim AS build
WORKDIR /app
${prepare ? prepare + "\n" : ""}COPY package.json ${lock} ./
RUN ${install}
COPY . .
RUN ${options.build.join(" && ")}

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=${options.port}
COPY --from=build /app ./
USER node
EXPOSE ${options.port}
CMD ${JSON.stringify(options.start)}
`;
  // isolation: database: requests connect as the app role; its password comes from the environment (osl migrate set it), never from this file
  const isolation = ir.auth?.tenancy?.isolation;
  const appUrl = isolation
    ? `\n      DATABASE_APP_URL: postgres://${isolation.appRole}:\${OSL_APP_DB_PASSWORD:?set OSL_APP_DB_PASSWORD to the password osl migrate gave ${isolation.appRole}}@postgres:5432/${ir.name}`
    : "";
  const worker = options.worker
    ? `
  worker:
    build: .
    command: ${JSON.stringify(options.start)}
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/${ir.name}
      OSL_ROLE: worker
    depends_on:
      postgres:
        condition: service_healthy
`
    : "";
  const compose = `# Built by OSL once; yours to change. Run with: docker compose up --build
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${ir.name}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d ${ir.name}"]
      interval: 2s
      timeout: 5s
      retries: 30

  app:
    build: .
    ports:
      - "${options.port}:${options.port}"
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/${ir.name}${appUrl}
      OSL_SESSION_SECRET: change-me-to-a-long-random-string
      OSL_APP_URL: http://localhost:${options.port}${options.worker ? "\n      OSL_ROLE: all" : ""}
    depends_on:
      postgres:
        condition: service_healthy
${worker}
volumes:
  pgdata:
`;
  return [
    { path: "Dockerfile", mode: "scaffold", content: dockerfile },
    { path: ".dockerignore", mode: "scaffold", content: "node_modules\ndist\n.next\n.env\nstorage\n" },
    { path: "docker-compose.yml", mode: "scaffold", content: compose }
  ];
}
