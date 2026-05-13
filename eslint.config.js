// @ts-check
/**
 * ESLint flat config for pnake.
 *
 * Lint baselines are intentionally on the strict side:
 *  - typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`
 *  - eslint-plugin-import-x `recommended` + `typescript`
 *  - react-hooks + react-refresh
 *
 * Rules that fight the codebase (e.g. heavy use of post-regex non-null
 * assertions, ambient PDF parsing where the bytes-untyped boundary
 * legitimately needs runtime checks TS can't prove) are demoted or
 * disabled below with the reason inline. oxfmt owns whitespace and
 * style — we don't replicate formatter rules here.
 *
 * Module boundaries:
 *  - ui/      → cannot import from worker/pdf/**
 *  - shared/  → cannot import from ui/, worker/, core/, pdfjs/
 *  - tests/   → many checks relaxed so test plumbing stays cheap
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import importX from "eslint-plugin-import-x";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "tests/e2e/**", // Playwright specs run under their own toolchain
      "*.config.js",
      "*.config.ts",
      "eslint.config.js",
    ],
  },

  js.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
    settings: {
      "import-x/resolver-next": [importX.createNodeResolver()],
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "unused-imports": unusedImports,
    },
    rules: {
      // ---- React ----
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7 added compiler-aligned rules that are stricter
      // than what React 18 actually demands. Demote the ones we trip
      // intentionally to warnings — the patterns (one-time setState in
      // an effect, transient mutation while building a derived array)
      // are legitimate for our use cases. Keep the genuine bug-catchers
      // (exhaustive-deps, rules-of-hooks) at error.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // ---- Unused code ----
      // The base no-unused-vars duplicates unused-imports/no-unused-vars; we
      // run only the plugin version so auto-fix can drop dead imports too.
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],

      // ---- Imports ----
      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "type",
          ],
          "newlines-between": "never",
        },
      ],
      "import-x/no-cycle": ["error", { maxDepth: 10 }],
      // The parser walks the file imports; resolution warnings about CSS side
      // effects, Vite's url-import for the worker entry, and similar exotic
      // patterns are not bugs in our codebase.
      "import-x/no-unresolved": "off",
      "import-x/named": "off",
      "import-x/default": "off",
      "import-x/namespace": "off",

      // ---- TypeScript correctness ----
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],

      // ---- Strict rules dialled to "warn" or off where the project needs it ----

      // PDF parsing legitimately uses post-regex / post-narrowing `!`s where
      // TS cannot prove the captured group is defined. We police carelessness
      // by treating these as a nudge, not a blocker.
      "@typescript-eslint/no-non-null-assertion": "warn",

      // Project preference: `type` over `interface` everywhere. Both express
      // the same shape for our purposes; consolidating on `type` keeps the
      // mental model "all data is just a name for a shape" rather than two.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],

      // PDF dicts arrive untyped at the boundary; many "redundant" optional
      // chains are actually defensive across runtime drift between fixtures
      // and real files. Dial down to a warning.
      "@typescript-eslint/no-unnecessary-condition": "warn",

      // Spec-PDF parsing reads integers that may overflow inside packed wire
      // formats; restricting template-expression types is too noisy.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: false,
          allowAny: false,
          allowNever: false,
        },
      ],

      // Our parser code uses Array#sort with mutation deliberately on locally
      // owned arrays; the rule is too cautious for that pattern.
      "@typescript-eslint/require-array-sort-compare": "warn",

      // ---- General hygiene ----
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "no-implicit-coercion": "warn",
      "object-shorthand": ["error", "always"],
      "prefer-const": "error",
    },
  },

  // ---- UI must not import worker/pdf/** directly ----
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/worker/pdf/**", "../../worker/pdf/**"],
              message:
                "UI code must go through core/parser-session or shared/, never worker/pdf/** directly.",
            },
          ],
        },
      ],
    },
  },

  // ---- shared/ is the contract layer; no UI / worker / core / pdfjs imports ----
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ui/**", "**/worker/**", "**/core/**", "**/pdfjs/**"],
              message:
                "shared/ may only depend on other shared/ modules — it is the contract layer.",
            },
          ],
        },
      ],
    },
  },

  // ---- Tests: silence the noisy "type-checked" rules that don't help here ----
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/prefer-string-starts-ends-with": "off",
      "no-restricted-imports": "off",
    },
  },
);
