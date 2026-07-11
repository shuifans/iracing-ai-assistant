import { defineConfig } from 'vitest/config';
import path from 'path';

const alias = { '@': path.resolve(__dirname, 'src') };

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'contract',
          include: ['tests/contract/**/*.test.ts'],
        },
      },
    ],
  },
});
