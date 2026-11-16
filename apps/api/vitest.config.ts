import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "drizzle"));
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
            // Fake Google client ids/secret for the Google ID-token tests (never real credentials).
            GOOGLE_CLIENT_ID: '111111111111-testwebclient.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'fake-secret-for-tests-only',
            GOOGLE_ANDROID_CLIENT_ID: '111111111111-testandroid.apps.googleusercontent.com',
          },
        },
      };
    }),
  ],
  test: { setupFiles: ['./tests/apply-migrations.ts'], testTimeout: 30_000 },
});
