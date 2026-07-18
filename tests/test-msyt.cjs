"use strict";

const { runExportTest } = require("./browser-test-utils.cjs");

runExportTest({
  testName: "msyt",
  sourceDescription: "msyt",
  accepts: (name) => /\.msyt$/i.test(name),
  targetMode: "msyt-yaml",
  targetExtension: ".msyt",
  allowedGames: ["BotW"],
  preserveSourceExtension: true,
  comparison: "text"
}).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
