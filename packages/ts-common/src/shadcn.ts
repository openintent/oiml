/**
 * shadcn/ui scaffold: the config, theme, `cn` helper, hooks and a base set of components, exactly as
 * the shadcn CLI writes them. The sources live in shadcn-sources.ts, captured by
 * scripts/sync-shadcn.mjs from the registry; nothing here is hand-authored. shadcn components
 * are copied source, so they are scaffold files the user owns, and `npx shadcn add <component>`
 * works afterwards because components.json is present.
 */
import type { GeneratedFile } from "@osl/core";
import { SHADCN_SOURCES, SHADCN_VERSION } from "./shadcn-sources.js";

export { SHADCN_DEPENDENCIES, SHADCN_DEV_DEPENDENCIES, SHADCN_VERSION } from "./shadcn-sources.js";

const GLOBALS = "app/globals.css";

export const SHADCN_COMPONENTS = Object.keys(SHADCN_SOURCES)
  .filter(p => p.startsWith("components/ui/"))
  .map(p => p.slice("components/ui/".length, -".tsx".length))
  .sort();

/** The stock theme the shadcn CLI writes (app/globals.css in a Next.js project, src/index.css in a Vite one) */
export function shadcnGlobalsCss(): string {
  return SHADCN_SOURCES[GLOBALS];
}

/**
 * How a project lays out shadcn's files. The CLI captures a Next.js project, where `@/` is the
 * project root; a Vite project keeps the same files under src/, with `@/` pointing there, so
 * every import inside the components stays the same.
 */
export type ShadcnLayout = "next" | "vite";

/** Every shadcn scaffold file except the theme CSS, which the backend's own CSS scaffold owns. */
export function shadcnFiles(layout: ShadcnLayout = "next"): GeneratedFile[] {
  return Object.entries(SHADCN_SOURCES)
    .filter(([path]) => path !== GLOBALS)
    .map(([path, content]) => ({ path: layout === "vite" ? vitePath(path) : path, content }))
    .map(({ path, content }) => ({
      path,
      mode: "scaffold" as const,
      content: path === "components.json" && layout === "vite" ? viteComponentsJson(content) : content
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function vitePath(path: string): string {
  if (path === "components.json") return path;
  return `src/${path}`;
}

/** The captured components.json with the Vite project's own facts: no RSC, CSS under src. */
function viteComponentsJson(captured: string): string {
  const config = JSON.parse(captured) as { rsc: boolean; tailwind: { css: string } };
  config.rsc = false;
  config.tailwind.css = "src/index.css";
  return JSON.stringify(config, null, 2) + "\n";
}
