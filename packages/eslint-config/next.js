const { resolve } = require("node:path");

const project = resolve(process.cwd(), "tsconfig.json");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: [
    "eslint:recommended",
    "prettier",
    require.resolve("@vercel/style-guide/eslint/next"),
    "turbo",
  ],
  globals: {
    React: true,
    JSX: true,
  },
  env: {
    node: true,
    browser: true,
  },
  plugins: ["only-warn"],
  parserOptions: {
    // Enable type-aware rules for TypeScript where needed
    project,
  },
  settings: {
    "import/resolver": {
      typescript: {
        project,
      },
    },
  },
  ignorePatterns: [
    // Ignore dotfiles
    ".*.js",
    "node_modules/",
    ".next/",
    "out/",
    "dist/",
    "build/",
    "coverage/",
    ".turbo/",
    "next-env.d.ts",
  ],
  overrides: [
    { files: ["*.js?(x)", "*.ts?(x)"] },
    {
      // Next.js requires default exports for these App/Pages Router files
      files: [
        "app/**/page.*",
        "app/**/layout.*",
        "app/**/template.*",
        "app/**/error.*",
        "app/**/not-found.*",
        "pages/**/*.tsx",
        "pages/**/*.ts",
        "pages/**/*.jsx",
        "pages/**/*.js",
        "next.config.js",
        "next.config.mjs",
        "middleware.ts",
        "middleware.ts",
        "middleware.js",
        "middleware.mjs",
        "src/middleware.ts",
      ],
      rules: {
        "import/no-default-export": "off",
      },
    },
  ],
};
