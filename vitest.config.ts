import { defineConfig } from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';

const alias = { '@': path.resolve(__dirname, 'src') };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias,
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          environment: 'jsdom',
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
