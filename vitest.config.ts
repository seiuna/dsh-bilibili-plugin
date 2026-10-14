import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-tools': path.resolve(import.meta.dirname, './test/mocks/dsh-tools.ts'),
      '@deepseek-ai/cordis': path.resolve(import.meta.dirname, './test/mocks/cordis.ts'),
      '@deepseek-ai/schemastery': path.resolve(import.meta.dirname, './test/mocks/schemastery.ts'),
      '@deepseek-ai/dsh-session': path.resolve(import.meta.dirname, './test/mocks/dsh-session.ts'),
      '@deepseek-ai/dsh-llm': path.resolve(import.meta.dirname, './test/mocks/dsh-llm.ts'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    testTimeout: 15000,
  },
});
