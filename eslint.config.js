import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const webGpuGlobals = {
  GPUBufferUsage: "readonly",
  GPUMapMode: "readonly",
  GPUShaderStage: "readonly",
  GPUTextureUsage: "readonly",
};

export default [
  {
    ignores: ["dist/**", "build/**", ".svelte-kit/**", "node_modules/**", "*.log"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "*.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...webGpuGlobals,
      },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.test.ts"],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
];
