# Template Compatibility Matrix

This directory contains version compatibility information for OpenIntent templates.

## Purpose

The compatibility matrix ensures that users get template versions that are compatible with their:

- OIML schema version
- Installed package versions (e.g., Prisma 6.19.0, Next.js 16.0.1)

## Structure

### `matrix.json`

The main compatibility matrix file that maps:

- Framework name (e.g., "prisma", "next")
- Template version (e.g., "1.0.0", "1.1.0")
- Compatible OIML versions (e.g., ["0.1.x", "0.2.x"])
- Compatible package versions (e.g., {"prisma": ["6.x.x"]})
- Breaking changes list

### Schema

```typescript
interface TemplateCompatibility {
  framework: string;
  category: "database" | "api" | "ui";
  versions: {
    template_version: string;
    oiml_versions: string[];
    package_versions: Record<string, string[]>;
    breaking_changes?: string[];
    deprecated?: boolean;
  }[];
}
```

## Version Matching

Version ranges are matched using simple semantic versioning:

- `"6.x.x"` - Matches any 6.x.x version (e.g., 6.19.0, 6.20.1)
- `"6.19.0"` - Exact version match
- `"*"` - Matches any version

## Adding New Template Versions

When you update a template to support new package versions:

1. **Create new template version** (if breaking changes)

   ```
   templates/database/prisma.v1.1.0.md
   ```

   Or update the existing template if non-breaking.

2. **Update `matrix.json`**

   ```json
   {
     "framework": "prisma",
     "category": "database",
     "versions": [
       {
         "template_version": "1.1.0",
         "oiml_versions": ["0.1.x", "0.2.x"],
         "package_versions": {
           "prisma": ["6.x.x", "7.0.0"],
           "@prisma/client": ["6.x.x", "7.0.0"]
         },
         "breaking_changes": ["Added support for Prisma 7.x", "Updated migration patterns"]
       }
     ]
   }
   ```

3. **Mark old versions as deprecated** (if needed)
   ```json
   {
     "template_version": "1.0.0",
     "deprecated": true
   }
   ```

## Resolution Algorithm

1. **Filter by framework and category** (e.g., prisma + database)
2. **Check OIML version compatibility** - Must match project's OIML version
3. **Check package version compatibility** - All relevant packages must match
4. **Filter out deprecated versions** (unless no other option)
5. **Select best match** - Prefer exact matches, fall back to latest compatible

## Example

**Given:**

- project.yaml: `version: "0.1.0"`
- package.json: `"prisma": "6.19.0"`

**Resolution:**

1. Find "prisma" + "database" in matrix
2. Check versions:
   - v1.0.0: OIML 0.1.x ✓, Prisma 6.x.x ✓ → **Compatible**
   - v1.1.0: OIML 0.1.x ✓, Prisma 6.x.x ✓ → **Compatible**
3. Select latest compatible: **v1.1.0**

**Result:**

```yaml
templates:
  - framework: prisma
    template_version: "1.1.0"
    template_path: "templates/database/prisma.md"
    compatible_package_versions: ["6.x.x", "7.0.0"]
```
