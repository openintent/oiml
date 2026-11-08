#!/usr/bin/env node
/**
 * Refresh the embedded shadcn/ui sources from the registry.
 *
 * Runs the real shadcn CLI (init + add) in a throwaway Next.js and Tailwind 4 project,
 * then writes what it produced, verbatim, into src/shadcn-sources.ts. Nothing is edited
 * by hand, so the backend scaffolds exactly what `npx shadcn@latest` writes today.
 *
 *   node scripts/sync-shadcn.mjs            # latest shadcn
 *   node scripts/sync-shadcn.mjs 4.23.0     # a specific CLI version
 *
 * Afterwards: pnpm build, then `pnpm conformance --update` at the repo root for the TypeScript backends.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../src/shadcn-sources.ts");
const version = process.argv[2] ?? "latest";
const spec = `shadcn@${version}`;

/**
 * The base set every generated app gets: form and table primitives, and the sidebar shell with
 * what it pulls in. Anything else is `npx shadcn add` in the project.
 */
const COMPONENTS = [
  "avatar",
  "badge",
  "button",
  "card",
  "checkbox",
  "dropdown-menu",
  "input",
  "label",
  "select",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "table",
  "textarea",
  "tooltip"
];

/** Dependencies the scratch project has before shadcn runs; everything shadcn adds on top is recorded. */
const BASE_DEPENDENCIES = {
  next: "^16",
  react: "^19",
  "react-dom": "^19"
};
const BASE_DEV_DEPENDENCIES = {
  "@tailwindcss/postcss": "^4",
  "@types/node": "^24",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  postcss: "^8",
  tailwindcss: "^4",
  typescript: "^5"
};

const dir = mkdtempSync(path.join(tmpdir(), "osl-shadcn-sync-"));
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } });
const write = (rel, content) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
};

try {
  console.log(`scratch project in ${dir}`);
  write(
    "package.json",
    JSON.stringify(
      { name: "shadcn-sync", private: true, dependencies: BASE_DEPENDENCIES, devDependencies: BASE_DEV_DEPENDENCIES },
      null,
      2
    )
  );
  write(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["dom", "dom.iterable", "esnext"],
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] }
        },
        include: ["**/*.ts", "**/*.tsx"]
      },
      null,
      2
    )
  );
  write("next.config.ts", "const nextConfig = {};\nexport default nextConfig;\n");
  write("postcss.config.mjs", 'const config = { plugins: { "@tailwindcss/postcss": {} } };\nexport default config;\n');
  write("app/globals.css", '@import "tailwindcss";\n');
  write(
    "app/layout.tsx",
    'import "./globals.css";\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n'
  );
  write("app/page.tsx", "export default function Home() {\n  return <main />;\n}\n");

  console.log("installing the scratch project");
  run("pnpm", ["install", "--prefer-offline", "--silent"]);
  console.log(`running ${spec} init`);
  run("npx", ["-y", spec, "init", "-d", "-y"]);
  console.log(`running ${spec} add ${COMPONENTS.join(" ")}`);
  run("npx", ["-y", spec, "add", ...COMPONENTS, "-y", "-o"]);

  const resolvedVersion = JSON.parse(run("npm", ["view", spec, "version", "--json"]).toString()).toString();
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const added = (section, base) =>
    Object.fromEntries(
      Object.entries(pkg[section] ?? {})
        .filter(([name]) => !(name in base))
        .sort(([a], [b]) => a.localeCompare(b))
    );
  const dependencies = added("dependencies", BASE_DEPENDENCIES);
  const devDependencies = added("devDependencies", BASE_DEV_DEPENDENCIES);

  const sources = {};
  const take = rel => (sources[rel] = readFileSync(path.join(dir, rel), "utf8"));
  take("components.json");
  take("lib/utils.ts");
  take("app/globals.css");
  const produced = readdirSync(path.join(dir, "components/ui")).sort();
  for (const file of produced) take(`components/ui/${file}`);
  const missing = COMPONENTS.filter(c => !produced.includes(`${c}.tsx`));
  if (missing.length) throw new Error(`shadcn did not write: ${missing.join(", ")}`);
  // Hooks some components depend on (the sidebar's use-mobile)
  if (existsSync(path.join(dir, "hooks"))) {
    for (const file of readdirSync(path.join(dir, "hooks")).sort()) take(`hooks/${file}`);
  }

  const out = `/**
 * Stock shadcn/ui sources, captured verbatim from the shadcn CLI by scripts/sync-shadcn.mjs.
 * Do not edit by hand; rerun the script to refresh.
 */

export const SHADCN_VERSION = ${JSON.stringify(resolvedVersion)};

/** Packages the shadcn CLI added to the scratch project, with the ranges it chose */
export const SHADCN_DEPENDENCIES: Record<string, string> = ${JSON.stringify(dependencies, null, 2)};
export const SHADCN_DEV_DEPENDENCIES: Record<string, string> = ${JSON.stringify(devDependencies, null, 2)};

/** Project-relative path to file content */
export const SHADCN_SOURCES: Record<string, string> = {
${Object.entries(sources)
  .map(([rel, content]) => `  ${JSON.stringify(rel)}: ${JSON.stringify(content)}`)
  .join(",\n")}
};
`;
  writeFileSync(target, out);
  console.log(
    `wrote ${path.relative(process.cwd(), target)}: shadcn ${resolvedVersion}, ${Object.keys(sources).length} files, deps ${Object.keys(dependencies).join(", ")}`
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
