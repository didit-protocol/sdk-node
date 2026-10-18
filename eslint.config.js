// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "coverage/", "openapi/", "node_modules/"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js", "tests/smoke/*.mjs", "tests/smoke/*.cjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // Template literals with numbers and booleans are fine and common in this code.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      // An empty string counts as unset for options and environment variables.
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { string: true } },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The published package: no `any` anywhere, and no Node.js globals.
    files: ["src/**/*.ts"],
    languageOptions: { globals: { ...globals["shared-node-browser"] } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["node:*"], message: "The SDK only uses web platform APIs." }] },
      ],
    },
  },
  {
    // Generated code follows the spec's naming; the generator checks it.
    files: ["src/resources/**/*.ts", "src/types/**/*.ts", "tests/generated/**/*.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
    },
  },
  {
    files: ["tests/**/*.ts", "codegen/**/*.ts", "examples/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // A spec sync that renames or removes a method keeps the old name as deprecated
    // until its removal version, so the sync pull request must stay green while the
    // hand-written tests and examples still call it. The warning says what to move;
    // the type check fails once the name is gone.
    files: ["tests/**/*.ts", "examples/**/*.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "warn",
    },
  },
  {
    // The generated tests and the contract test call every method, including the
    // ones a spec sync keeps as deprecated until their removal version.
    files: ["tests/generated/**/*.ts", "tests/contract.test.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
