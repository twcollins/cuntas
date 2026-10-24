import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/generated.ts", "apps/web/dev-dist/**", "**/playwright-report/**", "apps/web/android/**", "apps/web/ios/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs", "**/scripts/**", "apps/api/**", "apps/worker/**"],
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly", setTimeout: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Tax figures live in rules/**/*.yaml. Calculators may only use 0, 1 and 100 as literals.
    files: ["packages/rules/src/calculators/**/*.ts"],
    rules: {
      "@typescript-eslint/no-magic-numbers": [
        "error",
        { ignore: [0, 1, 100, -1], ignoreArrayIndexes: true, ignoreDefaultValues: false, ignoreEnums: true, ignoreTypeIndexes: true },
      ],
      "no-magic-numbers": "off",
    },
  },
);
