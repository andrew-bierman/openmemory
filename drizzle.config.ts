import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./apps/api/drizzle",
  schema: "./apps/api/src/db/schema.ts",
});
