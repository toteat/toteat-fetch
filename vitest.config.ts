import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['__tests__/**/*.ts'],
  },
  resolve: {
    alias: {
      'toteat-fetch': resolve(__dirname, 'src/index.ts'),
    },
  },
});
