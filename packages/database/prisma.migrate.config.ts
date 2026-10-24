import { defineConfig, env } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: env("RALLYPOINT_MIGRATIONS_PATH") },
  datasource: { url: env("RALLYPOINT_MIGRATION_DATABASE_URL") },
});
