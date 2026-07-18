"use strict";

const { runExportTest } = require("./browser-test-utils.cjs");

runExportTest({
  testName: "msyt-to-yaml",
  sourceDescription: "msyt",
  accepts: (name) => /\.msyt$/i.test(name),
  targetMode: "aeon-yaml",
  targetExtension: ".yaml",
  allowedGames: ["BotW"]
}).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
