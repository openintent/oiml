import type { GeneratedFile, IR } from "@osl/core";
import { REGION_BEGIN, REGION_END } from "@osl/core";
import {
  appUrlEnvLine,
  sealEnvLine,
  sealReadme,
  isolationReadme,
  SHADCN_DEPENDENCIES,
  SHADCN_DEV_DEPENDENCIES,
  SHADCN_VERSION,
  hasProviders,
  shadcnFiles,
  shadcnGlobalsCss
} from "@osl/ts-common";

export const DEPENDENCIES = {
  next: "^16",
  react: "^19",
  "react-dom": "^19",
  "drizzle-orm": "^0.45",
  pg: "^8",
  zod: "^3"
};

export const DEV_DEPENDENCIES = {
  "@types/node": "^24",
  "@types/pg": "^8",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  tsx: "^4",
  typescript: "^5",
  vitest: "^5"
};

/** What the generated web app (the app section) needs on top of Next.js */
export const APP_DEPENDENCIES = {
  "@tanstack/react-query": "^5.101"
};

export const TAILWIND_DEV_DEPENDENCIES = {
  "@tailwindcss/postcss": "^4",
  postcss: "^8",
  tailwindcss: "^4"
};

export type Appearance = "system" | "light" | "dark";
export const APPEARANCES: Appearance[] = ["system", "light", "dark"];

export interface ScaffoldOptions {
  /** Scaffold Tailwind CSS 4 (default true) */
  tailwind: boolean;
  /** Scaffold shadcn/ui config, theme and base components (default true; needs tailwind) */
  shadcn: boolean;
  /** Color scheme: follow the OS (system), or pin light or dark (default system) */
  appearance: Appearance;
  /** The generated directory, for scripts that point at it */
  generatedDir?: string;
  /** Packages the model's features need (storage, jobs) */
  extraDependencies?: Record<string, string>;
  /** Whether the model declares an app: its home page then lives inside the shell, not at app/page.tsx */
  app?: boolean;
}

/** Applies the dark class from the OS preference before first paint and follows changes. */
const SYSTEM_THEME_SCRIPT =
  "(function(){var m=window.matchMedia('(prefers-color-scheme: dark)');function apply(){document.documentElement.classList.toggle('dark',m.matches)}apply();m.addEventListener('change',apply)})();";

export function scaffoldFiles(
  ir: IR,
  options: ScaffoldOptions = { tailwind: true, shadcn: true, appearance: "system" }
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const shadcn = options.tailwind && options.shadcn;
  const sorted = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const extra = options.extraDependencies ?? {};
  const gen = options.generatedDir ?? "generated";
  const dependencies = sorted({ ...DEPENDENCIES, ...(shadcn ? SHADCN_DEPENDENCIES : {}), ...extra });
  const devDependencies = sorted({
    ...DEV_DEPENDENCIES,
    ...(options.tailwind ? TAILWIND_DEV_DEPENDENCIES : {}),
    ...(options.tailwind && shadcn ? SHADCN_DEV_DEPENDENCIES : {})
  });

  // package.json is merged: keys OSL adds later (a dependency a new feature needs) land, yours are kept.
  files.push({
    path: "package.json",
    mode: "merge",
    content:
      JSON.stringify(
        {
          name: ir.name,
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            ...(ir.jobs ? { worker: "tsx src/worker.ts" } : {}),
            seed: `tsx ${gen}/seed.ts`,
            typecheck: "tsc --noEmit",
            test: "vitest run"
          },
          dependencies,
          devDependencies
        },
        null,
        2
      ) + "\n"
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
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "react-jsx",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./*"] }
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"]
        },
        null,
        2
      ) + "\n"
  });

  files.push({
    path: "next.config.ts",
    mode: "scaffold",
    content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`
  });

  files.push({
    path: "app/layout.tsx",
    mode: "scaffold",
    content: layoutSource(ir, options, shadcn)
  });

  if (options.tailwind) {
    files.push({
      path: "postcss.config.mjs",
      mode: "scaffold",
      content: `const config = {
  plugins: {
    "@tailwindcss/postcss": {}
  }
};

export default config;
`
    });
    files.push({
      path: "app/globals.css",
      mode: "scaffold",
      content: shadcn
        ? shadcnGlobalsCss()
        : `@import "tailwindcss";

@custom-variant dark (&:is(.dark *));
`
    });
  }
  if (shadcn) files.push(...shadcnFiles("next"));

  if (!options.app)
    files.push({
      path: "app/page.tsx",
      mode: "scaffold",
      content: shadcn
        ? shadcnHomePage(ir.name)
        : options.tailwind
          ? `export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">${ir.name}</h1>
      <p className="mt-3 text-gray-600 dark:text-gray-400">
        API routes are generated by OSL under{" "}
        <code className="rounded bg-gray-100 px-1 py-0.5 text-sm dark:bg-gray-800">/api</code>. This page is yours to change.
      </p>
    </main>
  );
}
`
          : `export default function Home() {
  return (
    <main>
      <h1>${ir.name}</h1>
      <p>API routes are generated by OSL under /api. This page is yours to change.</p>
    </main>
  );
}
`
    });

  files.push({
    path: ".gitignore",
    mode: "scaffold",
    content: `node_modules/
.next/
.env
*.tsbuildinfo
next-env.d.ts
storage/
`
  });

  files.push({
    path: ".env.example",
    mode: "regions",
    content: `# Copy to .env and fill in. Keep your own variables outside the OSL region.
${REGION_BEGIN("env", "#")}
DATABASE_URL=postgres://postgres@localhost:5432/${ir.name}
${appUrlEnvLine(ir)}${ir.auth ? "OSL_SESSION_SECRET=change-me-to-a-long-random-string\n" : ""}${sealEnvLine(ir)}${envExtras(ir, 3000)}${REGION_END("env", "#")}
`
  });

  files.push({
    path: "generated/README.md",
    content: `# Generated by OSL

Everything in this directory is rewritten by \`osl generate\` from \`.osl/model.yaml\`. Do not edit it.

Put your own code in \`src/\`: \`src/extensions/<resource>.ts\` holds hooks around each resource's handlers and \`src/events/<handler>.ts\` holds event handlers. OSL creates those files once and never touches them again.

Migrations in \`db/migrations\` are a pure function of the model history. Apply them with \`osl migrate\`.
${isolationReadme(ir, "pg-boss")}${sealReadme(ir, "@/generated/seal")}`
  });

  return files;
}

/** Environment the model's features read, with their defaults */
export function envExtras(ir: IR, webPort: number): string {
  const lines: string[] = [];
  if (hasProviders(ir))
    lines.push(
      `OSL_APP_URL=http://localhost:${webPort}`,
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

function layoutSource(ir: IR, options: ScaffoldOptions, shadcn: boolean): string {
  const { tailwind, appearance } = options;
  const metadata = `export const metadata = { title: ${JSON.stringify(ir.name)}, description: ${JSON.stringify(ir.description ?? `${ir.name}, generated by OSL`)} };`;
  const bodyClass = shadcn
    ? ' className="min-h-screen antialiased"'
    : tailwind
      ? ' className="min-h-screen bg-white text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100"'
      : "";
  // The stock shadcn theme maps font-sans to a --font-sans variable the app must define; create-next-app does it
  // with next/font, which needs a download at build time, so OSL sets a system stack instead.
  const fontStyle = shadcn
    ? ' style={{ "--font-sans": "ui-sans-serif, system-ui, sans-serif" } as React.CSSProperties}'
    : "";
  const htmlAttrs =
    (appearance === "dark" ? ' className="dark"' : appearance === "system" ? " suppressHydrationWarning" : "") +
    fontStyle;
  const meta = `        <meta name="color-scheme" content=${JSON.stringify(appearance === "system" ? "light dark" : appearance)} />\n`;
  const script =
    appearance === "system" && tailwind
      ? `        <script dangerouslySetInnerHTML={{ __html: ${JSON.stringify(SYSTEM_THEME_SCRIPT)} }} />\n`
      : "";
  const head = `      <head>\n${meta}${script}      </head>\n`;
  return `${tailwind ? 'import "./globals.css";\n\n' : ""}${metadata}

// Appearance: ${appearance}${appearance === "system" ? " (follows the OS; the dark class is applied before first paint)" : ""}. Set backend_options.appearance in .osl/config.yaml before the first osl generate, or edit this file; OSL never rewrites it.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"${htmlAttrs}>
${head}      <body${bodyClass}>{children}</body>
    </html>
  );
}
`;
}

/** The placeholder home page when shadcn is on */
function shadcnHomePage(name: string): string {
  return `import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// shadcn/ui ${SHADCN_VERSION} components live in components/ui; add more with: npx shadcn@latest add <component>
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">${name}</CardTitle>
          <CardDescription>
            API routes are generated by OSL under <code className="rounded bg-muted px-1 py-0.5 text-xs">/api</code>. This page,
            the components in <code className="rounded bg-muted px-1 py-0.5 text-xs">components/ui</code> and everything in{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">src</code> are yours to change.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <a className={buttonVariants()} href="/api/posts">
            Try an endpoint
          </a>
          <a className={buttonVariants({ variant: "link" })} href="https://ui.shadcn.com/docs/components">
            Browse components
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
`;
}
