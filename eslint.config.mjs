// One flat config for the whole workspace. `pnpm lint` runs it from the root.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/dist/**',
    '**/coverage/**',
    '**/next-env.d.ts',
    'playwright-report/**',
    'reports/**',
    'test-results/**',
    // Generated. The registry drift check owns these.
    'apps/web/src/lib/registry.generated.ts',
    'apps/web/src/lib/registry.styles.generated.ts',
    // Test inputs whose exact bytes are the point.
    '**/__fixtures__/**',
    // Local-only trees (gitignored).
    'archive/**',
    'experiments/**',
    '.variant-preview/**',
  ]),
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    settings: {
      next: { rootDir: 'apps/web/' },
      // `detect` resolves react from the working directory, and the root has none.
      react: { version: '19.2' },
    },
  },
  {
    files: ['**/*.cjs'],
    rules: {
      // CommonJS modules load dependencies with require() by definition.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
