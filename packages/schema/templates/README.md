# OpenIntent Implementation Templates

This directory contains framework-specific implementation guides for applying OpenIntent intents. These templates provide detailed instructions, code examples, and best practices for AI agents and developers implementing OpenIntent-based code generation.

## Directory Structure

```
templates/
├── database/          # Database framework implementation guides
│   ├── prisma.md     # Prisma ORM implementation guide
│   └── [future: mongoose.md, sqlalchemy.md, etc.]
│
├── api/              # API framework implementation guides
│   ├── nextjs.md    # Next.js App Router implementation guide
│   └── [future: express.md, fastapi.md, etc.]
│
└── ui/               # UI framework implementation guides
    └── [future: react.md, vue.md, etc.]
```

## Usage

### For AI Agents

When processing OpenIntent files (`.oiml.yaml`):

1. Read the project's `.openintent/project.yaml` configuration
2. Identify the relevant frameworks:
   - `database.framework` (e.g., "prisma")
   - `api.framework` (e.g., "nextjs")
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

- **[Prisma](./database/prisma.md)** - Complete Prisma implementation guide
  - Field type mappings (OpenIntent → Prisma)
  - Implementation steps for all data intents
  - Migration handling and patterns
  - TypeScript type generation

### API Frameworks

- **[Next.js](./api/nextjs.md)** - Complete Next.js App Router implementation guide
  - File structure and routing conventions
  - HTTP method templates (GET, POST, PATCH, DELETE)
  - Response structure patterns
  - Error handling and authentication

## Contributing New Templates

To add support for a new framework:

1. Create a new markdown file in the appropriate directory:
   - Database: `database/{framework}.md`
   - API: `api/{framework}.md`
   - UI: `ui/{framework}.md`

2. Follow the existing template structure:
   - **When to Use This Guide** - Condition for using this guide
   - **Prerequisites** - Required setup
   - **Type Mappings** - OpenIntent to framework type mappings
   - **Intent Implementation** - Step-by-step instructions for each intent type
   - **Examples** - Complete code examples
   - **Best Practices** - Framework-specific recommendations

3. Submit a pull request with:
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
@oiml/schema/templates/{category}/{framework}.md
```

**In published package:**
```javascript
import path from 'path';
import { readFileSync } from 'fs';

// Get template path
const templatePath = require.resolve('@oiml/schema/templates/database/prisma.md');
const content = readFileSync(templatePath, 'utf-8');
```

**GitHub URL:**
```
https://github.com/openintent/oiml/blob/main/packages/schema/templates/{category}/{framework}.md
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


