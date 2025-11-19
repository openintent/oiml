# OIML - Open Intent Modeling Language

**OIML (Open Intent Modeling Language)** is an open standard for AI-driven development that enables declarative code generation through structured intents.

## What is OIML?

OIML allows developers to describe _what_ they want instead of _how_ to build it. AI agents read intent files and generate code using framework-specific implementation guides called "packs".

**Key Features:**

- **Declarative Development** - Describe features, not implementation
- **Versioning** - Deterministic code generation with versioned schemas and framework guides
- **Standardized Schema** - Consistent intent structure across projects
- **Agent-Friendly** - IDEs and AI agents can easily understand intents
- **Framework Agnostic** - Support for any database, API, or UI framework
- **LLM & IDE Agnostic** - Not tied to any particular LLM or coding IDE
- **Open Source** - 100% free forever under Apache 2.0 license

## Quick Start

### Installation

```bash
# Using npm
npm install -g @oiml/cli

# Using pnpm
pnpm add -g @oiml/cli
```

### Initialize a Project

```bash
# Initialize OIML in your project
oiml init
```

## Project Structure

```
.oiml/
├── project.yaml              # Project configuration
├── AGENTS.md                 # AI implementation guide
│
└── intents/                  # All intents (organized by ticket/issue ID)
    ├── FEAT-1/               # One folder per intent
    │   ├── intent.yaml       # Declarative specification
    │   └── summary.yaml      # Output summary
    │
    └── FEAT-2/               # Another intent
        ├── intent.yaml
        └── summary.yaml
```

# Create your first intent
```bash
oiml create FEAT-1
```

### Example Intent File

```yaml
# .oiml/intents/FEAT-1/intent.yaml
version: x.x.x
type: oiml.intent
intents:
  - kind: add_entity
    scope: data
    entity: User
    fields:
      - name: id
        type: uuid
        required: true
      - name: email
        type: string
        unique: true
        required: true
      - name: name
        type: string
        required: true

  - kind: add_endpoint
    scope: api
    method: POST
    path: /api/users
    entity: User
    description: Create a new user
```

## Supported Frameworks

### Database/ORM

- ✅ Prisma
- ✅ Ent
- 🔄 Mongoose (coming soon)
- 🔄 SQLAlchemy (coming soon)

### API

- ✅ Next.js
- ✅ Gin
- 🔄 Express (coming soon)
- 🔄 FastAPI (coming soon)

### UI

- 🔄 React (coming soon)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Intent Files (intent.yaml)             │
└─────────────────────────────────────────────────────┘
                           │
           ┌───────────────▼───────────────┐
           │         project.yaml          │
           │         Configuration         │
           └───────────────┬───────────────┘
                           │
           ┌───────────────▼───────────────┐
           │      Implementation           │
           │      Guides                   │
           │      (e.g. Prisma, Next.js)   │
           └───────────────┬───────────────┘
                           │
           ┌───────────────▼───────────────┐
           │        Generated Code         │
           └───────────────────────────────┘
```

## CLI Commands

### Project Management

```bash
oiml init              # Initialize project
oiml create [name]     # Create new intent file
```

## Examples

### Example 1: Adding a Blog Entity

```yaml
version: x.x.x
type: oiml.intent
intents:
  - kind: add_entity
    scope: data
    entity: Post
    fields:
      - name: id
        type: uuid
        required: true
      - name: title
        type: string
        max_length: 255
        required: true
      - name: content
        type: text
        required: false
      - name: published
        type: boolean
        default: false
```

### Example 2: Adding User-Post Relation

```yaml
version: x.x.x
type: oiml.intent
intents:
  - kind: add_relation
    scope: data
    relation:
      source_entity: Post
      target_entity: User
      kind: many_to_one
      field_name: author
      foreign_key:
        local_field: author_id
        target_field: id
```

### Example 3: Adding API Endpoint

```yaml
version: x.x.x
type: oiml.intent
intents:
  - kind: add_endpoint
    scope: api
    method: GET
    path: /api/posts
    entity: Post
    description: Get all posts
```

## Intent Types

| Intent Type      | Scope      | Description                          |
| -----------------| -----------| ------------------------------------ |
| `add_entity`     | data       | Create database entity/model         |
| `add_field`      | data       | Add fields to existing entity        |
| `add_relation`   | data       | Create relationship between entities |
| `add_endpoint`   | api        | Create REST API endpoint             |
| `add_capability` | capability | Create capability (e.g. integration) |
| `add_component`  | ui         | Create UI component (future)         |

## 🔧 Configuration

**project.yaml:**

```yaml
name: My App
version: x.x.x

api:
  framework: next
  language: typescript

database:
  type: postgres
  framework: prisma
  schema: prisma/schema.prisma

paths:
  api: app/api
  components: app/components
  types: types
```

**MCP Server:**

```json
{
  "mcpServers": {
    "oiml": {
      "type": "sse",
      "url": "https://mcp.oiml.dev/mcp"
    }
  }
}
```

## Workflow

1. **Add MCP Server** - Used to validate intents and issue proper schema for agents to follow
2. **Write Intent** - Create `intent.yaml` file describing what you want, adhering to OIML schema
3. **Apply Intent** - Provide the intent file in your prompt and say "apply this intent"
4. **Review Changes** - Check generated code and output summary
5. **Commit** - Include intent, summary, and generated code

## Contributing

We welcome contributions! Areas to contribute:

1. **Schema Development**
   - Help develop the standard

2. **New Framework Support**
   - Add implementation guides for new frameworks
   - Add template metadata

3. **Template Versions**
   - Support new package versions
   - Update existing templates
   - Add breaking change documentation

4. **CLI Enhancements**
   - New commands and features
   - Better error messages
   - Improved UX

5. **Documentation**
   - Examples and tutorials
   - Framework-specific guides
   - Best practices

E-mail [admin@oiml.dev](mailto:admin@oiml.dev) if interested.

## Learn More

- **Website**: [oiml.dev](https://oiml.dev)
- **Discord**: [https://discord.gg/S9XuvCYa](https://discord.gg/S9XuvCYa)

## Support

- **GitHub Issues**: [github.com/openintent/oiml/issues](https://github.com/openintent/oiml/issues)
- **Email**: [support@oiml.dev](mailto:support@oiml.dev)
