"use strict";

const { runExportTest } = require("./browser-test-utils.cjs");

runExportTest({
  testName: "yaml",
  sourceDescription: "yaml",
  accepts: (name) => /\.ya?ml$/i.test(name),
  targetMode: "aeon-yaml",
  targetExtension: ".yaml",
  allowedGames: ["BotW", "TotK"],
  preserveSourceExtension: true,
  comparison: "text"
}).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
