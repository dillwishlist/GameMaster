import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root is ./client. These tests are about
// the server: the reducer, the projection boundary, and content validation.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
