# OpenIntent Implementation Templates

This directory contains framework-specific implementation guides for applying OpenIntent intents. These templates provide detailed instructions, code examples, and best practices for AI agents and developers implementing OpenIntent-based code generation.

## Directory Structure

```
templates/
├── database/          # Database framework implementation guides
│   ├── prisma/
│   │   └── 1.0.0/
│   │       ├── AGENTS.md
│   │       └── manifest.json
│   ├── ent/
│   │   └── 1.0.0/
│   │       ├── AGENTS.md
│   │       └── manifest.json
│   └── [future: mongoose/, sqlalchemy/, etc.]
│
├── api/              # API framework implementation guides
│   ├── next/
│   │   └── 1.0.0/
│   │       ├── AGENTS.md
│   │       └── manifest.json
│   ├── gin/
│   │   └── 1.0.0/
│   │       ├── AGENTS.md
│   │       └── manifest.json
│   └── [future: express/, fastapi/, etc.]
│
└── ui/               # UI framework implementation guides
    └── [future: react/, vue/, etc.]
```

## Usage

### For AI Agents

When processing OpenIntent files (`intent.yaml`):

1. Read the project's `.openintent/project.yaml` configuration
2. Identify the relevant frameworks:
   - `database.framework` (e.g., "prisma")
   - `api.framework` (e.g., "next")
   - `ui.framework` (e.g., "react")
3. Consult the corresponding implementation guide for detailed instructions
4. Follow the guide's patterns and examples for code generation

### For Developers

These guides can be used to:

- Understand how intents are mapped to actual code
- Learn framework-specific patterns and best practices
- Manually implement intents when needed
- Contribute new framework implementations

## Available Guides

### Database Frameworks

- **[Prisma](./database/prisma/1.0.0/AGENTS.md)** - Complete Prisma implementation guide
  - Field type mappings (OpenIntent → Prisma)
  - Implementation steps for all data intents
  - Migration handling and patterns
  - TypeScript type generation

- **[Ent](./database/ent/1.0.0/AGENTS.md)** - Complete Ent ORM implementation guide
  - Field type mappings (OpenIntent → Ent)
  - Schema definition patterns
  - Code generation and auto-migration
  - Go type generation and client usage

### API Frameworks

- **[Next.js](./api/next/1.0.0/AGENTS.md)** - Complete Next.js App Router implementation guide
  - File structure and routing conventions
  - HTTP method templates (GET, POST, PATCH, DELETE)
  - Response structure patterns
  - Error handling and authentication

- **[Gin](./api/gin/1.0.0/AGENTS.md)** - Complete Gin framework implementation guide
  - Router setup and route patterns
  - HTTP method templates (GET, POST, PATCH, DELETE)
  - Handler function patterns
  - Error handling and middleware integration

## Contributing New Templates

To add support for a new framework:

1. Create a new versioned directory structure:
   - Database: `database/{framework}/1.0.0/`
   - API: `api/{framework}/1.0.0/`
   - UI: `ui/{framework}/1.0.0/`

2. Create the required files:
   - `AGENTS.md` - Complete implementation guide
   - `manifest.json` - Template metadata and versioning info

3. Follow the existing template structure:
   - **When to Use This Guide** - Condition for using this guide
   - **Prerequisites** - Required setup
   - **Type Mappings** - OpenIntent to framework type mappings
   - **Intent Implementation** - Step-by-step instructions for each intent type
   - **Examples** - Complete code examples
   - **Best Practices** - Framework-specific recommendations

4. Submit a pull request with:
   - The new template file
   - Update to this README
   - Example intent files demonstrating usage

## Template Structure

Each implementation guide should include:

### 1. Introduction

- When to use this guide
- Prerequisites
- Framework version requirements

### 2. Type Mappings

- Complete mapping tables
- Field attributes handling
- Special cases and edge cases

### 3. Intent Implementations

For each supported intent type:

- Step-by-step implementation instructions
- Code generation patterns
- Migration/build steps
- Type generation

### 4. Examples

- Complete working examples
- Before/after code snippets
- Common use cases

### 5. Best Practices

- Framework-specific patterns
- Performance considerations
- Security guidelines
- Testing approaches

## Integration

These templates are included in the `@oiml/schema` package and can be accessed at:

```
@oiml/schema/templates/{category}/{framework}/{version}/AGENTS.md
```

**In published package:**

```javascript
import path from "path";
import { readFileSync } from "fs";

// Get template path
const templatePath = require.resolve("@oiml/schema/templates/database/prisma/1.0.0/AGENTS.md");
const content = readFileSync(templatePath, "utf-8");
```

**GitHub URL:**

```
https://github.com/openintent/oiml/blob/main/packages/schema/templates/{category}/{framework}/{version}/AGENTS.md
```

## Validation

Templates should be validated to ensure:

- All OpenIntent field types are covered
- All intent types are documented
- Code examples are syntactically correct
- Examples match the latest framework versions
- Links and references are accurate

## Related Documentation

- [OpenIntent Schema](../README.md) - Intent file schema definitions
- [AGENTS.md](../../cli/src/templates/AGENTS.md) - Master workflow orchestration guide
- [OpenIntent Specification](https://github.com/openintent/oiml) - Complete OIML specification

## Support

For questions or issues with implementation guides:

- Create an issue on [GitHub](https://github.com/openintent/oiml/issues)
- Join the discussion on [Discord](https://discord.gg/openintent)
- Review examples in the [examples directory](../../../examples)

## License

These templates are part of the OpenIntent project and are licensed under the [Mozilla Public License 2.0](../../../LICENSE).
