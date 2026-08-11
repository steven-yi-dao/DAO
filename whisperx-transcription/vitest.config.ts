import { defineConfig } from 'vitest/config';

// Unit tests only. The client is exercised against stubbed fetch/XHR here; the
// live contract test against a real backend lives in vitest.contract.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      // Pin both, so a developer's .env.local can't change what the
      // assertions on request URLs and formatted dates are comparing against.
      VITE_API_URL: '/api',
      TZ: 'UTC',
    },
  },
});
