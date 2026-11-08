# drizzly

OSL sample app built with Next.js API routes on Drizzle ORM and PostgreSQL. Every file under `lib/`, `app/api/`, `packages/types/` and `drizzle/` was produced by applying the intents in `.osl/intents/` with the Drizzle and Next.js template packs.

| Intent   | What it exercises                                                               |
| -------- | ------------------------------------------------------------------------------- |
| `FEAT-1` | Two entities, a `many_to_one` relation and four endpoints                       |
| `FEAT-2` | A column rename with the non-interactive rename procedure, then an added column |

## Run it

```bash
cp .env.example .env   # point DATABASE_URL at a PostgreSQL database
pnpm install
pnpm db:migrate
pnpm dev
```
