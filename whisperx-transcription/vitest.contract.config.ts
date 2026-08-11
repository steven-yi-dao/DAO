import { defineConfig } from 'vitest/config';
import { BASE_URL } from './tests/contract/config';

/**
 * Opt-in: `npm run test:contract`. Spawns the real FastAPI app against a
 * scratch /data and drives it through the same client the SPA uses. Needs a
 * Python with fastapi, uvicorn, and python-multipart — see tests/contract/config.ts.
 */
export default defineConfig({
  test: {
    include: ['tests/contract/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/contract/server.ts'],
    // Sequential: the tests assert against a shared job list.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      VITE_API_URL: BASE_URL,
      TZ: 'UTC',
    },
  },
});
