import type { GeneratedFile, IR, ProjectConfig } from "@osl/core";
import { REGION_BEGIN, REGION_END } from "@osl/core";
import {
  SHADCN_DEPENDENCIES,
  SHADCN_DEV_DEPENDENCIES,
  installText,
  lifecycleAllowance,
  lifecycleFiles,
  runText,
  shadcnFiles,
  shadcnGlobalsCss,
  type PackageManager
} from "@osl/ts-common";
import { SCAFFOLD_HEADER, q } from "./util.js";

export const DEPENDENCIES = {
  "@hono/node-server": "^2.1",
  "@hono/trpc-server": "^0.4.2",
  "@tanstack/react-query": "^5.101",
  "@tanstack/react-router": "^1.170",
  "@trpc/client": "^11.18",
  "@trpc/server": "^11.18",
  "@trpc/tanstack-react-query": "^11.18",
  "drizzle-orm": "^0.45",
  hono: "^4.13",
  pg: "^8",
  react: "^19",
  "react-dom": "^19",
  tsx: "^4",
  zod: "^3"
};

export const DEV_DEPENDENCIES = {
  "@tailwindcss/vite": "^4",
  "@tanstack/router-plugin": "^1.168",
  "@types/node": "^24",
  "@types/pg": "^8",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "@vitejs/plugin-react": "^6",
  tailwindcss: "^4",
  typescript: "^5",
  vite: "^8",
  vitest: "^5"
};

export type Appearance = "system" | "light" | "dark";
export const APPEARANCES: Appearance[] = ["system", "light", "dark"];

/** Applies the dark class from the OS preference before first paint and follows changes. */
const SYSTEM_THEME_SCRIPT =
  "(function(){var m=window.matchMedia('(prefers-color-scheme: dark)');function apply(){document.documentElement.classList.toggle('dark',m.matches)}apply();m.addEventListener('change',apply)})();";

const sorted = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export function projectScaffolds(
  ir: IR,
  config: ProjectConfig,
  appearance: Appearance,
  packageManager: PackageManager,
  extraDependencies: Record<string, string> = {}
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const gen = config.generated_dir;
  const title = ir.app?.title ?? ir.name;
  const run = (script: string) => runText(packageManager, script);

  // package.json is merged: keys OSL adds later (a dependency a new feature needs) land, yours are kept.
  files.push({
    path: "package.json",
    mode: "merge",
    content:
      JSON.stringify(
        {
          name: ir.name,
          private: true,
          type: "module",
          scripts: {
            dev: "node scripts/dev.mjs",
            "dev:api": "tsx watch src/server/main.ts",
            "dev:web": "vite",
            build: "vite build",
            start: "tsx src/server/main.ts",
            ...(ir.jobs ? { worker: "tsx src/server/worker.ts" } : {}),
            seed: `tsx ${gen}/seed.ts`,
            typecheck: "vite build && tsc --noEmit",
            test: "vitest run"
          },
          dependencies: sorted({ ...DEPENDENCIES, ...SHADCN_DEPENDENCIES, ...extraDependencies }),
          devDependencies: sorted({ ...DEV_DEPENDENCIES, ...SHADCN_DEV_DEPENDENCIES }),
          // esbuild (Vite's compiler) has an install script that pnpm and bun only run when it is allowed
          ...lifecycleAllowance(packageManager, ["esbuild"])
        },
        null,
        2
      ) + "\n"
  });

  files.push(...lifecycleFiles(packageManager, ["esbuild"]));

  files.push({
    path: "scripts/dev.mjs",
    mode: "scaffold",
    content: `${SCAFFOLD_HEADER("Starts the API (tsx watch) and the Vite dev server together; stopping one stops both.")}
import { spawn } from "node:child_process";
import path from "node:path";

const bin = name => path.join("node_modules", ".bin", name);
const options = { stdio: "inherit", shell: process.platform === "win32" };
const children = [spawn(bin("tsx"), ["watch", "src/server/main.ts"], options), spawn(bin("vite"), [], options)];

const stop = () => {
  for (const child of children) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", code => {
    stop();
    process.exit(code ?? 0);
  });
}
`
  });

  files.push({
    path: "tsconfig.json",
    mode: "scaffold",
    content:
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "dom.iterable", "esnext"],
            module: "esnext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            esModuleInterop: true,
            isolatedModules: true,
            resolveJsonModule: true,
            useDefineForClassFields: true,
            types: ["node", "vite/client"],
            paths: { "@/*": ["./src/*"], "@generated/*": [`./${gen}/*`] }
          },
          include: ["src", gen, "vite.config.ts", "vitest.config.mts"],
          exclude: ["node_modules", "dist"]
        },
        null,
        2
      ) + "\n"
  });

  files.push({
    path: "vite.config.ts",
    mode: "scaffold",
    content: `import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
// In development the API runs separately (${run("dev:api")}); Vite proxies tRPC calls to it.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3111";

export default defineConfig({
  plugins: [
    // Must come before react(): it writes src/routeTree.gen.ts from the files in src/routes
    tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" }),
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@": \`\${root}src\`,
      "@generated": \`\${root}${gen}\`
    }
  },
  server: {
    proxy: { "/trpc": apiTarget, "/api": apiTarget }
  }
});
`
  });

  const htmlClass = appearance === "dark" ? ' class="dark"' : "";
  const script = appearance === "system" ? `    <script>\n      ${SYSTEM_THEME_SCRIPT}\n    </script>\n` : "";
  files.push({
    path: "index.html",
    mode: "scaffold",
    content: `<!doctype html>
<!-- Appearance: ${appearance}${appearance === "system" ? " (follows the OS; the dark class is applied before first paint)" : ""}. Set backend_options.appearance in .osl/config.yaml before the first osl generate, or edit this file; OSL never rewrites it. -->
<html lang="en"${htmlClass} style="--font-sans: ui-sans-serif, system-ui, sans-serif">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="${appearance === "system" ? "light dark" : appearance}" />
    <title>${escapeHtml(title)}</title>
${script}  </head>
  <body class="min-h-svh antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
  });

  // The stock shadcn theme, as the CLI writes it for a Vite project
  files.push({ path: "src/index.css", mode: "scaffold", content: shadcnGlobalsCss() });
  files.push(...shadcnFiles("vite"));

  files.push({
    path: ".gitignore",
    mode: "scaffold",
    content: `node_modules/
dist/
.env
*.tsbuildinfo
src/routeTree.gen.ts
storage/
`
  });

  files.push({
    path: ".env.example",
    mode: "regions",
    content: `# Copy to .env and fill in. Keep your own variables outside the OSL region.
${REGION_BEGIN("env", "#")}
DATABASE_URL=postgres://postgres@localhost:5432/${ir.name}
${ir.auth ? "OSL_SESSION_SECRET=change-me-to-a-long-random-string\n" : ""}PORT=3111
${envExtras(ir)}${REGION_END("env", "#")}
`
  });

  files.push({
    path: "generated/README.md",
    content: `# Generated by OSL

Everything in this directory is rewritten by \`osl generate\` from \`.osl/model.yaml\`. Do not edit it.

- \`db/\`: the Drizzle schema, client and migrations (apply them with \`osl migrate\`).
- \`server/\`: the Hono app and the tRPC routers (\`/trpc\`), one per resource plus \`auth\`.
- \`app/\`: the web app's tRPC client, the sidebar's data and the master/detail pages.
- \`tests/\`: contract tests from the model's examples (\`${run("test")}\` against a running API).

Your code lives in \`src/\`: \`src/server/main.ts\` starts the API, \`src/routes\` holds the pages (the
ones OSL generates import their components from here; add your own next to them), \`src/components\`
the shell and the shadcn/ui components, \`src/extensions/<resource>.ts\` the hooks around each
resource's procedures and \`src/events/<handler>.ts\` the event handlers. OSL creates those once and
never touches them again.

Install with \`${installText(packageManager)}\` (the package manager is \`backend_options.package_manager\` in
.osl/config.yaml). Run \`${run("dev")}\` for the API and the Vite dev server together, \`${run("build")}\` then
\`${run("start")}\` to serve the built app from the API process.
`
  });

  return files;
}

/** Environment the model's features read, with their defaults */
function envExtras(ir: IR): string {
  const lines: string[] = [];
  if (ir.auth?.providers.some(p => p.kind !== "credentials"))
    lines.push(
      "OSL_APP_URL=http://localhost:5173",
      "# OSL_EMAIL=log|resend|capture (default: resend when RESEND_API_KEY is set, else log)",
      "# RESEND_API_KEY=",
      "# EMAIL_FROM=no-reply@example.com"
    );
  for (const p of ir.auth?.providers ?? []) {
    if (p.kind !== "oauth") continue;
    const env = p.name.toUpperCase().replace(/-/g, "_");
    lines.push(`OAUTH_${env}_CLIENT_ID=`, `OAUTH_${env}_CLIENT_SECRET=`);
  }
  if (ir.files)
    lines.push(
      "# OSL_STORAGE=local|s3 (default: s3 when S3_BUCKET is set, else local)",
      "OSL_STORAGE_DIR=./storage",
      "# S3_BUCKET=",
      "# S3_REGION=us-east-1",
      "# S3_ENDPOINT= (R2, MinIO, Supabase)",
      "# S3_ACCESS_KEY_ID=",
      "# S3_SECRET_ACCESS_KEY=",
      "# S3_FORCE_PATH_STYLE=true"
    );
  if (ir.jobs) lines.push("# OSL_ROLE=web|worker|all (default all)");
  return lines.length ? lines.join("\n") + "\n" : "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export { q };
