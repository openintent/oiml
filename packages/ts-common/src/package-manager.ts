/**
 * The package manager a generated TypeScript project is installed and run with. Chosen per project
 * in .osl/config.yaml (`backend_options.package_manager`); pnpm unless told otherwise.
 */
import type { Cmd, GeneratedFile, ProjectConfig } from "@osl/core";

export const PACKAGE_MANAGERS = ["pnpm", "bun", "npm"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** The configured package manager, validated; pnpm by default. */
export function packageManagerOf(config: ProjectConfig): PackageManager {
  const value = config.backend_options.package_manager ?? "pnpm";
  if (!PACKAGE_MANAGERS.includes(value as PackageManager)) {
    throw new Error(
      `backend_options.package_manager must be one of ${PACKAGE_MANAGERS.join(", ")}; got ${JSON.stringify(value)}`
    );
  }
  return value as PackageManager;
}

/** The install command the harness and the docs use */
export function installCommand(pm: PackageManager): Cmd {
  switch (pm) {
    case "pnpm":
      return { command: "pnpm", args: ["install", "--prefer-offline", "--silent"] };
    case "bun":
      return { command: "bun", args: ["install"] };
    case "npm":
      return { command: "npm", args: ["install", "--no-audit", "--no-fund", "--loglevel=error"] };
  }
}

/** `pnpm install` / `bun install` / `npm install`, for prose */
export function installText(pm: PackageManager): string {
  return `${pm} install`;
}

/** `pnpm dev` / `bun run dev` / `npm run dev`, for prose and scripts */
export function runText(pm: PackageManager, script: string): string {
  return pm === "pnpm" ? `pnpm ${script}` : `${pm} run ${script}`;
}

/**
 * package.json keys that let the named dependencies run their install scripts. bun refuses lifecycle
 * scripts unless a dependency is trusted; npm runs them; pnpm reads its allowance from
 * pnpm-workspace.yaml (see lifecycleFiles).
 */
export function lifecycleAllowance(pm: PackageManager, packages: string[]): Record<string, unknown> {
  if (packages.length === 0) return {};
  switch (pm) {
    case "pnpm":
      return {};
    case "bun":
      return { trustedDependencies: packages };
    case "npm":
      return {};
  }
}

/** Files that carry the lifecycle allowance: pnpm 10 keeps its settings in pnpm-workspace.yaml */
export function lifecycleFiles(pm: PackageManager, packages: string[]): GeneratedFile[] {
  if (pm !== "pnpm" || packages.length === 0) return [];
  return [
    {
      path: "pnpm-workspace.yaml",
      mode: "scaffold",
      content: `# pnpm settings for this project (not a workspace): dependencies allowed to run their install scripts.
allowBuilds:
${packages.map(p => `  ${p}: true`).join("\n")}
`
    }
  ];
}
