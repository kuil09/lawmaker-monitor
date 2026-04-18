import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"];
const typedSourceFiles = ["**/*.{ts,tsx,mts,cts}"];
const browserSourceFiles = ["apps/web/src/**/*.{ts,tsx}"];
const nodeSourceFiles = [
  "*.config.{ts,mts,js,mjs,cjs}",
  "scripts/**/*.{ts,mts,js,mjs,cjs}",
  "tests/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
  "packages/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
];
const hashAdapterFiles = [
  "apps/web/src/hooks/useHashRoute.ts",
  "apps/web/src/lib/route-state.ts"
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/.vite/**",
      "artifacts/**",
      "published-data/**",
      "tests/fixtures/**",
      "apps/web/public/**",
      "tests/**",
      "vitest*.ts",
      "**/vite.config.ts"
    ]
  },
  {
    files: sourceFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      import: importPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "import/order": [
        "error",
        {
          alphabetize: {
            order: "asc",
            caseInsensitive: true
          },
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "type"
          ],
          "newlines-between": "always"
        }
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    files: typedSourceFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports"
        }
      ],
      "@typescript-eslint/no-floating-promises": "error"
    }
  },
  {
    files: browserSourceFiles,
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    rules: {
      "react-refresh/only-export-components": [
        "error",
        {
          allowConstantExport: true
        }
      ]
    }
  },
  {
    files: nodeSourceFiles,
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: hashAdapterFiles,
    rules: {}
  }
);
