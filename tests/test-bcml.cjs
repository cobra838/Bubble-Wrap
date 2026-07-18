"use strict";

const { runExportTest } = require("./browser-test-utils.cjs");

runExportTest({
  testName: "bcml",
  sourceDescription: "bcml",
  accepts: (name) => /\.json$/i.test(name),
  targetMode: "msyt-bcml",
  targetExtension: ".json",
  allowedGames: ["BotW"],
  preserveSourceExtension: true,
  comparison: "json"
}).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
