const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...expoConfig,
  {
    // Build output and tool folders are not our code; root-level *.js are tool configs (babel, metro, …).
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", ".expo/**", "*.js"],
  },
]);
