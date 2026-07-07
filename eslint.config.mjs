import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'node_modules/',
      '.vite/',
      'out/',
      'dist/',
      '.release/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      // The OmniFocus JXA MCP server is a standalone package; linted on its own.
      'sinks/omnifocus-jxa/',
    ],
  },
  // Base JS recommendations
  js.configs.recommended,
  // Type-checked TS recommendations (strictest)
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Renderer-specific (React + DOM globals)
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  // Main/preload (Electron — has access to Node + Electron globals)
  {
    files: ['src/main/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // Test files
  {
    files: ['**/*.test.ts', 'src/**/*.test.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Forge / vite configs at root
  {
    files: ['forge.config.ts', 'vite.*.config.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // Turn off formatting rules that conflict with Prettier
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // IPC handlers (`ipcMain.handle`) are conventionally async so they can
      // grow awaits without a signature change; the rule's churn isn't worth it
      // for this Electron-heavy codebase.
      '@typescript-eslint/require-await': 'off',
    },
  },
);
