# OIML - Open Intent Modeling Language

**OIML (Open Intent Modeling Language)** is a global standard for AI-driven development that enables declarative code generation through standardized intents.

## What is OpenIntent?

OpenIntent allows developers to describe *what* they want instead of *how* to build it. AI agents read intent files and generate code using framework-specific implementation guides.

**Key Features:**
- **Declarative Development** - Describe features, not implementation
- **Version Locking** - Deterministic code generation with versioned schemas and framework guides
- **Standardized Schema** - Consistent intent structure across projects
- **Agent-Friendly** - IDEs and AI agents can easily understand intents
- **Framework Agnostic** - Support for any database, API, or UI framework

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
# Initialize OpenIntent in your project
oiml init

# Create your first intent
oiml create FEAT-1
```

### Example Intent File

```yaml
# .openintent/intents/FEAT-1/intent.yaml
version: 0.1.x
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

## Project Structure

```
.openintent/
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

## Supported Frameworks

### Database
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
└─────────────────┬───────────────────────────────────┘
                  │
        ┌─────────▼─────────┐
        │  project.yaml     │
        │  Configuration    │
        └─────────┬─────────┘
                  │
        ┌─────────▼─────────┐
        │ Implementation    │
        │ Guides            │
        │ (Prisma, Next.js) │
        └─────────┬─────────┘
                  │
        ┌─────────▼─────────┐
        │ Generated Code    │
        └───────────────────┘
```

## CLI Commands

### Project Management
```bash
oiml init              # Initialize OpenIntent project
oiml create [name]     # Create new intent file
```

## Examples

### Example 1: Adding a Blog Entity

```yaml
version: 0.1.x
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
version: 0.1.x
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
version: 0.1.x
intents:
  - kind: add_endpoint
    scope: api
    method: GET
    path: /api/posts
    entity: Post
    description: Get all posts
```

## Intent Types

| Intent Type | Scope | Description |
|------------|-------|-------------|
| `add_entity` | data | Create database entity/model |
| `add_field` | data | Add fields to existing entity |
| `add_relation` | data | Create relationship between entities |
| `add_endpoint` | api | Create REST API endpoint |
| `add_component` | ui | Create UI component (future) |

## 🔧 Configuration

**project.yaml:**

```yaml
name: My App
oiml_version: 0.1.x

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
  types: packages/types
```

## Workflow

1. **Write Intent** - Create `intent.yaml` file describing what you want
2. **Apply Intent** - AI agent generates code using locked templates
3. **Review Changes** - Check generated code and output summary
4. **Commit** - Include intent, summary, and generated code

## Contributing

We welcome contributions! Areas to contribute:

1. **Schema Development**
   - Help develop the standard

2. **New Framework Support**
   - Add implementation guides for new frameworks
   - Update compatibility matrix
   - Add template metadata

2. **Template Versions**
   - Support new package versions
   - Update existing templates
   - Add breaking change documentation

3. **CLI Enhancements**
   - New commands and features
   - Better error messages
   - Improved UX

4. **Documentation**
   - Examples and tutorials
   - Framework-specific guides
   - Best practices

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Learn More

- **Website**: [oiml.dev](https://oiml.dev)
- **Docs**: [docs.oiml.dev](https://docs.oiml.dev)
- **GitHub**: [github.com/openintent/oiml](https://github.com/openintent/oiml)
- **Discord**: [https://discord.gg/QnvqZ2Pj](https://discord.gg/QnvqZ2Pj)

## Support

- **GitHub Issues**: [github.com/openintent/oiml/issues](https://github.com/openintent/oiml/issues)
- **Email**: [support@oiml.dev](mailto:support@oiml.dev)
