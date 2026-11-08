# Template Compatibility Matrix

`matrix.json` tells the `resolve_template` MCP tool which template pack (implementation guide) to use for a framework, given the OSL intent version and the installed framework version.

## Format

```typescript
interface CompatibilityEntry {
  framework: string; // e.g. "prisma", "drizzle", "next"
  category: "database" | "api" | "ui" | "capability";
  capability?: string; // capability packs only, e.g. "auth"
  versions: Array<{
    template_version: string; // pack version, e.g. "1.0.0"
    pack_name: string; // must equal the pack manifest's "name"
    template_path: string; // pack folder relative to @osl/schema, e.g. "templates/database/drizzle/1.0.0"
    compat: Record<string, string>; // version ranges; "osl" and the framework key are required
    breaking_changes: string[];
  }>;
}
```

`compat` ranges are space-separated comparators: `">=0.45.0 <1.0.0"`. Supported operators are `>=`, `>`, `<=`, `<` and exact versions.

## Resolution

1. Find the entry for `framework`. When `capability` is passed, only capability entries match. Otherwise capability entries are ignored, so `next` resolves to the API pack.
2. Drop versions whose `template_path` has no `AGENTS.md` in the installed `@osl/schema` package.
3. Keep versions where the intent version satisfies `compat.osl` and the installed version satisfies `compat[framework]`.
4. Return the newest remaining version, with `template_path` pointing at its `AGENTS.md`.

Installed versions may be passed as `package.json` specifiers (`^0.45.4`, `~6.19.0`) or Go module versions (`v1.10.0`). Pre-release versions are compared by their core version, so `1.0.0-rc.5` does not satisfy `<1.0.0`.

## Adding or Changing a Pack

1. Add the pack under `packages/schema/templates/{category}/{framework}/{version}/` (or `templates/capability/{capability}/{framework}/{version}/`) with `AGENTS.md` and `manifest.json`.
2. Add a version to the framework's entry in `matrix.json` with the same `pack_name`, `template_version` and `template_path`.
3. Run the consistency check:

   ```bash
   pnpm --filter @osl/mcp check:matrix
   ```

   It fails when a matrix version points at a missing pack, when a manifest disagrees with the matrix, or when a pack on disk is missing from the matrix.
