// The "@/" and "@shared/" import aliases come from tsconfig.json "paths"; Expo's Metro reads them from there,
// so no resolver plugin is needed (and none is installed).
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
