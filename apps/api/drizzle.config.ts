import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations into ./drizzle, applied by `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
