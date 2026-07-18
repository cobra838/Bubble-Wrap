"use strict";

const { runExportTest } = require("./browser-test-utils.cjs");

runExportTest({
  testName: "yaml-to-msyt",
  sourceDescription: "yaml",
  accepts: (name) => /\.ya?ml$/i.test(name),
  targetMode: "msyt-yaml",
  targetExtension: ".msyt",
  allowedGames: ["BotW"]
}).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
