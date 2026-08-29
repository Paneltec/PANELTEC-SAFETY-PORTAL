// Ephemeral flat-config just for the v58.13.64b no-undef sweep.
// NOT part of the normal build (which uses CRA's react-scripts eslint
// wired through webpack). Keeps our audit out of the app entrypoint.
import globals from "globals";
import reactPlugin from "eslint-plugin-react";
export default [
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        process: "readonly",
      },
    },
    plugins: { react: reactPlugin },
    rules: {
      "no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
    },
  },
];
