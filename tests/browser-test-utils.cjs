"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");

const IMPORT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 5;
const FILE_COUNT = 50;
const BROWSER_SESSION_FILE_COUNT = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProgressLine(total) {
  const frames = ["|", "/", "-", "\\"];
  let timer = null;
  let previousLength = 0;

  const draw = (current, relativePath, frame) => {
    const line = `${frames[frame % frames.length]} ${current}/${total}: ${relativePath}`;
    process.stdout.write(`\r${line}${" ".repeat(Math.max(0, previousLength - line.length))}`);
    previousLength = line.length;
  };

  return {
    start(current, relativePath) {
      this.stop();
      let frame = 0;
      draw(current, relativePath, frame);
      timer = setInterval(() => {
        frame += 1;
        draw(current, relativePath, frame);
      }, 120);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (!previousLength) return;
      process.stdout.write(`\r${" ".repeat(previousLength)}\r`);
      previousLength = 0;
    }
  };
}

function findEdge() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA || "", "Microsoft\\Edge\\Application\\msedge.exe")
  ];
  const edgePath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!edgePath) throw new Error("Microsoft Edge was not found");
  return edgePath;
}

function findFiles(root, matches) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, item.name);
      if (item.isDirectory()) stack.push(fullPath);
      else if (item.isFile() && matches(item.name)) files.push(fullPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultOutputDirectory(sourceRoot, testName) {
  const resolved = path.resolve(sourceRoot);
  return path.join(path.dirname(resolved), `${path.basename(resolved)}-bubble-wrap-${testName}`);
}

function outputFilePath(outputRoot, sourceRoot, sourcePath, extension, preserveSourceExtension) {
  const relative = path.relative(sourceRoot, sourcePath);
  if (preserveSourceExtension) return path.join(outputRoot, relative);
  const parsed = path.parse(relative);
  return path.join(outputRoot, parsed.dir, `${parsed.name}${extension}`);
}

// For comparison.
function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function firstDifferentLine(expected, actual) {
  const expectedLines = normalizeNewlines(expected).split("\n");
  const actualLines = normalizeNewlines(actual).split("\n");
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index++) {
    if (expectedLines[index] !== actualLines[index]) {
      return { line: index + 1, expected: expectedLines[index] || "", actual: actualLines[index] || "" };
    }
  }
  return null;
}

// BCML may export object keys in another order without changing its data.
// Normalize only object keys before the round-trip comparison; array order remains meaningful.
function normalizeJsonForComparison(value) {
  if (Array.isArray(value)) return value.map(normalizeJsonForComparison);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeJsonForComparison(value[key])]));
  }
  return value;
}

function compareOutput(source, output, comparison) {
  if (!comparison) return null;
  if (comparison === "text") {
    return normalizeNewlines(source) === normalizeNewlines(output) ? null : firstDifferentLine(source, output);
  }
  if (comparison === "json") {
    return JSON.stringify(normalizeJsonForComparison(JSON.parse(source))) === JSON.stringify(normalizeJsonForComparison(JSON.parse(output))) ? null : { json: true };
  }
  throw new Error(`Unknown comparison: ${comparison}`);
}

async function waitForFile(filePath, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf8");
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

// Minimal Chrome DevTools Protocol client used to drive headless Edge during export tests.
class CdpSession {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message || "CDP error"));
      else request.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Page evaluation failed");
    return response.result?.value;
  }

  close() {
    try {
      this.socket?.close();
    } catch {}
  }
}

async function launchBrowser(projectRoot) {
  const profileDirectory = path.join(os.tmpdir(), `bubble-wrap-test-${process.pid}-${Date.now()}`);
  fs.mkdirSync(profileDirectory, { recursive: true });
  const browser = spawn(
    findEdge(),
    [
      "--headless=new",
      "--disable-gpu",
      "--allow-file-access-from-files",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profileDirectory}`,
      "--remote-debugging-port=0",
      "about:blank"
    ],
    { stdio: "ignore", windowsHide: true }
  );

  const portFile = path.join(profileDirectory, "DevToolsActivePort");
  const [portLine] = (await waitForFile(portFile, IMPORT_TIMEOUT_MS)).split(/\r?\n/);
  const port = Number(portLine);
  if (!port) throw new Error("Could not read the Edge DevTools port");
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, IMPORT_TIMEOUT_MS);
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("Could not find the Edge page target");

  const cdp = new CdpSession(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: pathToFileURL(path.join(projectRoot, "index.html")).href });
  await waitForPage(cdp, "typeof window.exportYaml === 'function'");
  await cdp.evaluate(`(() => {
    window.__bubbleWrapTest = { alertText: null, exportedText: null };
    window.alert = (message) => { window.__bubbleWrapTest.alertText = String(message); };
    navigator.clipboard.writeText = async (text) => { window.__bubbleWrapTest.exportedText = String(text); };
  })()`);
  return { browser, cdp, profileDirectory };
}

async function waitForPage(cdp, condition, timeoutMs = IMPORT_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await cdp.evaluate(`Boolean(${condition})`)) return;
    } catch {
      // Edge may briefly replace the execution context while index.html loads.
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for page condition: ${condition}`);
}

async function closeBrowser(session) {
  try {
    session.cdp.close();
  } finally {
    if (!session.browser.killed) session.browser.kill();
    await Promise.race([
      new Promise((resolve) => session.browser.once("exit", resolve)),
      sleep(5_000)
    ]);
    try {
      fs.rmSync(session.profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(`Warning: could not remove temporary Edge profile: ${session.profileDirectory}`);
      console.warn(error.message || String(error));
    }
  }
}


async function importText(cdp, fileName, text) {
  const expression = `((fileName, text) => (async () => {
    const state = window.__bubbleWrapTest;
    state.alertText = null;
    const input = document.getElementById("file-input");
    const status = document.getElementById("statusbar");
    status.textContent = "";
    const file = new File([text], fileName, { type: "text/plain" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const deadline = performance.now() + ${IMPORT_TIMEOUT_MS};
    while (performance.now() < deadline) {
      if (state.alertText || status.textContent.startsWith("Loaded")) break;
      await new Promise((resolve) => setTimeout(resolve, ${POLL_INTERVAL_MS}));
    }
    return {
      alertText: state.alertText,
      loaded: status.textContent.startsWith("Loaded"),
      statusText: status.textContent,
      chains: document.querySelectorAll(".chain").length
    };
  })())(${JSON.stringify(fileName)}, ${JSON.stringify(text)})`;
  const result = await cdp.evaluate(expression);
  if (!result.loaded && !result.alertText) throw new Error("Timed out while importing file");
  return result;
}

async function exportText(cdp, mode) {
  const expression = `(() => (async () => {
    const state = window.__bubbleWrapTest;
    state.alertText = null;
    state.exportedText = null;
    window.setExportMode(${JSON.stringify(mode)});
    window.exportYaml();
    const deadline = performance.now() + ${IMPORT_TIMEOUT_MS};
    while (performance.now() < deadline) {
      if (state.alertText || state.exportedText !== null) break;
      await new Promise((resolve) => setTimeout(resolve, ${POLL_INTERVAL_MS}));
    }
    return { alertText: state.alertText, exportedText: state.exportedText };
  })())()`;
  const result = await cdp.evaluate(expression);
  if (result.exportedText == null && !result.alertText) throw new Error("Timed out while exporting file");
  return result;
}

// Configure
async function configureGame(cdp, game) {
  await cdp.evaluate(`window.selectGame(${JSON.stringify(game)})`);
}
async function configureAutoSplit(cdp, enabled) {
  await cdp.evaluate(`(() => {
    const button = document.getElementById("btn-autosplit");
    const isEnabled = button.textContent.includes("ON");
    if (isEnabled !== ${Boolean(enabled)}) window.toggleAutoSplit();
  })()`);
}
async function configureImportSettings(cdp, options) {
  await cdp.evaluate(
    `window.setImportSettings(${JSON.stringify({
      disableSoftSplit: options.disableSoftSplit,
      bigEndian: options.bigEndian,
      hasATR1: options.hasATR1,
      trimEmpty: options.trimEmptyOnImport,
      fixDelaySpacing: options.fixDelaySpacingOnImport
    })})`
  );
}
async function configureBulkActions(cdp, options) {
  if (!options.forcePageBreaks && !options.collapseSoftSplits && !options.trimEmpty && !options.swapDelayFrames && !options.fixDelaySpacing) return;
  await cdp.evaluate(
    `window.applyBulkActions(${JSON.stringify({
      forcePageBreaks: options.forcePageBreaks,
      collapseSoftSplits: options.collapseSoftSplits,
      trimEmpty: options.trimEmpty,
      swapDelayFrames: options.swapDelayFrames,
      fixDelaySpacing: options.fixDelaySpacing
    })})`
  );
}

function parseArguments(testName, sourceDescription, allowedGames) {
  const positional = [];
  let game = "BotW";
  let autoSplit = false;
  let disableSoftSplit = false;
  let bigEndian = null;
  let hasATR1 = null;
  let forcePageBreaks = false;
  let collapseSoftSplits = false;
  let trimEmpty = false;
  let swapDelayFrames = false;
  let fixDelaySpacing = false;
  let trimEmptyOnImport = false;
  let fixDelaySpacingOnImport = false;
  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === "--game") {
      const value = String(process.argv[++index] || "").toLowerCase();
      if (value !== "botw" && value !== "totk") throw new Error("--game must be botw or totk");
      game = value === "totk" ? "TotK" : "BotW";
      continue;
    }
    if (argument === "--auto-split") {
      const value = String(process.argv[++index] || "").toLowerCase();
      if (value !== "on" && value !== "off") throw new Error("--auto-split must be on or off");
      autoSplit = value === "on";
      continue;
    }
    if (argument === "--disable-soft-split") {
      const value = String(process.argv[++index] || "").toLowerCase();
      if (value !== "on" && value !== "off") throw new Error("--disable-soft-split must be on or off");
      disableSoftSplit = value === "on";
      continue;
    }
    if (argument === "--big-endian") {
      const value = String(process.argv[++index] || "").toLowerCase();
      if (value !== "true" && value !== "false") throw new Error("--big-endian must be true or false");
      bigEndian = value === "true";
      continue;
    }
    if (argument === "--has-atr1") {
      const value = String(process.argv[++index] || "").toLowerCase();
      if (value !== "true" && value !== "false") throw new Error("--has-atr1 must be true or false");
      hasATR1 = value === "true";
      continue;
    }
    if (argument === "--trim-empty-on-import") {
      const value = String(process.argv[++index] || "").toLowerCase();
      if (value !== "true" && value !== "false") throw new Error("--trim-empty-on-import must be true or false");
      trimEmptyOnImport = value === "true";
      continue;
    }
    if (argument === "--fix-delay-spacing-on-import") {
      const value = String(process.argv[++index] || "").toLowerCase();
      if (value !== "true" && value !== "false") throw new Error("--fix-delay-spacing-on-import must be true or false");
      fixDelaySpacingOnImport = value === "true";
      continue;
    }
    if (argument === "--force-page-breaks") {
      forcePageBreaks = true;
      continue;
    }
    if (argument === "--collapse-soft-splits") {
      collapseSoftSplits = true;
      continue;
    }
    if (argument === "--trim-empty") {
      trimEmpty = true;
      continue;
    }
    if (argument === "--swap-delay-frames") {
      swapDelayFrames = true;
      continue;
    }
    if (argument === "--fix-delay-spacing") {
      fixDelaySpacing = true;
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    positional.push(argument);
  }
  const sourceRootArg = positional[0];
  if (!sourceRootArg) {
    console.error(`Usage: node tests/test-${testName}.cjs <${sourceDescription}-folder> [output-folder] [--game botw|totk] [--auto-split on|off] [--disable-soft-split on|off] [--big-endian true|false] [--has-atr1 true|false] [--trim-empty-on-import true|false] [--fix-delay-spacing-on-import true|false] [--force-page-breaks] [--collapse-soft-splits] [--trim-empty] [--swap-delay-frames] [--fix-delay-spacing]`);
    process.exitCode = 1;
    return null;
  }
  if (positional.length > 2) throw new Error("Only an input folder and an optional output folder are allowed");
  if (!allowedGames.includes(game)) throw new Error(`${testName} supports only: ${allowedGames.join(", ")}`);
  return { sourceRootArg, outputRootArg: positional[1], game, autoSplit, disableSoftSplit, bigEndian, hasATR1, trimEmptyOnImport, fixDelaySpacingOnImport, forcePageBreaks, collapseSoftSplits, trimEmpty, swapDelayFrames, fixDelaySpacing };
}


async function runExportTest({ testName, sourceDescription, accepts, targetMode, targetExtension, allowedGames = ["BotW", "TotK"], preserveSourceExtension = false, comparison = null }) {
  const options = parseArguments(testName, sourceDescription, allowedGames);
  if (!options) return;

  const sourceRoot = path.resolve(options.sourceRootArg);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`Input folder does not exist: ${sourceRoot}`);
  }
  const outputRoot = path.resolve(options.outputRootArg || defaultOutputDirectory(sourceRoot, testName));
  const sourceFiles = findFiles(sourceRoot, accepts);
  const report = {
    testName,
    sourceRoot,
    outputRoot,
    game: options.game,
    autoSplit: options.autoSplit,
    disableSoftSplit: options.disableSoftSplit,
    bigEndian: options.bigEndian,
    hasATR1: options.hasATR1,
    trimEmptyOnImport: options.trimEmptyOnImport,
    fixDelaySpacingOnImport: options.fixDelaySpacingOnImport,
    forcePageBreaks: options.forcePageBreaks,
    collapseSoftSplits: options.collapseSoftSplits,
    trimEmpty: options.trimEmpty,
    swapDelayFrames: options.swapDelayFrames,
    fixDelaySpacing: options.fixDelaySpacing,
    processed: [],
    differences: [],
    failures: []
  };
  fs.mkdirSync(outputRoot, { recursive: true });

  console.log(`Input : ${sourceRoot}`);
  console.log(`Output: ${outputRoot}`);
  console.log(`Found : ${sourceFiles.length} file(s)`);
  console.log(`Game  : ${options.game}`);
  console.log(`Auto-split: ${options.autoSplit ? "on" : "off"}`);
  console.log(`Disable soft split: ${options.disableSoftSplit ? "on" : "off"}`);
  console.log(`Force bigEndian: ${options.bigEndian == null ? "off" : options.bigEndian}`);
  console.log(`Force hasATR1: ${options.hasATR1 == null ? "off" : options.hasATR1}`);
  console.log(`Trim empty on import: ${options.trimEmptyOnImport}`);
  console.log(`Fix delay spacing on import: ${options.fixDelaySpacingOnImport}`);
  console.log(`Bulk actions: page breaks ${options.forcePageBreaks ? "on" : "off"}; collapse ${options.collapseSoftSplits ? "on" : "off"}; trim ${options.trimEmpty ? "on" : "off"}; swap delay ${options.swapDelayFrames ? "on" : "off"}; delay spacing ${options.fixDelaySpacing ? "on" : "off"}`);
  const progressLine = createProgressLine(sourceFiles.length);
  let session = null;
  try {
    for (let index = 0; index < sourceFiles.length; index++) {
      if (index % BROWSER_SESSION_FILE_COUNT === 0) {
        if (session) {
          await closeBrowser(session);
          session = null;
        }
        session = await launchBrowser(path.resolve(__dirname, ".."));
        await configureAutoSplit(session.cdp, options.autoSplit);
        await configureImportSettings(session.cdp, options);
      }
      const sourcePath = sourceFiles[index];
      const relativePath = path.relative(sourceRoot, sourcePath);
      const fileName = `__bubble_wrap_test_${index}__${path.basename(sourcePath)}`;
      progressLine.start(index + 1, relativePath);
      try {
        const sourceText = fs.readFileSync(sourcePath, "utf8");
        const imported = await importText(session.cdp, fileName, sourceText);
        if (imported.alertText) throw new Error(`Import: ${imported.alertText}`);
        await configureBulkActions(session.cdp, options);
        await configureGame(session.cdp, options.game);
        const exported = await exportText(session.cdp, targetMode);
        if (exported.alertText) throw new Error(`Export: ${exported.alertText}`);
        const resultPath = outputFilePath(outputRoot, sourceRoot, sourcePath, targetExtension, preserveSourceExtension);
        ensureDirectory(resultPath);
        fs.writeFileSync(resultPath, exported.exportedText, "utf8");
        report.processed.push({ source: relativePath, output: path.relative(outputRoot, resultPath), chains: imported.chains });
        const difference = compareOutput(sourceText, exported.exportedText, comparison);
        if (difference) {
          report.differences.push({ source: relativePath, output: path.relative(outputRoot, resultPath), difference });
          console.error(`Different: ${relativePath}`);
        }
      } catch (error) {
        report.failures.push({ source: relativePath, error: error.message || String(error) });
        console.error(` Failed: ${relativePath}`);
        console.error(`  ${error.message || String(error)}`);
      } finally {
        progressLine.stop();
      }
      const current = index + 1;
      if (current === 1 || current === sourceFiles.length || current % FILE_COUNT === 0) {
        console.log(`Progress: ${current}/${sourceFiles.length}; differences: ${report.differences.length}; failures: ${report.failures.length}`);
      }
    }
  } finally {
    progressLine.stop();
    if (session) await closeBrowser(session);
  }

  fs.writeFileSync(path.join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Saved: ${outputRoot}`);
  console.log(`Different: ${report.differences.length}`);
  console.log(`Failed: ${report.failures.length}`);
  if (report.failures.length) {
    console.log("Failures:");
    report.failures.forEach((failure) => console.log(`- ${failure.source}: ${failure.error}`));
  }
  if (report.differences.length || report.failures.length) process.exitCode = 2;
}

module.exports = {
  runExportTest,
  launchBrowser,
  closeBrowser,
  waitForPage,
  importText,
  exportText,
  configureGame,
  configureAutoSplit,
  configureImportSettings,
  configureBulkActions
};
