import { defineConfig } from 'vite';

const isDev =
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

export default defineConfig({
  test: {
    include: ['tests/*.test.{ts,tsx,js}', 'src/**/*.test.{ts,tsx,js}'],
    testTimeout: 2_000,
    allowOnly: isDev,
  },
});
