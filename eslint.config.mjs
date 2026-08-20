import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

// ESLint 9 flat config. `next lint` is deprecated and prompts for setup when no
// config exists — which hangs CI — so the config lives here explicitly and CI
// calls the ESLint CLI directly.
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    ignores: [
      ".next/**",
      // 本番ビルドの出力（next.config.mjs の distDir を参照）。生成物なので見ない。
      ".next-build/**",
      "node_modules/**",
      "prisma/generated/**",
      "next-env.d.ts",
      "**/*.db",
      // 使い捨ての検証用テスト（tests/_… ）。
      "tests/_*.test.ts",
      "tests/_*.test.tsx",
      // Throwaway E2E / probe scripts run against a live dev server.
      "_*.mjs",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Prisma's Json columns legitimately surface as `any` at the boundary;
      // we cast them at the edge instead of failing the build.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
