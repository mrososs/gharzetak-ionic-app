import { defineConfig } from 'vitest/config';

// Integration tests that drive the REAL Angular services (AuthService, AppStore, SyncService, GuestImportService)
// against a RUNNING local Worker (`npm run api:dev`, Wrangler's simulated D1 + R2). Not part of `ng test`.
// Run: npm run e2e:sync
export default defineConfig({
  esbuild: { target: 'es2022', tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:4200/' } },
    include: ['e2e/**/*.e2e.ts'],
    setupFiles: ['e2e/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
