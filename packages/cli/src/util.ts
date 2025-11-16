import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get OIML version from schema package.json
export function getOimlVersion(): string {
  // Try multiple possible locations:
  // 1. Standalone npm install: node_modules/@oiml/schema/package.json
  // 2. Monorepo: packages/schema/package.json (relative to CLI package)
  // 3. Workspace: node_modules/@oiml/schema/package.json (pnpm workspace)
  const possiblePaths = [
    // Standalone npm install - look for @oiml/schema in node_modules
    resolve(process.cwd(), "node_modules/@oiml/schema/package.json"),
    // Monorepo - relative to CLI package location
    resolve(__dirname, "../../schema/package.json"),
    // Workspace - from project root
    resolve(process.cwd(), "../../packages/schema/package.json"),
    // Alternative workspace location
    resolve(__dirname, "../../../schema/package.json")
  ];

  for (const schemaPackagePath of possiblePaths) {
    try {
      if (existsSync(schemaPackagePath)) {
        const packageJson = JSON.parse(readFileSync(schemaPackagePath, "utf-8"));
        return packageJson.version || "0.1.0";
      }
    } catch (error) {
      // Continue to next path
      continue;
    }
  }

  // Fallback to default if we can't read the package.json
  return "0.1.0";
}
