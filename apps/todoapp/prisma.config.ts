import { defineConfig, env } from "prisma/config";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local first, then fallback to .env
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
