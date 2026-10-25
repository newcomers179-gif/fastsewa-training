const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

// "@/" and "@shared/" are resolved from tsconfig.json "paths" by Expo itself.
// Keep Metro out of the folders that are not part of the app (the API, the admin console, build output,
// ops files): fewer files to watch, and the app can never import server code by accident.
// "shared/" stays visible on purpose: the app and the API use the same validation rules.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blocked = ["server", "admin", "dist", "migrations", "nginx", "scripts", ".github"].map(
  (dir) => new RegExp(`^${escape(path.join(__dirname, dir))}[\\\\/].*`)
);
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...blocked];

module.exports = config;
