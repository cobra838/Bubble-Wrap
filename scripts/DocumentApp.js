import BubbleType from "./enums/BubbleType.js";
import {
  contentToPlainText,
  ensureEditableStructure,
  parseRawTags,
  rawToPlainText,
  renderRawToContent,
  serializeContent,
  setRawContentGame,
  spliceVisibleRange,
  tagSummary,
  visibleOffsetToRaw
} from "./RawContent.js";
import { buildMsytBcmlJson, buildMsytYaml, isTagMappedToMsyt, parseMsytBcmlJson, parseMsytYaml } from "./MSYTFormat.js";
import { getColorChoices, getColorCss, getTags, setGcfText } from "./GcfRegistry.js";
import { canAutoSplitDocument, separatorForBubbleBoundary, splitRawAtLineLimit } from "./SplitPolicy.js";
import ImportSettings from "./ImportSettings.js";
import BulkActions from "./BulkActions.js";

const STORAGE_GAME_KEY = "bubble_wrap_game";
const DOC_MODE_AEON = "aeon-yaml";
const DOC_MODE_MSYT = "msyt-yaml";
const DOC_MODE_BCML = "msyt-bcml";

// Escape text for safe HTML insertion.
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Normalize all newline variants to \n.
function normalizeNewlines(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Parse an inline {{tag ...}} into name/args/order.
function parseInlineTag(rawTag) {
  const body = String(rawTag || "").slice(2, -2).trim();
  const spaceIndex = body.indexOf(" ");
  const name = spaceIndex === -1 ? body : body.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? "" : body.slice(spaceIndex + 1);
  const args = {};
  const order = [];
  for (const match of rest.matchAll(/([A-Za-z0-9_]+)="([^"]*)"/g)) {
    order.push(match[1]);
    args[match[1]] = match[2];
  }
  return { name, args, order };
}

// Build an inline {{tag ...}} string from args.
function buildInlineTag(name, args = {}, order = []) {
  const keys = order.length ? order : Object.keys(args);
  const parts = [name];
  keys.forEach((key) => {
    if (args[key] == null) return;
    parts.push(`${key}="${String(args[key]).replaceAll('"', "&quot;")}"`);
  });
  return `{{${parts.join(" ")}}}`;
}

// Pick a stable chip color for a tag name.
function tagColor(name) {
  const map = {
    animation: "hsl(60,75%,60%)",
    autoAdvance: "hsl(30,75%,60%)",
    choice2: "hsl(250,75%,60%)",
    choice3: "hsl(270,75%,60%)",
    choice4: "hsl(290,75%,60%)",
    choiceByFlags: "hsl(310,75%,60%)",
    delay8: "hsl(320,75%,60%)",
    delay15: "hsl(340,75%,60%)",
    delay30: "hsl(355,75%,60%)",
    font: "hsl(120,75%,60%)",
    icon: "hsl(210,75%,60%)",
    playSound: "hsl(230,75%,60%)",
    setEmotion: "hsl(0,75%,60%)",
    setEmotion2: "hsl(20,75%,60%)",
    setVoice: "hsl(40,75%,60%)",
    singleChoice: "hsl(330,75%,60%)",
    textSpeed: "hsl(50,75%,60%)"
  };
  if (map[name]) return map[name];
  let hash = 5381;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360},70%,58%)`;
}

// Guess the default bubble type from a BCML file path.
function inferBcmlBubbleTypeFromPath(path) {
  const value = String(path || "").replaceAll("\\", "/");
  if (/(^|\/)ActorType\//.test(value)) return "item";
  if (/(^|\/)QuestMsg\//.test(value)) return "questBOTW";
  if (/(^|\/)Tips\//.test(value)) return "tip";
  return "dialogue";
}

// Detect choice labels like 1, 2, 0003.
function isChoiceLabel(label) {
  return /^\d+$/.test(String(label || "").trim());
}

// Create a new empty entry for the current mode.
function defaultEntry(mode = DOC_MODE_AEON, msytDocInfo = {}) {
  const isMsyt = mode === DOC_MODE_BCML || mode === DOC_MODE_MSYT;
  const isBcml = mode === DOC_MODE_BCML;
  const bcmlPath = msytDocInfo.bcmlDefaultPath;
  return {
    label: "",
    attrKey: isMsyt ? "attributes" : "attribute",
    attrVal: "",
    content: "",
    bubbleType: isBcml ? inferBcmlBubbleTypeFromPath(bcmlPath) : "dialogue",
    ...(isBcml ? { bcmlLocale: msytDocInfo.bcmlDefaultLocale, bcmlPath } : {}),
    msytHasAttributes: isMsyt
  };
}

// Split raw text into pages by pageBreak tags.
function splitPages(raw) {
  const value = String(raw || "");
  return value ? value.split("{{pageBreak}}") : [""];
}

// Parse the simple AEON YAML entry format used here.
function parseAeonYaml(text) {
  const normalized = normalizeNewlines(text);
  const mm = normalized.match(/^%%%\n[\s\S]*?%%%\n/);
  const yamlMeta = mm ? mm[0] : "";
  const rest = mm ? normalized.slice(mm[0].length) : normalized;
  const entries = [];
  for (const match of rest.matchAll(/---\nlabel: (.*?)\n(?:(attributeText|attribute): (.*?)\n)?---\n([\s\S]*?)(?=\n---\n|$)/g)) {
    let content = match[4];
    if (content.endsWith("\n")) content = content.slice(0, -1);
    entries.push({
      label: match[1].trim(),
      attrKey: match[2] || "attributeText",
      attrVal: match[3] != null ? match[3].trim() : "",
      content,
      bubbleType: "dialogue"
    });
  }
  return { entries, yamlMeta };
}

// Parse a document only for comparison; it must not change the active editor state.
function parseCompareDocument(text) {
  const normalized = normalizeNewlines(text);
  const trimmed = normalized.trimStart();
  if (!trimmed) return { entries: [] };
  if (trimmed.startsWith("{")) return parseMsytBcmlJson(normalized);
  if (/^(?:---\n)?(?:\s*group_count:|\s*entries:)/m.test(trimmed)) return parseMsytYaml(normalized);
  return parseAeonYaml(normalized);
}

// Normalize one entry's raw string before comparing source files.
function compareEntryRaw(entry) {
  return normalizeNewlines(entry?.content ?? "");
}

// Provide a safe default status text.
function makeStatus(text) {
  return text || "Ready";
}

// Show MSYT meta as readable JSON text.
function stringifyMsytMeta(meta) {
  if (!meta || typeof meta !== "object") return "";
  return `${JSON.stringify(meta, null, 2)}\n`;
}

// Map AEON labelGroups to msyt group_count.
function getAeonLabelGroups(yamlMeta) {
  const match = String(yamlMeta || "").match(/(?:^|\n)labelGroups:\s*(-?\d+)\s*(?:\n|$)/);
  const value = Number(match?.[1] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

// Read group_count from msyt meta safely.
function getMsytGroupCount(msytMeta) {
  const value = Number(msytMeta?.group_count ?? 0);
  return Number.isFinite(value) ? value : 0;
}

// Read one boolean from an AEON metadata block.
function getAeonMetaBoolean(meta, key, fallback) {
  const match = String(meta || "").match(new RegExp(`^${key}:\\s*(true|false)\\s*$`, "m"));
  return match ? match[1] === "true" : fallback;
}

// Read one integer from an AEON metadata block.
function getAeonMetaInteger(meta, key, fallback) {
  const match = String(meta || "").match(new RegExp(`^${key}:\\s*(-?\\d+)\\s*$`, "m"));
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : fallback;
}

// MSYT has ATR1 when at least one entry has an attributes field, including attributes: "".
function msytHasATR1(chains) {
  return (chains || []).some((chain) => chain.msytHasAttributes || String(chain.attrVal || "") !== "");
}

// Build the editable AEON-style metadata shown for an imported MSYT document.
function buildAeonMetaFromMsyt(msytMeta, chains, bigEndian = true) {
  return [
    "%%%",
    `bigEndian: ${bigEndian ? "true" : "false"}`,
    "bigEndianLabels: false",
    "version: 3",
    "encoding: utf-16",
    "hasNLI1: false",
    "hasLBL1: true",
    `labelGroups: ${getMsytGroupCount(msytMeta)}`,
    `hasATR1: ${msytHasATR1(chains) ? "true" : "false"}`,
    "hasATO1: false",
    "hasTSY1: false",
    "hasTXTW: false",
    "%%%",
    ""
  ].join("\n");
}

// Convert editable AEON-style metadata back to the MSYT metadata that exists.
function buildMsytMetaFromAeonMeta(msytMeta, aeonMeta, chains) {
  const hasAttributes = getAeonMetaBoolean(aeonMeta, "hasATR1", msytHasATR1(chains));
  const exportChains = chains.map((chain) => ({
    ...chain,
    attrVal: hasAttributes ? chain.attrVal : "",
    msytHasAttributes: hasAttributes
  }));
  const atr1Unknown = hasAttributes ? exportChains.filter((chain) => String(chain.attrVal || "") === "").length : 0;
  return {
    chains: exportChains,
    msytMeta: {
      ...(msytMeta && typeof msytMeta === "object" ? msytMeta : {}),
      group_count: getAeonMetaInteger(aeonMeta, "labelGroups", getMsytGroupCount(msytMeta)),
      atr1_unknown: atr1Unknown
    }
  };
}

// Read the AEON bigEndian metadata value; absent means false.
function hasBigEndian(yamlMeta) {
  return /bigEndian:\s*true/.test(String(yamlMeta || ""));
}

// Decide whether AEON export should include attributeText/attribute.
function hasATR1(currentGame, yamlMeta) {
  if (currentGame === "TotK") return false;
  return !/hasATR1:\s*false/.test(String(yamlMeta || ""));
}

// AEON/MSYT attribute mode depends on whether any entry has non-empty attribute text.
function getAeonAttributeKey(chains, currentDocMode) {
  const list = Array.isArray(chains) ? chains : [];
  return list.some((chain) => String(chain?.attrVal || "").trim() !== "") ? "attributeText" : "attribute";
}

// Measure range text after removing hidden raw-tag nodes.
function getTextLengthExcludingTagNodes(range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll?.("[data-raw-tag]").forEach((node) => node.remove());
  return fragment.textContent.length;
}

// Count visible text length for a node tree.
function getVisibleTextLength(node) {
  if (!node) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.length;
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  if (node.classList?.contains("line-tail-marker")) return 0;
  if (node.dataset?.rawTag !== undefined) return 0;
  if (node.tagName === "BR") return 0;
  let total = 0;
  for (const child of node.childNodes) total += getVisibleTextLength(child);
  return total;
}

// Find a visible-text offset inside a node subtree.
function getVisibleOffsetWithinNode(node, targetNode, targetOffset) {
  let total = 0;
  let found = false;

  const walk = (current) => {
    if (found || !current) return;
    if (current === targetNode) {
      if (current.nodeType === Node.TEXT_NODE) {
        total += Math.min(targetOffset, current.textContent.length);
      } else if (current.nodeType === Node.ELEMENT_NODE) {
        if (current.classList?.contains("line-tail-marker")) {
          return;
        }
        if (current.dataset?.rawTag !== undefined) {
          return;
        }
        if (current.tagName === "BR") {
          found = true;
        } else {
          for (let i = 0; i < Math.min(targetOffset, current.childNodes.length); i++) {
            total += getVisibleTextLength(current.childNodes[i]);
          }
        }
      }
      found = true;
      return;
    }

    if (current.nodeType === Node.TEXT_NODE) {
      total += current.textContent.length;
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    if (current.classList?.contains("line-tail-marker")) return;
    if (current.dataset?.rawTag !== undefined) return;
    if (current.tagName === "BR") {
      return;
    }

    for (const child of current.childNodes) {
      walk(child);
      if (found) return;
    }
  };

  walk(node);
  return found ? total : null;
}

function getSelectionTextOffsets(content, range) {
  // Translate DOM selection into visible-text offsets, ignoring hidden tag markers.
  const offsetFromPoint = (targetNode, targetOffset) => {
    if (targetNode === content) {
      let total = 0;
      let sawBlock = false;
      for (let i = 0; i < Math.min(targetOffset, content.childNodes.length); i++) {
        const child = content.childNodes[i];
        const isBlock = child.nodeType === Node.ELEMENT_NODE && (child.tagName === "DIV" || child.tagName === "P");
        if (isBlock) {
          if (sawBlock) total += 1;
          total += getVisibleTextLength(child);
          sawBlock = true;
        } else {
          total += getVisibleTextLength(child);
        }
      }
      return total;
    }

    let total = 0;
    let sawBlock = false;
    for (const child of content.childNodes) {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && (child.tagName === "DIV" || child.tagName === "P");
      const local = getVisibleOffsetWithinNode(child, targetNode, targetOffset);
      if (local != null) {
        if (isBlock && sawBlock) total += 1;
        return total + local;
      }
      if (isBlock) {
        if (sawBlock) total += 1;
        total += getVisibleTextLength(child);
        sawBlock = true;
      } else {
        total += getVisibleTextLength(child);
      }
    }
    return total;
  };

  const startOff = offsetFromPoint(range.startContainer, range.startOffset);
  const endOff = offsetFromPoint(range.endContainer, range.endOffset);
  return { startOff, endOff };
}

function getBoundaryTag(raw, offset, dir) {
  // Find a tag that sits exactly on the caret boundary for Backspace/Delete.
  const rawBefore = visibleOffsetToRaw(raw, offset, "before");
  const rawAfter = visibleOffsetToRaw(raw, offset, "after");
  if (rawBefore === rawAfter) return null;
  const tags = parseRawTags(raw).filter((tag) => tag.start >= rawBefore && tag.end <= rawAfter);
  if (!tags.length) return null;
  return dir < 0 ? tags[tags.length - 1] : tags[0];
}

// Ignore reset-format tags in destructive delete logic.
function isProtectedDeleteTag(tag) {
  if (!tag) return false;
  if (tag.name === "color") return tag.args.id === "Default" || tag.args.id === "-1";
  if (tag.name === "size") return tag.args.value === "100";
  return false;
}

// Detect non-reset format tags that own a matching reset.
function isFormatStartTag(tag) {
  return !!tag && (tag.name === "color" || tag.name === "size") && !isProtectedDeleteTag(tag);
}

// Find the matching reset tag for a format-start tag.
function findPairedFormatResetTag(raw, startTag) {
  if (!isFormatStartTag(startTag)) return null;
  const tags = parseRawTags(raw);
  let depth = 0;
  let seenStart = false;
  for (const tag of tags) {
    if (tag.start === startTag.start && tag.end === startTag.end) {
      seenStart = true;
      depth = 1;
      continue;
    }
    if (!seenStart || tag.name !== startTag.name) continue;
    if (isFormatStartTag(tag)) {
      depth++;
      continue;
    }
    if (isProtectedDeleteTag(tag)) {
      depth--;
      if (depth === 0) return tag;
    }
  }
  return null;
}

// Remove a boundary tag and its paired reset when needed.
function removeTagAndPairedReset(raw, tag) {
  // Deleting a format-start tag should also remove its matching reset tag.
  if (!tag) return raw;
  const out = raw.slice(0, tag.start) + raw.slice(tag.end);
  const pair = findPairedFormatResetTag(raw, tag);
  if (!pair) return out;
  const shift = tag.end - tag.start;
  const adjStart = pair.start > tag.start ? pair.start - shift : pair.start;
  const adjEnd = pair.end > tag.start ? pair.end - shift : pair.end;
  return out.slice(0, adjStart) + out.slice(adjEnd);
}

const FORMAT_DEFS = {
  // Shared emit/parse rules for inline formatting tags.
  color: {
    tagName: "color",
    extract: (inner) => {
      const match = inner.match(/id="([^"]*)"/);
      return match ? match[1] : "Default";
    },
    isReset: (value) => value === "Default" || value === "-1",
    emitTag: (value) => (value == null ? '{{color id="Default"}}' : `{{color id="${value}"}}`)
  },
  size: {
    tagName: "size",
    extract: (inner) => {
      const match = inner.match(/value="([^"]*)"/);
      return match ? match[1] : "100";
    },
    isReset: (value) => value === "100",
    emitTag: (value) => (value == null ? '{{size value="100"}}' : `{{size value="${value}"}}`)
  }
};

// Collect active format runs across visible text.
function getFormatRuns(raw, type) {
  const def = FORMAT_DEFS[type];
  const runs = [];
  let curFmt = null;
  let runStart = null;
  let last = 0;
  let textPos = 0;
  for (const match of String(raw || "").matchAll(/\{\{([^}]*)\}\}/g)) {
    const before = raw.slice(last, match.index);
    if (before.length) {
      if (curFmt !== null && runStart === null) runStart = textPos;
      textPos += before.length;
    }
    last = match.index + match[0].length;
    const inner = match[1].trim();
    const name = inner.split(" ")[0];
    if (name !== def.tagName) continue;
    const rawValue = def.extract(inner);
    const nextFmt = def.isReset(rawValue) ? null : rawValue;
    if (curFmt !== nextFmt) {
      if (curFmt !== null && runStart !== null && textPos > runStart) {
        runs.push({ start: runStart, end: textPos, value: curFmt });
      }
      curFmt = nextFmt;
      runStart = nextFmt !== null ? textPos : null;
    }
  }
  const remaining = raw.slice(last);
  if (remaining.length) {
    if (curFmt !== null && runStart === null) runStart = textPos;
    textPos += remaining.length;
  }
  if (curFmt !== null && runStart !== null && textPos > runStart) {
    runs.push({ start: runStart, end: textPos, value: curFmt });
  }
  return runs;
}

// Drop empty color/size tag pairs left after edits.
function stripEmptyFormatPairs(raw) {
  let next = String(raw || "");
  let prev = "";
  while (next !== prev) {
    prev = next;
    next = next
      .replace(/\{\{color\b[^}]*\}\}\{\{color id="Default"\}\}/g, "")
      .replace(/\{\{size\b[^}]*\}\}\{\{size value="100"\}\}/g, "");
  }
  return next;
}

// Apply color/size formatting to a visible-text range.
function applyFormatToRange(raw, startOff, endOff, type, value) {
  if (startOff < 0 || endOff < 0 || startOff >= endOff) return raw;
  const def = FORMAT_DEFS[type];
  const atoms = [];
  let curFmt = null;
  let last = 0;
  let textPos = 0;
  for (const match of String(raw || "").matchAll(/\{\{([^}]*)\}\}/g)) {
    const before = raw.slice(last, match.index);
    last = match.index + match[0].length;
    if (before) {
      atoms.push({ type: "text", value: before, fmt: curFmt, pos: textPos });
      textPos += before.length;
    }
    const inner = match[1].trim();
    const name = inner.split(" ")[0];
    if (name === def.tagName) {
      const v = def.extract(inner);
      curFmt = def.isReset(v) ? null : v;
    } else {
      atoms.push({ type: "tag", value: match[0] });
    }
  }
  const remaining = raw.slice(last);
  if (remaining) atoms.push({ type: "text", value: remaining, fmt: curFmt, pos: textPos });

  const newAtoms = [];
  for (const atom of atoms) {
    if (atom.type === "tag") {
      newAtoms.push(atom);
      continue;
    }
    const len = atom.value.length;
    const s = startOff - atom.pos;
    const e = endOff - atom.pos;
    if (e <= 0 || s >= len) {
      newAtoms.push({ type: "text", value: atom.value, fmt: atom.fmt });
      continue;
    }
    if (s > 0) newAtoms.push({ type: "text", value: atom.value.slice(0, s), fmt: atom.fmt });
    const selStart = Math.max(s, 0);
    const selEnd = Math.min(e, len);
    newAtoms.push({ type: "text", value: atom.value.slice(selStart, selEnd), fmt: value });
    if (e < len) newAtoms.push({ type: "text", value: atom.value.slice(e), fmt: atom.fmt });
  }

  let out = "";
  let emitFmt = null;
  for (const atom of newAtoms) {
    if (atom.type === "tag") {
      out += atom.value;
      continue;
    }
    if (!atom.value) continue;
    if (atom.fmt !== emitFmt) {
      out += def.emitTag(atom.fmt);
      emitFmt = atom.fmt;
    }
    out += atom.value;
  }
  if (emitFmt !== null) out += def.emitTag(null);
  return out;
}

function normalizeLeadingFormatDeletion(oldRaw, nextRaw, edit, startOff, oldEndOff, newEndOff) {
  // Prevent leading format tags from sticking to text after destructive edits.
  if (edit && ["deleteContentBackward", "deleteContentForward", "deleteByCut"].includes(edit.inputType)) {
    for (const type of ["color", "size"]) {
      const run = getFormatRuns(oldRaw, type).find((item) => item.start === edit.start && item.end > edit.start);
      if (!run) continue;
      const removed = Math.max(0, Math.min(edit.end, run.end) - edit.start);
      if (removed <= 0) continue;
      const nextRunEnd = edit.start + Math.max(0, run.end - edit.end);
      if (nextRunEnd > edit.start) nextRaw = applyFormatToRange(nextRaw, edit.start, nextRunEnd, type, null);
    }
    return stripEmptyFormatPairs(nextRaw);
  }
  if (newEndOff !== startOff) return stripEmptyFormatPairs(nextRaw);
  for (const type of ["color", "size"]) {
    const run = getFormatRuns(oldRaw, type).find((item) => item.start === startOff && item.end > startOff);
    if (!run) continue;
    const nextRunEnd = startOff + Math.max(0, run.end - oldEndOff);
    if (nextRunEnd > startOff) nextRaw = applyFormatToRange(nextRaw, startOff, nextRunEnd, type, null);
  }
  return stripEmptyFormatPairs(nextRaw);
}

// Hidden raw tags live in the DOM as marker elements with no visible text width.
function isRawTagNode(node) {
  return node?.nodeType === Node.ELEMENT_NODE && node.dataset?.rawTag != null;
}

// Walk to the first/last concrete leaf so boundary checks can see neighboring text/tag nodes.
function edgeLeaf(node, dir) {
  let current = node;
  while (current?.nodeType === Node.ELEMENT_NODE && current.childNodes.length) {
    current = dir < 0 ? current.lastChild : current.firstChild;
  }
  return current;
}

// Find the nearest DOM leaf immediately before/after a selection boundary.
function boundaryNeighbor(content, node, offset, dir) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const len = node.textContent?.length || 0;
    if ((dir < 0 && offset > 0) || (dir > 0 && offset < len)) return null;
    const sibling = dir < 0 ? node.previousSibling : node.nextSibling;
    if (sibling) return edgeLeaf(sibling, dir);
    const parent = node.parentNode;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, node);
    if (index < 0) return null;
    return boundaryNeighbor(content, parent, dir < 0 ? index : index + 1, dir);
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const kids = node.childNodes;
    if (dir < 0 && offset > 0) return edgeLeaf(kids[offset - 1], dir);
    if (dir > 0 && offset < kids.length) return edgeLeaf(kids[offset], dir);
    if (node === content) return null;
    const parent = node.parentNode;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, node);
    if (index < 0) return null;
    return boundaryNeighbor(content, parent, dir < 0 ? index : index + 1, dir);
  }
  return null;
}

// Work out whether a collapsed caret semantically sits before or after a hidden tag boundary.
function inferCollapsedCaretBias(content, range, fallback = "after") {
  const beforeNode = boundaryNeighbor(content, range.startContainer, range.startOffset, -1);
  const afterNode = boundaryNeighbor(content, range.startContainer, range.startOffset, 1);
  if (isRawTagNode(beforeNode) && !isRawTagNode(afterNode)) return "after";
  if (isRawTagNode(afterNode) && !isRawTagNode(beforeNode)) return "before";
  return fallback;
}

function capturePendingInputEdit(content, inputType) {
  // Snapshot the intended visible-text edit before contenteditable mutates the DOM.
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) {
    content._pendingInputEdit = null;
    return;
  }
  const range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) {
    content._pendingInputEdit = null;
    return;
  }
  const { startOff, endOff } = getSelectionTextOffsets(content, range);
  let start = startOff;
  let end = endOff;
  const raw = content.dataset.raw ?? "";
  const plain = rawToPlainText(raw);
  let rawStart = visibleOffsetToRaw(raw, startOff, "after");
  let rawEnd = visibleOffsetToRaw(raw, endOff, "before");
  let collapsedBias = null;
  if (startOff === endOff) {
    // Collapsed edits need the semantic side of the hidden tag boundary, not just the visible offset.
    collapsedBias = inferCollapsedCaretBias(content, range, content._nextInputCollapsedBias || "after");
    if (inputType === "deleteContentBackward" && startOff > 0) {
      start = startOff - 1;
      end = startOff;
      rawStart = visibleOffsetToRaw(raw, start, "after");
      rawEnd = visibleOffsetToRaw(raw, end, "before");
    } else if (inputType === "deleteContentForward") {
      start = startOff;
      end = Math.min(startOff + 1, plain.length);
      rawStart = visibleOffsetToRaw(raw, start, "after");
      rawEnd = visibleOffsetToRaw(raw, end, "before");
    } else {
      rawStart = visibleOffsetToRaw(raw, startOff, collapsedBias);
      rawEnd = rawStart;
    }
  }
  content._pendingInputEdit = { inputType, start, end, rawStart, rawEnd, collapsedBias };
}

const _undoStacks = new WeakMap();
const _redoStacks = new WeakMap();

// Read the undo stack for one bubble.
function getUndoStack(content) {
  if (!_undoStacks.has(content)) _undoStacks.set(content, []);
  return _undoStacks.get(content);
}

// Read the redo stack for one bubble.
function getRedoStack(content) {
  if (!_redoStacks.has(content)) _redoStacks.set(content, []);
  return _redoStacks.get(content);
}

// Capture raw text plus visible caret/bias so custom undo/redo can restore selection after re-render.
function makeUndoState(content, raw = content.dataset.raw ?? serializeContent(content)) {
  const selection = getSelection();
  let caret = rawToPlainText(raw).length;
  let bias = content._nextInputCollapsedBias || "after";
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (content.contains(range.startContainer) && content.contains(range.endContainer)) {
      const { startOff } = getSelectionTextOffsets(content, range);
      caret = startOff;
      bias = inferCollapsedCaretBias(content, range, bias);
    }
  }
  return { raw, caret, bias };
}

function saveUndo(content) {
  // Undo stores raw bubble text, not browser DOM history.
  if (!content?.classList?.contains("bubble-content")) return;
  const raw = content.dataset.raw ?? serializeContent(content);
  const stack = getUndoStack(content);
  const last = stack[stack.length - 1];
  if ((typeof last === "string" ? last : last?.raw) === raw) return;
  stack.push(makeUndoState(content, raw));
  getRedoStack(content).length = 0;
}

export default class DocumentApp {
  // Cache DOM references and boot the editor shell.
  constructor() {
    this.currentGame = "BotW";
    this.currentDocMode = DOC_MODE_AEON;
    this.exportMode = DOC_MODE_AEON;
    this.yamlMeta = "";
    this.msytDocInfo = {
      msytMeta: null
    };
    this.chains = [];
    this.rawTarget = null;
    this.editTarget = null;
    this.ctxTarget = null;
    this.ctxSelection = null;
    this.tagSelection = null;
    this.tagPickerOpenId = 0;
    this.surfaceDragSelection = null;
    this.activeContent = null;
    this.documentRenderId = 0;
    this.compareState = null;
    this.pendingCompareFiles = [];
    this.compareFilesPerGroup = 2;
    this.compareGroupCount = 1;
    this.compareLayout = "unified";
    this.activeCompareIssues = null;
    this.autoSplit = localStorage.getItem("msbt_autosplit") !== "0";

    this.sidebar = document.getElementById("sidebar");
    this.editorArea = document.getElementById("editor-area");
    this.chainList = document.getElementById("chain-list");
    this.emptyState = document.getElementById("empty-state");
    this.searchInput = document.getElementById("search-box");
    this.fileDrop = document.getElementById("file-drop");
    this.fileInput = document.getElementById("file-input");
    this.metaPanel = document.getElementById("meta-panel");
    this.metaTextarea = document.getElementById("meta-ta");
    this.statusbar = document.getElementById("statusbar");
    this.rawModal = document.getElementById("raw-modal");
    this.rawTextarea = document.getElementById("raw-text");
    this.tagPicker = document.getElementById("tag-picker");
    this.tpSearch = document.getElementById("tp-search");
    this.tpList = document.getElementById("tp-list");
    this.teModal = document.getElementById("te-modal");
    this.teTitle = document.getElementById("te-title");
    this.teFields = document.getElementById("te-fields");
    this.ctxMenu = document.getElementById("ctx-menu");
    this.btnBotw = document.getElementById("btn-botw");
    this.btnTotk = document.getElementById("btn-totk");
    this.exportWrap = document.getElementById("export-mode-wrap");
    this.btnExpYaml = document.getElementById("btn-exp-yaml");
    this.btnExpMsyt = document.getElementById("btn-exp-msyt");
    this.btnExpBcml = document.getElementById("btn-exp-bcml");
    this.exportBtn = document.getElementById("btn-export");
    this.compareBtn = document.getElementById("btn-compare");
    this.compareFileInput = document.getElementById("compare-file-input");
    this.compareMenu = document.getElementById("compare-menu");
    this.compareFilesPerGroupInput = document.getElementById("compare-files-per-group");
    this.compareGroupCountInput = document.getElementById("compare-group-count");
    this.compareMenuNote = document.getElementById("compare-menu-note");
    this.compareMenuStart = document.getElementById("compare-menu-start");
    this.compareModal = document.getElementById("compare-modal");
    this.compareTitle = document.getElementById("compare-title");
    this.compareBody = document.getElementById("compare-body");
    this.compareLayoutUnified = document.getElementById("compare-layout-unified");
    this.compareLayoutSplit = document.getElementById("compare-layout-split");
    this.metaBtn = document.getElementById("btn-meta");
    this.btnTag = document.getElementById("btn-tag");
    this.btnAutosplit = document.getElementById("btn-autosplit");
    this.globalTypeSelect = document.getElementById("global-type-select");
    this.emptyAddBtn = document.getElementById("empty-add-btn");
    this.importSettings = new ImportSettings();
    this.bulkActions = new BulkActions(this, parseInlineTag, buildInlineTag);

    setRawContentGame(this.currentGame);
    this.bindEvents();
    this.exposeGlobals();
    this.restoreGame();
    this.loadGcfColorMaps();
    this.renderDoc([]);
    this.syncDocModeUi();
    this.syncMetaPanel();
    this.syncAutoSplitUi();
    this.setStatus("Ready");
  }

  // Wire global UI and document-level event handlers.
  bindEvents() {
    this.fileInput.addEventListener("change", (event) => this.handleFileInput(event));
    this.compareFileInput.addEventListener("change", (event) => this.handleCompareFileInput(event));
    this.compareFilesPerGroupInput.addEventListener("input", () => this.syncCompareMenu());
    this.compareGroupCountInput.addEventListener("input", () => this.syncCompareMenu());
    this.compareMenuStart.addEventListener("click", () => this.startCompareFromMenu());
    document.addEventListener("mousedown", (event) => {
      if (!event.target.closest("#compare-menu") && event.target !== this.compareBtn) this.closeCompareMenu();
    });
    this.metaTextarea.addEventListener("input", () => {
      if (this.currentDocMode === DOC_MODE_AEON) this.yamlMeta = this.metaTextarea.value;
      if (this.currentDocMode === DOC_MODE_MSYT) {
        this.msytDocInfo.aeonMeta = this.metaTextarea.value;
        this.refreshChainModeUi();
      }
    });

    document.body.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.fileDrop.classList.add("drag");
    });
    document.body.addEventListener("dragleave", () => {
      this.fileDrop.classList.remove("drag");
    });
    document.body.addEventListener("drop", (event) => {
      event.preventDefault();
      this.fileDrop.classList.remove("drag");
      const file = event.dataTransfer.files?.[0];
      if (file) this.loadFile(file);
    });

    document.getElementById("raw-apply").addEventListener("click", () => this.applyRaw());
    document.getElementById("raw-close").addEventListener("click", () => this.closeRaw());
    document.getElementById("ctx-view-raw").addEventListener("click", () => this.openRawFromContext());
    document.getElementById("ctx-delay8").addEventListener("click", () => this.ctxInsertDelay("delay8"));
    document.getElementById("ctx-delay15").addEventListener("click", () => this.ctxInsertDelay("delay15"));
    document.getElementById("ctx-delay30").addEventListener("click", () => this.ctxInsertDelay("delay30"));
    document.getElementById("ctx-copy-tags").addEventListener("click", () => this.copyContextRaw());
    document.getElementById("ctx-copy-plain").addEventListener("click", () => this.copyContextPlain());
    this.btnTag.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.captureTagSelection(this.activeContent, true);
    });

    document.addEventListener("contextmenu", (event) => this.handleContextMenu(event));
    document.addEventListener("mousedown", (event) => {
      if (!event.target.closest("#ctx-menu")) this.closeCtx();
    });
    document.addEventListener("selectionchange", () => {
      if (!this.activeContent) return;
      this.captureTagSelection(this.activeContent, false);
      const bubbleRecord = this.findBubbleByContent(this.activeContent);
      if (bubbleRecord?.fmtPopup) this.checkFmtSel(this.activeContent, bubbleRecord.fmtPopup);
    });
    document.addEventListener("mousemove", (event) => {
      if (!this.surfaceDragSelection || !(event.buttons & 1)) return;
      const { content, anchor } = this.surfaceDragSelection;
      if (!content?.isConnected) {
        this.surfaceDragSelection = null;
        return;
      }
      content.focus();
      const current = this.getVisibleOffsetFromPoint(content, event.clientX, event.clientY);
      this.setSelectionVisibleOffsets(content, anchor, current);
      this.captureTagSelection(content, true);
      const bubbleRecord = this.findBubbleByContent(content);
      if (bubbleRecord?.fmtPopup) this.checkFmtSel(content, bubbleRecord.fmtPopup);
    });
    document.addEventListener("mouseup", () => {
      if (!this.surfaceDragSelection) return;
      const content = this.surfaceDragSelection.content;
      this.surfaceDragSelection = null;
      if (!content?.isConnected) return;
      this.captureTagSelection(content, true);
      const bubbleRecord = this.findBubbleByContent(content);
      if (bubbleRecord?.fmtPopup) this.checkFmtSel(content, bubbleRecord.fmtPopup);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.surfaceDragSelection = null;
        this.importSettings.close();
        this.bulkActions.close();
        this.closeTP();
        this.closeCompare();
        this.closeRaw();
        this.closeTE();
        this.closeCtx();
      }
    });
  }

  // Expose HTML onclick hooks on window.
  exposeGlobals() {
    window.selectGame = (game) => this.selectGame(game);
    window.setExportMode = (mode) => this.setExportMode(mode);
    window.exportYaml = () => this.exportDocument();
    window.startCompare = () => this.startCompare();
    window.openCompareMenu = (event) => this.openCompareMenu(event);
    window.closeCompare = () => this.closeCompare();
    window.setCompareLayout = (layout) => this.setCompareLayout(layout);
    window.toggleMeta = () => this.metaPanel.classList.toggle("open");
    window.openTP = () => this.openTP();
    window.closeTP = () => this.closeTP();
    window.filterTP = (query) => this.filterTP(query);
    window.tpKey = (event) => this.tpKey(event);
    window.toggleAutoSplit = () => this.toggleAutoSplit();
    window.openSettings = () => this.importSettings.open();
    window.closeSettings = () => this.importSettings.close();
    window.setImportSettings = (settings) => this.importSettings.set(settings);
    window.openBulkActions = () => this.bulkActions.open();
    window.closeBulkActions = () => this.bulkActions.close();
    window.applyBulkActions = (actions) => this.bulkActions.apply(actions);
    window.applyGlobalType = (type) => this.applyGlobalType(type);
    window.doSearch = (query) => this.doSearch(query);
    window.openNC = () => this.createNewChain();
    window.closeRaw = () => this.closeRaw();
    window.applyRaw = () => this.applyRaw();
    window.closeTE = () => this.closeTE();
    window.saveTE = () => this.saveTE();
    window.deleteTE = () => this.deleteTE();
  }

  // Restore the last selected game from localStorage.
  restoreGame() {
    const saved = localStorage.getItem(STORAGE_GAME_KEY);
    if (saved === "TotK") this.currentGame = "TotK";
    this.syncGameUi();
  }

  // Refresh game-specific UI and popup palettes.
  syncGameUi() {
    setRawContentGame(this.currentGame);
    this.btnBotw.classList.toggle("active", this.currentGame === "BotW");
    this.btnTotk.classList.toggle("active", this.currentGame === "TotK");
    this.chains.forEach((chain) => chain.bubbles.forEach((bubble) => bubble.fmtPopup && this.buildFmtPopup(bubble.fmtPopup)));
  }

  // Refresh mode-dependent buttons and visibility.
  syncDocModeUi() {
    const isMsyt = this.currentDocMode === DOC_MODE_MSYT || this.currentDocMode === DOC_MODE_BCML;
    const onlyBcml = this.currentDocMode === DOC_MODE_BCML;
    const tagEnabled = this.currentDocMode === DOC_MODE_AEON || isMsyt;
    this.metaBtn.disabled = onlyBcml;
    if (onlyBcml) this.metaPanel.classList.remove("open");
    this.exportWrap.classList.toggle("show", this.currentGame === "BotW");
    this.btnExpYaml.style.display = onlyBcml ? "none" : "";
    this.btnExpMsyt.style.display = onlyBcml ? "none" : "";
    this.btnExpBcml.style.display = onlyBcml ? "" : "none";
    if (onlyBcml) this.exportMode = DOC_MODE_BCML;
    else if (this.exportMode === DOC_MODE_BCML) this.exportMode = this.currentDocMode === DOC_MODE_MSYT ? DOC_MODE_MSYT : DOC_MODE_AEON;
    this.btnExpYaml.classList.toggle("active", this.exportMode === DOC_MODE_AEON);
    this.btnExpMsyt.classList.toggle("active", this.exportMode === DOC_MODE_MSYT);
    this.btnExpBcml.classList.toggle("active", this.exportMode === DOC_MODE_BCML);
    this.btnTag.disabled = !tagEnabled;
    this.btnTag.classList.toggle("disabled", !tagEnabled);
    this.refreshChainModeUi();
  }

  // Refresh the meta panel contents for the current mode.
  syncMetaPanel() {
    if (this.currentDocMode === DOC_MODE_AEON) {
      this.metaTextarea.readOnly = false;
      this.metaTextarea.placeholder = "YAML metadata (%%% block)...";
      this.metaTextarea.value = this.yamlMeta || "";
      return;
    }
    if (this.currentDocMode === DOC_MODE_MSYT) {
      this.metaTextarea.readOnly = false;
      this.metaTextarea.placeholder = "AEON metadata for YAML export...";
      this.metaTextarea.value = this.msytDocInfo.aeonMeta || buildAeonMetaFromMsyt(this.msytDocInfo.msytMeta, this.chains);
      return;
    }
    this.metaTextarea.readOnly = true;
    this.metaTextarea.placeholder = "MSYT mode does not use a YAML meta block";
    this.metaTextarea.value = `defaultLocale: ${this.msytDocInfo.bcmlDefaultLocale}\ndefaultPath: ${
      this.msytDocInfo.bcmlDefaultPath
    }\n`;
  }

  // Switch between BotW and TotK, with MSYT guard rails.
  selectGame(game) {
    if ((this.currentDocMode === DOC_MODE_MSYT || this.currentDocMode === DOC_MODE_BCML) && game !== "BotW") {
      this.setStatus("⚠ MSYT is supported only for BotW");
      game = "BotW";
    }
    this.currentGame = game;
    localStorage.setItem(STORAGE_GAME_KEY, game);
    this.syncGameUi();
    this.syncDocModeUi();
    // this.setStatus(`Game: ${game}`);
  }

  // Change the export target format.
  setExportMode(mode) {
    this.exportMode = mode;
    this.syncDocModeUi();
    // this.setStatus(`Export mode: ${mode}`);
  }

  // Resolve the actual export mode for the current game.
  getEffectiveExportMode() {
    return this.currentGame === "BotW" ? this.exportMode : DOC_MODE_AEON;
  }

  // Refresh the autosplit button label.
  syncAutoSplitUi() {
    this.btnAutosplit.textContent = `✂ Auto-split: ${this.autoSplit ? "ON" : "OFF"}`;
  }

  // Rebuild the inline format popup for the current game palette.
  buildFmtPopup(popup) {
    popup.innerHTML = "";
    const palette = getColorCss(this.currentGame);
    getColorChoices(this.currentGame).forEach((name) => {
      if (name === "Default") return;
      const value = palette[name];
      if (!value) return;
      const button = document.createElement("button");
      button.className = "fmt-btn";
      button.type = "button";
      button.innerHTML = `<span class="fmt-dot" style="color:${value}"></span>`;
      button.title = name;
      button.onmousedown = (event) => {
        event.preventDefault();
        this.applyFormat("color", name);
      };
      popup.appendChild(button);
    });

    const reset = document.createElement("button");
    reset.className = "fmt-btn";
    reset.type = "button";
    reset.innerHTML = '<span class="fmt-reset">✕</span>';
    reset.title = "Default color";
    reset.onmousedown = (event) => {
      event.preventDefault();
      this.applyFormat("color", null);
    };
    popup.appendChild(reset);

    const sep = document.createElement("div");
    sep.className = "fmt-sep";
    popup.appendChild(sep);

    for (const [size, label] of [
      ["80", "S"],
      ["100", "M"],
      ["125", "L"]
    ]) {
      const button = document.createElement("button");
      button.className = "fmt-btn";
      button.type = "button";
      const fontSize = size === "80" ? "9px" : size === "100" ? "11px" : "14px";
      button.innerHTML = `<span class="fmt-sz" style="font-size:${fontSize}">${label}</span>`;
      button.title = `Size ${size}%`;
      button.onmousedown = (event) => {
        event.preventDefault();
        this.applyFormat("size", size === "100" ? null : size);
      };
      popup.appendChild(button);
    }
  }

  // Save the current bubble selection for later tag insertion.
  captureTagSelection(content = this.activeContent, fallbackToEnd = false) {
    if (!content) return null;
    const selection = getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (content.contains(range.startContainer) && content.contains(range.endContainer)) {
        const { startOff, endOff } = getSelectionTextOffsets(content, range);
        this.tagSelection = { content, start: startOff, end: endOff };
        return this.tagSelection;
      }
    }
    if (!fallbackToEnd) return this.tagSelection;
    const raw = content.dataset.raw ?? serializeContent(content);
    const end = rawToPlainText(raw).length;
    this.tagSelection = { content, start: end, end };
    return this.tagSelection;
  }

  // Open the GCF-driven tag picker.
  openTP() {
    const content = this.activeContent || document.activeElement?.closest?.(".bubble-content");
    if (content) this.captureTagSelection(content, false);
    this.tpList.innerHTML = "";
    this.tagPickerOpenId += 1;
    const openId = this.tagPickerOpenId;
    const isMsyt = this.currentDocMode === DOC_MODE_MSYT || this.currentDocMode === DOC_MODE_BCML;
    for (const tagDef of getTags(this.currentGame)) {
      if (isMsyt && !isTagMappedToMsyt(tagDef.name, this.currentGame)) continue;
      if (tagDef.name === "color" || tagDef.name === "size" || tagDef.name === "pageBreak") continue;
      const item = document.createElement("div");
      item.className = "tp-item";
      item.dataset.n = String(tagDef.name || "").toLowerCase();
      item._tagDef = tagDef;
      item._openId = openId;
      item.innerHTML = `<span class="tp-name">${escapeHtml(tagDef.name)}</span><span class="tp-desc">${escapeHtml(
        tagDef.description || ""
      )}</span>`;
      item.addEventListener("click", () => {
        this.insertFromTP(tagDef, openId);
      });
      this.tpList.appendChild(item);
    }
    if (!this.tpList.childElementCount) {
      this.setStatus(isMsyt ? "No msyt-mapped tags loaded" : "No GCF tags loaded");
      return;
    }
    this.tagPicker.classList.add("open");
    this.tpSearch.value = "";
    setTimeout(() => {
      this.tpSearch.focus();
      this.tpSetHi(0);
    }, 40);
  }

  // Close the tag picker.
  closeTP() {
    this.tagPicker.classList.remove("open");
  }

  // Filter visible tag picker items.
  filterTP(query) {
    const q = String(query || "").toLowerCase();
    this.tpList.querySelectorAll(".tp-item").forEach((item) => {
      item.style.display = item.dataset.n.includes(q) ? "" : "none";
    });
    this.tpSetHi(0);
  }

  // Return currently visible picker rows.
  tpVisible() {
    return [...this.tpList.querySelectorAll(".tp-item")].filter((item) => item.style.display !== "none");
  }

  // Move the picker highlight to one visible row.
  tpSetHi(index) {
    const items = this.tpVisible();
    items.forEach((item) => item.classList.remove("tp-hi"));
    if (items[index]) {
      items[index].classList.add("tp-hi");
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  // Get the highlighted picker row index.
  tpHiIdx() {
    return this.tpVisible().findIndex((item) => item.classList.contains("tp-hi"));
  }

  // Handle keyboard navigation inside the tag picker.
  tpKey(event) {
    const items = this.tpVisible();
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.tpSetHi(Math.min(this.tpHiIdx() + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.tpSetHi(Math.max(this.tpHiIdx() - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = items[this.tpHiIdx()];
      if (active?._tagDef) this.insertFromTP(active._tagDef, active._openId);
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.closeTP();
    }
  }

  // Insert the chosen GCF tag into the saved bubble selection.
  insertFromTP(tagDef, openId = this.tagPickerOpenId) {
    if (openId !== this.tagPickerOpenId) return;
    this.tagPickerOpenId += 1;
    this.closeTP();
    const saved = this.tagSelection;
    const content = saved?.content || this.activeContent;
    if (!content) {
      this.setStatus("⚠ Put caret in a bubble");
      return;
    }
    const bubbleRecord = this.findBubbleByContent(content);
    if (!bubbleRecord) {
      this.setStatus("⚠ Put caret in a bubble");
      return;
    }
    saveUndo(content);
    const args = {};
    const order = [];
    for (const arg of tagDef.args || []) {
      order.push(arg.name);
      const mappedValues = Object.values(arg.valueMap || {});
      args[arg.name] = arg.default != null ? String(arg.default) : mappedValues[0] ?? "";
    }
    const rawTag = buildInlineTag(tagDef.name, args, order);
    const currentRaw = content.dataset.raw ?? serializeContent(content);
    const start = saved && saved.content === content ? saved.start : rawToPlainText(currentRaw).length;
    const end = saved && saved.content === content ? saved.end : start;
    const nextRaw = spliceVisibleRange(currentRaw, start, end, rawTag);
    renderRawToContent(content, nextRaw);
    content.dataset.raw = nextRaw;
    content._nextInputCollapsedBias = "after";
    content.focus();
    this.setCaretAtVisibleOffset(content, start);
    this.tagSelection = { content, start, end: start };
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(bubbleRecord.chain);
    this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
    this.setStatus(`✓ Inserted: {{${tagDef.name}}}`);
  }

  // Show or hide the format popup for the active selection.
  checkFmtSel(content, popup) {
    const selection = getSelection();
    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      document.activeElement === content &&
      content.contains(selection.anchorNode) &&
      content.contains(selection.focusNode)
    ) {
      popup.classList.add("show");
    } else {
      popup.classList.remove("show");
    }
  }

  // Toggle empty-state vs entry-list UI.
  syncEntryUi() {
    const hasEntries = this.chains.length > 0;
    this.emptyState.hidden = hasEntries;
    this.editorArea.classList.toggle("has-entries", hasEntries);
    if (hasEntries) this.appendAddChainButton();
    else this.editorArea.querySelector("#add-chain-btn")?.remove();
  }

  // Turn autosplit on or off.
  toggleAutoSplit() {
    this.autoSplit = !this.autoSplit;
    localStorage.setItem("msbt_autosplit", this.autoSplit ? "1" : "0");
    this.syncAutoSplitUi();
  }

  // Write a message to the status bar.
  setStatus(text) {
    this.statusbar.textContent = makeStatus(text);
  }

  // Start comparison with the most recently selected settings.
  startCompare() {
    this.startCompareWithOptions(this.compareFilesPerGroup, this.compareGroupCount);
  }

  // Open the Compare settings on right click.
  openCompareMenu(event) {
    event.preventDefault();
    this.compareMenu.style.left = `${event.clientX}px`;
    this.compareMenu.style.top = `${event.clientY}px`;
    this.compareMenu.classList.add("open");
    this.syncCompareMenu();
  }

  // Close the Compare settings popup.
  closeCompareMenu() {
    this.compareMenu.classList.remove("open");
  }

  // Clamp and describe the selected Compare settings.
  syncCompareMenu() {
    const filesPerGroup = Math.max(1, Math.floor(Number(this.compareFilesPerGroupInput.value) || 1));
    const groupCount = Math.max(1, Math.floor(Number(this.compareGroupCountInput.value) || 1));
    this.compareFilesPerGroupInput.value = String(filesPerGroup);
    this.compareGroupCountInput.value = String(groupCount);
    const totalFiles = filesPerGroup === 1 ? groupCount : filesPerGroup * groupCount;
    this.compareMenuNote.textContent =
      filesPerGroup === 1
        ? `${totalFiles} file(s): each is compared with the current document.`
        : `${totalFiles} file(s) will be chosen one by one.`;
  }

  // Apply the settings from the Compare popup.
  startCompareFromMenu() {
    this.syncCompareMenu();
    this.startCompareWithOptions(Number(this.compareFilesPerGroupInput.value), Number(this.compareGroupCountInput.value));
  }

  // Ask for every source file in a stable order.
  startCompareWithOptions(filesPerGroup, groupCount) {
    this.closeCompareMenu();
    this.compareFilesPerGroup = filesPerGroup;
    this.compareGroupCount = groupCount;
    this.pendingCompareFiles = [];
    this.compareFileInput.value = "";
    this.requestNextCompareFile();
  }

  // Request the next source file; mode 1 uses the current document as the first file.
  requestNextCompareFile() {
    const totalFiles = this.compareFilesPerGroup === 1 ? this.compareGroupCount : this.compareFilesPerGroup * this.compareGroupCount;
    const next = this.pendingCompareFiles.length + 1;
    if (next > totalFiles) {
      this.applyCompareFiles(this.pendingCompareFiles);
      return;
    }
    this.setStatus(`Choose comparison file ${next} of ${totalFiles}`);
    this.compareFileInput.value = "";
    this.compareFileInput.click();
  }

  // Read a selected source file without touching the active document.
  async handleCompareFileInput(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      this.pendingCompareFiles.push({ name: file.name, text: await file.text() });
      this.requestNextCompareFile();
    } catch (error) {
      window.alert(`Error: ${error.message}`);
      this.setStatus("Compare failed");
    }
  }

  // Build a source document from the document currently open in Bubble Wrap.
  getCurrentCompareFile() {
    return {
      name: "Current document",
      entries: this.chains.map((chain) => ({
        label: chain.labelInput.value,
        content: this.serializeChainRaw(chain),
        docKey: chain.docKey
      }))
    };
  }

  // Use locale/path-aware keys where MSYT supplied them; otherwise labels are the key.
  getCompareEntryKey(entry) {
    return entry?.docKey || entry?.label || "";
  }

  // Build one comparison group from two or more documents.
  buildCompareGroup(files, index) {
    const documents = files.map((file) => ({
      name: file.name,
      entries: file.entries || parseCompareDocument(file.text).entries || []
    }));
    const entryMaps = documents.map((document) => {
      const map = new Map();
      document.entries.forEach((entry, entryIndex) => {
        const key = this.getCompareEntryKey(entry);
        if (!map.has(key)) map.set(key, { key, label: entry.label, raw: compareEntryRaw(entry), index: entryIndex });
      });
      return map;
    });
    const allKeys = new Set(entryMaps.flatMap((map) => [...map.keys()]));
    const issuesByKey = new Map();
    const changedByKey = new Map();
    const newLabels = [];
    const currentKeys = new Set(this.chains.map((chain) => chain.docKey || chain.labelInput.value));

    allKeys.forEach((key) => {
      const versions = entryMaps.map((map, fileIndex) => {
        const entry = map.get(key);
        return { name: documents[fileIndex].name, raw: entry?.raw ?? null };
      });
      const changed = versions.some((version, versionIndex) => versionIndex && version.raw !== versions[versionIndex - 1].raw);
      const firstEntry = entryMaps[0].get(key);
      const lastEntry = [...entryMaps].reverse().map((map) => map.get(key)).find(Boolean) || firstEntry;
      const issue = { type: changed ? (firstEntry ? "changed" : "new") : "unchanged", key, label: lastEntry?.label || key, versions, groupIndex: index };
      issuesByKey.set(key, issue);
      if (!changed) return;
      if (firstEntry) changedByKey.set(key, issue);
      else {
        const lastEntries = documents[documents.length - 1].entries;
        const lastIndex = lastEntries.findIndex((entry) => this.getCompareEntryKey(entry) === key);
        newLabels.push({
          ...issue,
          afterLabel: this.findNearestCompareLabel(lastEntries, lastIndex, currentKeys, -1),
          beforeLabel: this.findNearestCompareLabel(lastEntries, lastIndex, currentKeys, 1)
        });
      }
    });
    return { files: documents, issuesByKey, changedByKey, newLabels };
  }

  // Build all independent comparison groups.
  applyCompareFiles(files) {
    try {
      const groups = [];
      let cursor = 0;
      for (let index = 0; index < this.compareGroupCount; index++) {
        const groupFiles =
          this.compareFilesPerGroup === 1
            ? [files[cursor++], this.getCurrentCompareFile()]
            : files.slice(cursor, (cursor += this.compareFilesPerGroup));
        groups.push(this.buildCompareGroup(groupFiles, index));
      }
      this.compareState = { groups };
      this.renderCompareOverlay();
      const changed = groups.reduce((total, group) => total + group.changedByKey.size, 0);
      const added = groups.reduce((total, group) => total + group.newLabels.length, 0);
      this.setStatus(`Compare: ${changed} changed, ${added} new`);
    } catch (error) {
      window.alert(`Error: ${error.message}`);
      this.setStatus("Compare failed");
    }
  }

  // Find nearby labels that are also present in the current document.
  findNearestCompareLabel(entries, index, currentKeys, direction) {
    for (let cursor = index + direction; cursor >= 0 && cursor < entries.length; cursor += direction) {
      const entry = entries[cursor];
      if (currentKeys.has(this.getCompareEntryKey(entry))) return entry.label;
    }
    return "";
  }

  // Refresh all compare markers and the bottom "new labels" queue.
  renderCompareOverlay() {
    this.chains.forEach((chain) => this.updateSidebarItem(chain));
    this.renderCompareNewLabels();
  }

  // Attach all comparison issues for a chain based on its document key.
  updateCompareIssueForChain(chain) {
    const key = chain.docKey || chain.labelInput.value;
    chain.compareIssues = (this.compareState?.groups || []).map((group) => group.issuesByKey.get(key)).filter(Boolean);
    chain.compareIssue = chain.compareIssues.find((issue) => issue.type !== "unchanged") || null;
  }

  // Render new labels separately so the current document order is not changed automatically.
  renderCompareNewLabels() {
    this.chainList.querySelector(".compare-new-section")?.remove();
    const groups = (this.compareState?.groups || []).filter((group) => group.newLabels.length);
    if (!groups.length) return;

    const section = document.createElement("section");
    section.className = "compare-new-section";
    section.innerHTML = `<div class="compare-new-title">New labels</div>`;

    groups.forEach((group) => {
      if (groups.length > 1) {
        const title = document.createElement("div");
        title.className = "compare-new-group-title";
        title.textContent = `Comparison ${group.newLabels[0].groupIndex + 1}`;
        section.appendChild(title);
      }
      group.newLabels.forEach((issue) => {
        const item = document.createElement("div");
        item.className = "compare-new-item";
        const context = [
          issue.afterLabel ? `after ${issue.afterLabel}` : "",
          issue.beforeLabel ? `before ${issue.beforeLabel}` : ""
        ]
          .filter(Boolean)
          .join(", ");
        item.innerHTML = `
          <div>
            <div class="compare-new-label">${escapeHtml(issue.label)}</div>
            <div class="compare-new-context">${escapeHtml(context || "No nearby existing label")}</div>
          </div>
          <div class="compare-new-actions">
            <button type="button" class="tbtn compare-view">View</button>
            <button type="button" class="tbtn compare-add">Add Entry</button>
          </div>
        `;
        item.querySelector(".compare-view").addEventListener("click", () => this.openCompareIssue(issue));
        item.querySelector(".compare-add").addEventListener("click", () => this.addCompareNewEntry(issue));
        section.appendChild(item);
      });
    });

    const addButton = this.chainList.querySelector("#add-chain-btn");
    if (addButton) this.chainList.insertBefore(section, addButton);
    else this.chainList.appendChild(section);
  }

  // Add a new mod label at the bottom only when the user explicitly asks.
  addCompareNewEntry(issue) {
    const latest = [...issue.versions].reverse().find((version) => version.raw != null);
    const chain = this.createChain({
      ...this.makeNewEntry(),
      label: issue.label,
      content: latest?.raw || ""
    });
    const group = this.compareState?.groups?.[issue.groupIndex];
    if (group) {
      group.newLabels = group.newLabels.filter((item) => item.key !== issue.key);
      this.renderCompareNewLabels();
    }
    chain.section.scrollIntoView({ behavior: "smooth", block: "start" });
    this.setStatus(`Added new label: ${issue.label}`);
  }

  // Open a compare issue from either a changed chain or a new-label item.
  openCompareIssue(target) {
    const issue = target?.compareIssue || target;
    if (!issue) return;
    const issues = target?.compareIssues || (this.compareState?.groups || []).map((group) => group.issuesByKey.get(issue.key)).filter(Boolean);
    if (!issues.length) return;
    const currentRaw = target?.bubbles ? this.serializeChainRaw(target) : "";
    this.activeCompareIssues = issues.map((item) => ({ ...item, currentRaw }));
    this.compareModal.classList.add("open");
    this.renderCompareModal();
  }

  // Close the compare modal.
  closeCompare() {
    this.compareModal.classList.remove("open");
    this.activeCompareIssues = null;
  }

  // Switch compare modal layout.
  setCompareLayout(layout) {
    this.compareLayout = layout === "split" ? "split" : "unified";
    this.compareLayoutUnified.classList.toggle("active", this.compareLayout === "unified");
    this.compareLayoutSplit.classList.toggle("active", this.compareLayout === "split");
    this.renderCompareModal();
  }

  // Repaint every comparison group for the active label.
  renderCompareModal() {
    const issues = this.activeCompareIssues;
    if (!issues?.length) return;
    this.compareTitle.textContent = `Compare label: ${issues[0].label}`;
    const groups = issues.map((issue) => {
      const versions = issue.versions || [];
      const meta = `<div class="compare-meta">${versions.map((version) => escapeHtml(version.name)).join(" → ")}</div>`;
      const stages = [];
      for (let index = 1; index < versions.length; index++) {
        const before = versions[index - 1];
        const after = versions[index];
        const heading = versions.length > 2 ? `<div class="compare-stage-title">${escapeHtml(before.name)} → ${escapeHtml(after.name)}</div>` : "";
        const diff =
          this.compareLayout === "split"
            ? this.buildSplitDiffHtml(before.raw ?? "", after.raw ?? "", before.name, after.name)
            : `<div class="compare-unified">${this.buildUnifiedDiffHtml(before.raw ?? "", after.raw ?? "")}</div>`;
        stages.push(`<section class="compare-stage">${heading}${diff}</section>`);
      }
      const title = this.compareState?.groups?.length > 1 ? `<h4 class="compare-group-title">Comparison ${issue.groupIndex + 1}</h4>` : "";
      return `<section class="compare-group">${title}${meta}${stages.join("")}</section>`;
    });
    const currentRaw = issues[0].currentRaw;
    this.compareBody.innerHTML = `${groups.join("")}${
      currentRaw ? `<div class="compare-pane" style="margin-top:12px"><div class="compare-pane-title">Current document</div><pre>${escapeHtml(currentRaw)}</pre></div>` : ""
    }`;
  }

  // Build line-level diff rows once so Unified and Split stay visually consistent.
  buildDiffRows(oldRaw, newRaw) {
    const oldLines = String(oldRaw || "").split("\n");
    const newLines = String(newRaw || "").split("\n");
    const dp = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
    for (let i = oldLines.length - 1; i >= 0; i--) {
      for (let j = newLines.length - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const rows = [];
    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        rows.push({ type: "same", line: oldLines[i] });
        i++;
        j++;
        continue;
      }
      if (j >= newLines.length || (i < oldLines.length && dp[i + 1][j] >= dp[i][j + 1])) {
        rows.push({ type: "del", line: oldLines[i] });
        i++;
      } else {
        rows.push({ type: "add", line: newLines[j] });
        j++;
      }
    }
    return rows;
  }

  // Highlight the changed span inside a changed line pair.
  highlightChangedText(line, otherLine, type) {
    const value = String(line ?? "");
    const other = String(otherLine ?? "");
    let prefix = 0;
    while (prefix < value.length && prefix < other.length && value[prefix] === other[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < value.length - prefix &&
      suffix < other.length - prefix &&
      value[value.length - 1 - suffix] === other[other.length - 1 - suffix]
    ) {
      suffix++;
    }
    const changedEnd = suffix ? value.length - suffix : value.length;
    const before = escapeHtml(value.slice(0, prefix));
    const changed = escapeHtml(value.slice(prefix, changedEnd));
    const after = escapeHtml(value.slice(changedEnd));
    if (!changed) return `${before}${after}`;
    return `${before}<span class="compare-chunk ${type}">${changed}</span>${after}`;
  }

  // Render one diff row, optionally with a paired opposite row for intra-line highlighting.
  buildDiffLineHtml(row, pairedRow = null) {
    const marker = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
    const line =
      pairedRow && row.type !== "same" ? this.highlightChangedText(row.line, pairedRow.line, row.type) : escapeHtml(row.line ?? "");
    return `<div class="compare-line ${row.type}"><span class="compare-marker">${marker}</span><span class="compare-line-text">${line}</span></div>`;
  }

  // Build a compact unified diff for review.
  buildUnifiedDiffHtml(oldRaw, newRaw) {
    const rows = this.buildDiffRows(oldRaw, newRaw);
    const html = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const next = rows[index + 1];
      if (row.type === "del" && next?.type === "add") {
        html.push(this.buildDiffLineHtml(row, next));
        html.push(this.buildDiffLineHtml(next, row));
        index++;
        continue;
      }
      html.push(this.buildDiffLineHtml(row));
    }
    return html.join("");
  }

  // Build split diff panes with the same coloring as Unified.
  buildSplitDiffHtml(oldRaw, newRaw, oldTitle = "Original", newTitle = "Modified") {
    const rows = this.buildDiffRows(oldRaw, newRaw);
    const oldHtml = [];
    const newHtml = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const next = rows[index + 1];
      if (row.type === "del" && next?.type === "add") {
        oldHtml.push(this.buildDiffLineHtml(row, next));
        newHtml.push(this.buildDiffLineHtml(next, row));
        index++;
        continue;
      }
      if (row.type === "same") {
        oldHtml.push(this.buildDiffLineHtml(row));
        newHtml.push(this.buildDiffLineHtml(row));
      } else if (row.type === "del") {
        oldHtml.push(this.buildDiffLineHtml(row));
      } else {
        newHtml.push(this.buildDiffLineHtml(row));
      }
    }
    return `<div class="compare-split">
      <div class="compare-pane">
        <div class="compare-pane-title">${escapeHtml(oldTitle)}</div>
        <div class="compare-pane-lines">${oldHtml.join("") || this.buildDiffLineHtml({ type: "same", line: "(missing)" })}</div>
      </div>
      <div class="compare-pane">
        <div class="compare-pane-title">${escapeHtml(newTitle)}</div>
        <div class="compare-pane-lines">${newHtml.join("") || this.buildDiffLineHtml({ type: "same", line: "(empty)" })}</div>
      </div>
    </div>`;
  }

  // Build a fresh empty entry object.
  makeNewEntry() {
    return defaultEntry(this.currentDocMode, this.msytDocInfo);
  }

  // Read the chosen file input file.
  handleFileInput(event) {
    const file = event.target.files?.[0];
    if (file) this.loadFile(file);
  }

  // Load local GCF files into the in-memory registry.
  async loadGcfColorMaps() {
    for (const game of ["BotW", "TotK"]) {
      try {
        const response = await fetch(`data/gcf/${game}.gcf`);
        if (!response.ok) continue;
        const text = await response.text();
        setGcfText(game, text);
      } catch (error) {
        this.setStatus(`Could not load ${game}.gcf: ${error.message}`);
      }
    }
    this.syncGameUi();
  }

  // Load a file object into the editor.
  async loadFile(file) {
    const text = await file.text();
    this.fileDrop.textContent = `📂 ${file.name}`;
    this.loadText(text);
  }

  // Detect the incoming format and load it.
  loadText(text) {
    const normalized = normalizeNewlines(text);
    const trimmed = normalized.trimStart();

    this.compareState = null;
    this.pendingCompareFiles = [];
    this.closeCompare();

    // Aeon
    if (!trimmed) {
      this.currentDocMode = DOC_MODE_AEON;
      this.exportMode = DOC_MODE_AEON;
      this.yamlMeta = "";
      this.msytDocInfo = {
        msytMeta: null
      };
      this.renderDoc([]);
      this.syncDocModeUi();
      this.syncMetaPanel();
      this.setStatus("Loaded empty document");
      return;
    }

    // BCML
    if (trimmed.startsWith("{")) {
      try {
        const doc = parseMsytBcmlJson(normalized);
        this.currentDocMode = DOC_MODE_BCML;
        this.exportMode = DOC_MODE_BCML;
        this.yamlMeta = "";
        this.msytDocInfo = {
          bcmlDefaultLocale: doc.bcmlDefaultLocale,
          bcmlDefaultPath: doc.bcmlDefaultPath,
          msytMeta: null
        };
        this.selectGame("BotW");
        this.renderDoc(doc.entries);
        this.syncDocModeUi();
        this.syncMetaPanel();
        this.setStatus(`Loaded BCML texts.json with ${doc.entries.length} entr${doc.entries.length === 1 ? "y" : "ies"}`);
        return;
      } catch (error) {
        window.alert(`Error: ${error.message}`);
        return;
      }
    }

    // MSYT
    if (/^(?:---\n)?(?:\s*group_count:|\s*entries:)/m.test(trimmed)) {
      try {
        const doc = parseMsytYaml(normalized);
        this.importSettings.applyMsyt(doc, parseInlineTag, buildInlineTag);
        this.currentDocMode = DOC_MODE_MSYT;
        this.exportMode = DOC_MODE_MSYT;
        this.yamlMeta = "";
        this.msytDocInfo = {
          msytMeta: doc.meta,
          aeonMeta: buildAeonMetaFromMsyt(doc.meta, doc.entries, this.importSettings.bigEndian ?? true)
        };
        this.selectGame("BotW");
        this.renderDoc(doc.entries);
        this.syncDocModeUi();
        this.syncMetaPanel();
        this.setStatus(`Loaded .msyt with ${doc.entries.length} entr${doc.entries.length === 1 ? "y" : "ies"}`);
        return;
      } catch (error) {
        window.alert(`Error: ${error.message}`);
        return;
      }
    }

    const doc = parseAeonYaml(normalized);
    this.importSettings.applyAeon(doc, hasBigEndian(doc.yamlMeta), parseInlineTag, buildInlineTag);
    this.currentDocMode = DOC_MODE_AEON;
    this.exportMode = DOC_MODE_AEON;
    this.yamlMeta = doc.yamlMeta;
    this.msytDocInfo = {
      msytMeta: { group_count: getAeonLabelGroups(doc.yamlMeta) }
    };
    if (this.yamlMeta.includes("hasATR1: true")) this.selectGame("BotW");
    else if (this.yamlMeta.includes("hasATR1: false")) this.selectGame("TotK");
    this.renderDoc(doc.entries);
    this.syncDocModeUi();
    this.syncMetaPanel();
    this.setStatus(`Loaded ${doc.entries.length} entr${doc.entries.length === 1 ? "y" : "ies"}`);
  }

  // Dispose state owned by the previous document and start a new render.
  beginDocumentRender() {
    this.documentRenderId += 1;
    this.tagPickerOpenId += 1;
    this.closeRaw();
    this.closeTE();
    this.closeCtx();
    this.closeTP();
    this.activeContent = null;
    this.tagSelection = null;
    this.surfaceDragSelection = null;
    getSelection()?.removeAllRanges();
    return this.documentRenderId;
  }

  // Rebuild the whole document from entry data.
  renderDoc(entries) {
    const renderId = this.beginDocumentRender();
    this.chains = [];
    this.chainList.innerHTML = "";
    this.sidebar.innerHTML = "";
    this.chainList.querySelector("#add-chain-btn")?.remove();

    if (!entries.length) {
      this.syncEntryUi();
      return;
    }
    this.isImportingDocument = true;
    try {
      entries.forEach((entry) => this.createChain(entry));
    } finally {
      this.isImportingDocument = false;
    }
    this.refreshDocumentUi();
    this.refreshBubbleOverflows();
    this.refreshBubbleOverflowsAfterFonts(renderId);
  }

  // Refresh all overflow warnings after the document has been mounted.
  refreshBubbleOverflows() {
    this.chains.forEach((chain) => {
      chain.bubbles.forEach((bubble) => this.updateBubbleOverflow(bubble, chain.typeSelect.value));
    });
  }

  // Refresh all overflow warnings after the document has been mounted.
  refreshBubbleOverflows() {
    this.chains.forEach((chain) => {
      chain.bubbles.forEach((bubble) => this.updateBubbleOverflow(bubble, chain.typeSelect.value));
    });
  }

  // Refresh rendered widths after import once the dialogue font is ready for scrollWidth.
  refreshBubbleOverflowsAfterFonts(renderId) {
    document.fonts?.ready?.then(() => {
      if (renderId !== this.documentRenderId) return;
      this.refreshBubbleOverflows();
    });
  }

  // Append the bottom "Create Entry" button.
  appendAddChainButton() {
    this.chainList.querySelector("#add-chain-btn")?.remove();
    const btn = document.createElement("div");
    btn.id = "add-chain-btn";
    btn.innerHTML = '<span style="font-size:18px">＋</span> Create Entry';
    btn.addEventListener("click", () => this.createNewChain());
    this.chainList.appendChild(btn);
  }

  // Refresh page separator labels inside one chain.
  updatePageSepLabels(chain) {
    let pageNumber = 1;
    chain.bubbles.forEach((bubble, index) => {
      if (index === 0) {
        if (bubble.pageSep) {
          bubble.pageSep.remove();
          bubble.pageSep = null;
        }
        return;
      }

      if (!bubble.pageSep) {
        const pageSep = document.createElement("div");
        pageSep.className = "page-sep";
        bubble.card.prepend(pageSep);
        bubble.pageSep = pageSep;
      }

      const previousBubble = chain.bubbles[index - 1];
      const previousRaw = previousBubble.content.dataset.raw ?? serializeContent(previousBubble.content);
      const separator = separatorForBubbleBoundary(bubble.joinKind, previousRaw, this.getBubbleLineLimit(chain));

      // A soft split becomes a page break when the previous bubble is no longer full.
      // Everything besides softBreak and pageBreak is a regular "Newline".
      const boundaryName = bubble.joinKind === "softBreak" ? (separator === "\n" ? "Soft split" : "Page break") : bubble.joinKind === "pageBreak" ? "Page break" : "Newline";
      bubble.pageSep.textContent = `↵ Page ${++pageNumber} · ${boundaryName}`;
    });
  }

  // Sync sidebar text for one entry.
  updateSidebarItem(chain) {
    this.updateCompareIssueForChain(chain);
    chain.sidebarItem.querySelector(".sb-label").textContent = chain.labelInput.value || "";
    chain.sidebarItem.querySelector(".sb-attr").textContent = chain.attrInput.value || "";
    chain.sidebarItem.classList.toggle("is-choice", isChoiceLabel(chain.labelInput.value));
    chain.sidebarItem.classList.toggle("has-compare-issue", !!chain.compareIssue);
    chain.sidebarItem.title = chain.compareIssue ? "Changed in modified file" : "";
    if (chain.compareButton) {
      chain.compareButton.hidden = !chain.compareIssue;
      chain.compareButton.title = chain.compareIssue ? `Show diff: ${chain.compareIssue.label}` : "Show diff";
    }
  }

  // Refresh per-chain UI that depends on the current mode.
  updateChainModeUi(chain) {
    chain.attrInput.placeholder =
      this.exportMode === DOC_MODE_AEON
        ? getAeonAttributeKey(this.chains, this.currentDocMode)
        : chain.attrKey || "attributes";
    this.updateSidebarItem(chain);
  }

  // Refresh mode-dependent UI for all chains in one pass.
  refreshChainModeUi() {
    const aeonAttributeKey = this.exportMode === DOC_MODE_AEON ? getAeonAttributeKey(this.chains, this.currentDocMode) : null;
    const showAttribute =
      this.currentDocMode === DOC_MODE_MSYT
        ? getAeonMetaBoolean(this.msytDocInfo.aeonMeta, "hasATR1", msytHasATR1(this.chains))
        : hasATR1(this.currentGame, this.yamlMeta);
    this.chains.forEach((chain) => {
      chain.attrInput.placeholder = this.exportMode === DOC_MODE_AEON ? aeonAttributeKey : chain.attrKey || "attributes";
      chain.attrInput.style.display = showAttribute ? "" : "none";
      this.updateSidebarItem(chain);
    });
  }

  // Refresh all UI that depends on the complete chain list.
  refreshDocumentUi() {
    this.refreshChainModeUi();
    this.refreshChoicePills();
    this.doSearch(this.searchInput.value);
    this.syncEntryUi();
  }

  // Create a user-requested empty chain, then refresh document-wide UI once.
  createNewChain() {
    const chain = this.createChain(this.makeNewEntry());
    this.refreshDocumentUi();
    return chain;
  }

  // Ensure BCML locale/path containers exist before inserting entries.
  ensureBcmlContainers(locale, path, localeGroupId = null, pathGroupId = null) {
    const localeValue = locale;
    const pathValue = path;

    let localeSection = [...this.chainList.children].find(
      (element) => element.classList?.contains("msyt-locale-group") && element.dataset.locale === localeValue && (!localeGroupId || element.dataset.groupId === localeGroupId)
    );
    let sidebarLocaleSection = [...this.sidebar.children].find(
      (element) => element.classList?.contains("sb-tree-locale") && element.dataset.locale === localeValue && (!localeGroupId || element.dataset.groupId === localeGroupId)
    );

    if (!localeSection) {
      localeSection = document.createElement("section");
      localeSection.className = "msyt-locale-group";
      localeSection.dataset.locale = localeValue;
      localeSection.dataset.groupId = localeGroupId || localeValue;

      const localeHeader = document.createElement("div");
      localeHeader.className = "msyt-locale-hdr";

      const localeTitle = document.createElement("div");
      localeTitle.className = "msyt-locale-title";
      localeTitle.textContent = localeValue;

      const localeDelete = document.createElement("button");
      localeDelete.type = "button";
      localeDelete.className = "chain-del";
      localeDelete.title = "Delete entire locale";
      localeDelete.textContent = "×";

      localeHeader.appendChild(localeTitle);
      localeHeader.appendChild(localeDelete);
      localeSection.appendChild(localeHeader);
      this.chainList.appendChild(localeSection);

      sidebarLocaleSection = document.createElement("section");
      sidebarLocaleSection.className = "sb-tree-locale";
      sidebarLocaleSection.dataset.locale = localeValue;
      sidebarLocaleSection.dataset.groupId = localeGroupId || localeValue;

      const sidebarLocaleTitle = document.createElement("div");
      sidebarLocaleTitle.className = "sb-tree-locale-title";
      sidebarLocaleTitle.textContent = localeValue;
      sidebarLocaleSection.appendChild(sidebarLocaleTitle);
      this.sidebar.appendChild(sidebarLocaleSection);

      localeDelete.addEventListener("click", () => this.deleteBcmlLocale(localeSection, sidebarLocaleSection));
    }

    let pathSection = [...localeSection.children].find(
      (element) => element.classList?.contains("msyt-path-group") && element.dataset.path === pathValue && (!pathGroupId || element.dataset.groupId === pathGroupId)
    );
    let sidebarPathSection = [...sidebarLocaleSection.children].find(
      (element) => element.classList?.contains("sb-tree-path") && element.dataset.path === pathValue && (!pathGroupId || element.dataset.groupId === pathGroupId)
    );

    if (!pathSection) {
      pathSection = document.createElement("section");
      pathSection.className = "msyt-path-group";
      pathSection.dataset.locale = localeValue;
      pathSection.dataset.path = pathValue;
      pathSection.dataset.groupId = pathGroupId || pathValue;

      const pathHeader = document.createElement("div");
      pathHeader.className = "msyt-path-hdr";

      const pathTitle = document.createElement("div");
      pathTitle.className = "msyt-path-title";
      pathTitle.textContent = pathValue;

      const pathDelete = document.createElement("button");
      pathDelete.type = "button";
      pathDelete.className = "chain-del";
      pathDelete.title = "Delete entire group";
      pathDelete.textContent = "×";

      pathHeader.appendChild(pathTitle);
      pathHeader.appendChild(pathDelete);
      pathSection.appendChild(pathHeader);
      localeSection.appendChild(pathSection);

      sidebarPathSection = document.createElement("section");
      sidebarPathSection.className = "sb-tree-path";
      sidebarPathSection.dataset.locale = localeValue;
      sidebarPathSection.dataset.path = pathValue;
      sidebarPathSection.dataset.groupId = pathGroupId || pathValue;

      const sidebarPathTitle = document.createElement("div");
      sidebarPathTitle.className = "sb-tree-path-title";
      sidebarPathTitle.textContent = pathValue;

      const sidebarItems = document.createElement("div");
      sidebarItems.className = "sb-tree-items";

      sidebarPathSection.appendChild(sidebarPathTitle);
      sidebarPathSection.appendChild(sidebarItems);
      sidebarLocaleSection.appendChild(sidebarPathSection);

      pathDelete.addEventListener("click", () =>
        this.deleteBcmlPath(pathSection, sidebarPathSection, localeSection, sidebarLocaleSection)
      );
    }

    return {
      parent: pathSection,
      sidebarParent: sidebarPathSection.querySelector(".sb-tree-items"),
      localeSection,
      pathSection,
      sidebarLocaleSection,
      sidebarPathSection,
      localeGroupId: localeSection.dataset.groupId,
      pathGroupId: pathSection.dataset.groupId
    };
  }

  // Remove now-empty BCML wrapper containers.
  cleanupBcmlContainers(chain) {
    if (chain.pathSection && !chain.pathSection.querySelector(".chain")) {
      chain.pathSection.remove();
      chain.sidebarPathSection?.remove();
    }
    if (chain.localeSection && !chain.localeSection.querySelector(".msyt-path-group")) {
      chain.localeSection.remove();
      chain.sidebarLocaleSection?.remove();
    }
  }

  // Remove one chain from DOM and state.
  removeChain(chain) {
    chain.section.remove();
    chain.sidebarItem.remove();
    this.chains = this.chains.filter((item) => item !== chain);
  }

  // Delete a whole BCML locale group.
  deleteBcmlLocale(localeSection, sidebarLocaleSection) {
    const doomed = this.chains.filter((chain) => chain.localeSection === localeSection);
    doomed.forEach((chain) => this.removeChain(chain));
    localeSection.remove();
    sidebarLocaleSection?.remove();
    this.syncEntryUi();
    this.doSearch(this.searchInput.value);
    this.setStatus("Locale deleted");
  }

  // Delete a whole BCML path group.
  deleteBcmlPath(pathSection, sidebarPathSection, localeSection, sidebarLocaleSection) {
    const doomed = this.chains.filter((chain) => chain.pathSection === pathSection);
    doomed.forEach((chain) => this.removeChain(chain));
    pathSection.remove();
    sidebarPathSection?.remove();
    if (localeSection && !localeSection.querySelector(".msyt-path-group")) {
      localeSection.remove();
      sidebarLocaleSection?.remove();
    }
    this.syncEntryUi();
    this.doSearch(this.searchInput.value);
    this.setStatus("Group deleted");
  }

  // Create one entry section and all of its bubbles.
  createChain(entry = this.makeNewEntry(), containers = null) {
    const isMsyt = this.currentDocMode === DOC_MODE_MSYT || this.currentDocMode === DOC_MODE_BCML;
    const isBcml = this.currentDocMode === DOC_MODE_BCML;
    const isChoice = isChoiceLabel(entry.label);
    const bubbleType = isChoice ? "choice" : entry.bubbleType || (isBcml ? inferBcmlBubbleTypeFromPath(entry.bcmlPath) : "dialogue");
    const bcmlContainers =
      containers || (isBcml ? this.ensureBcmlContainers(entry.bcmlLocale, entry.bcmlPath, entry.bcmlLocaleGroupId, entry.bcmlPathGroupId) : null);
    const chainId = `chain-${crypto.randomUUID()}`;
    const section = document.createElement("section");
    section.className = "chain";
    section.dataset.chainId = chainId;

    const sidebarItem = document.createElement("div");
    sidebarItem.className = `sb-item${isChoice ? " is-choice" : ""}`;
    sidebarItem.dataset.chainId = chainId;
    sidebarItem.innerHTML = `<span class="sb-label">${escapeHtml(entry.label || "")}</span><span class="sb-attr">${escapeHtml(entry.attrVal || "")}</span>`;
    sidebarItem.addEventListener("click", () => section.scrollIntoView({ behavior: "smooth", block: "start" }));
    (bcmlContainers?.sidebarParent || this.sidebar).appendChild(sidebarItem);

    const header = document.createElement("div");
    header.className = "chain-hdr";
    header.innerHTML = `
      <button type="button" class="compare-alert" title="Show diff" hidden>!</button>
      <input class="chain-label" placeholder="label" value="${escapeHtml(entry.label || "")}">
      <input class="chain-attr" placeholder="${escapeHtml(entry.attrKey || "attributeText")}" value="${escapeHtml(entry.attrVal || "")}">
      <select class="type-sel"></select>
      <button type="button" class="chain-del" title="Delete entry">×</button>
    `;
    section.appendChild(header);

    const compareButton = header.querySelector(".compare-alert");
    const labelInput = header.querySelector(".chain-label");
    const attrInput = header.querySelector(".chain-attr");
    const typeSelect = header.querySelector(".type-sel");
    const deleteBtn = header.querySelector(".chain-del");

    Object.keys(BubbleType).forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = BubbleType[value]?.label || value;
      typeSelect.appendChild(option);
    });
    typeSelect.value = bubbleType;

    const bubbleList = document.createElement("div");
    bubbleList.className = "bubble-list";
    section.appendChild(bubbleList);

    const choicePills = document.createElement("div");
    choicePills.className = "choice-pills";
    section.appendChild(choicePills);

    const chain = {
      id: chainId,
      section,
      bubbleList,
      choicePills,
      labelInput,
      attrInput,
      typeSelect,
      compareButton,
      sidebarItem,
      bubbles: [],
      attrKey: entry.attrKey || (this.currentDocMode === DOC_MODE_AEON ? "attributeText" : "attributes"),
      msytHasAttributes: !!entry.msytHasAttributes,
      docKey: entry.docKey || null,
      ...(isBcml
        ? {
            bcmlLocale: entry.bcmlLocale,
            bcmlPath: entry.bcmlPath,
            bcmlLocaleGroupId: entry.bcmlLocaleGroupId || bcmlContainers?.localeGroupId || null,
            bcmlPathGroupId: entry.bcmlPathGroupId || bcmlContainers?.pathGroupId || null
          }
        : {}),
      localeSection: bcmlContainers?.localeSection || null,
      pathSection: bcmlContainers?.pathSection || null,
      sidebarLocaleSection: bcmlContainers?.sidebarLocaleSection || null,
      sidebarPathSection: bcmlContainers?.sidebarPathSection || null
    };
    this.chains.push(chain);
    (bcmlContainers?.parent || this.chainList).appendChild(section);

    labelInput.addEventListener("input", () => {
      this.updateSidebarItem(chain);
      this.refreshChoicePills();
      this.doSearch(this.searchInput.value);
    });
    attrInput.addEventListener("input", () => {
      chain.msytHasAttributes = chain.msytHasAttributes || attrInput.value !== "";
      this.updateSidebarItem(chain);
      this.doSearch(this.searchInput.value);
    });
    typeSelect.addEventListener("change", () => this.applyChainType(chain, typeSelect.value));
    compareButton.addEventListener("click", () => this.openCompareIssue(chain));
    deleteBtn.addEventListener("click", () => this.deleteChain(chain));

    const pages = splitPages(entry.content);
    pages.forEach((page, index) => this.addBubble(chain, page, null, index === 0 ? null : "pageBreak"));
    this.applyChainType(chain, bubbleType, true);
    if (this.autoSplit && this.canAutoSplitChain(chain)) {
      const snapshot = [...chain.bubbles];
      snapshot.forEach((bubble) => {
        const raw = bubble.content.dataset.raw ?? serializeContent(bubble.content);
        if (raw.split("\n").length > 3) this.autoSplitBubble(bubble);
      });
    }
    return chain;
  }

  // Delete one entry chain.
  deleteChain(chain) {
    this.removeChain(chain);
    if (this.currentDocMode === DOC_MODE_BCML) this.cleanupBcmlContainers(chain);
    this.refreshChoicePills();
    this.syncEntryUi();
    this.doSearch(this.searchInput.value);
    this.setStatus("Entry deleted");
  }

  // Apply a bubble type to all bubbles in a chain.
  applyChainType(chain, type, initial = false) {
    const config = BubbleType[type];
    if (!config) return;
    chain.section.dataset.type = type;
    chain.bubbles.forEach((bubble) => this.applyBubbleType(bubble, type));
    // this.setStatus(`Type: ${type}`);
  }

  // Apply one bubble type to one rendered bubble.
  applyBubbleType(bubble, type) {
    const config = BubbleType[type];
    if (!config) return;
    const bubbleEl = bubble.bubble;
    bubbleEl.dataset.type = type;
    bubbleEl.className = `bubble ${config.className}`;
    bubble.card.dataset.type = type;
    this.updateBubbleOverflow(bubble, type);
  }

  // Remember the raw-side intent for the next collapsed caret/input near hidden tags.
  setCollapsedCaretBias(content, bias) {
    if (!content) return;
    content._nextInputCollapsedBias = bias || null;
  }

  // Re-derive that before/after intent from the current DOM selection after mouse placement.
  syncCollapsedCaretBiasFromSelection(content, fallback = content?._nextInputCollapsedBias || "after") {
    if (!content) return;
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.setCollapsedCaretBias(content, null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !content.contains(range.startContainer) || !content.contains(range.endContainer)) {
      this.setCollapsedCaretBias(content, null);
      return;
    }
    this.setCollapsedCaretBias(content, inferCollapsedCaretBias(content, range, fallback));
  }

  // Skip across contiguous tag markers when a visible offset lands on a hidden-tag boundary.
  findTagBoundaryCaretPosition(node, dir) {
    let current = node;
    let parent = current?.parentNode;
    while (parent && parent.nodeType === Node.ELEMENT_NODE) {
      const siblings = Array.from(parent.childNodes);
      const index = siblings.indexOf(current);
      if (index < 0) return null;
      let cursor = index + (dir > 0 ? 1 : -1);
      let sawTag = false;
      while (cursor >= 0 && cursor < siblings.length) {
        if (!isRawTagNode(siblings[cursor])) break;
        sawTag = true;
        cursor += dir;
      }
      if (sawTag) {
        return { node: parent, offset: dir > 0 ? cursor : cursor + 1 };
      }
      current = parent;
      parent = parent.parentNode;
    }
    return null;
  }

  // Place the caret at the visible start or end of a bubble.
  placeCaretAtBoundary(content, atStart) {
    const target = content.firstElementChild || content.appendChild(document.createElement("div"));
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(atStart ? target : content.lastElementChild || target);
    range.collapse(atStart);
    selection.removeAllRanges();
    selection.addRange(range);
    this.setCollapsedCaretBias(content, atStart ? "before" : "after");
  }

  // Restore a collapsed caret from a visible-text offset.
  setCaretAtVisibleOffset(content, offset, bias = content._nextInputCollapsedBias || "after") {
    const blocks = Array.from(content.childNodes);
    let remaining = Math.max(0, offset);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      if (blockIndex > 0) {
        remaining -= 1;
        if (remaining <= 0) {
          const range = document.createRange();
          range.selectNodeContents(block);
          range.collapse(bias !== "after");
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          this.setCollapsedCaretBias(content, bias);
          return;
        }
      }
      if (block.nodeType === Node.TEXT_NODE) {
        const len = block.textContent?.length || 0;
        if (remaining <= len) {
          const range = document.createRange();
          // At text edges, preserve whether the caret belongs before or after adjacent hidden tags.
          if (remaining === len && bias === "after") {
            const pos = this.findTagBoundaryCaretPosition(block, 1);
            if (pos) range.setStart(pos.node, pos.offset);
            else range.setStart(block, remaining);
          } else if (remaining === 0 && bias === "before") {
            const pos = this.findTagBoundaryCaretPosition(block, -1);
            if (pos) range.setStart(pos.node, pos.offset);
            else range.setStart(block, remaining);
          } else {
            range.setStart(block, remaining);
          }
          range.collapse(true);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          this.setCollapsedCaretBias(content, bias);
          return;
        }
        remaining -= len;
        continue;
      }
      if (block.nodeType !== Node.ELEMENT_NODE) continue;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const len = node.textContent?.length || 0;
        if (remaining <= len) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.collapse(true);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        remaining -= len;
        node = walker.nextNode();
      }
      if (!remaining) {
        const range = document.createRange();
        range.selectNodeContents(block);
        const hasMarkerChild = Array.from(block.childNodes).some(
          (child) => child.nodeType === Node.ELEMENT_NODE && child.dataset?.rawTag != null
        );
        // Empty visual blocks can still contain hidden markers, so collapse using the saved bias.
        range.collapse(hasMarkerChild ? bias !== "after" : true);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        this.setCollapsedCaretBias(content, hasMarkerChild ? bias : "after");
        return;
      }
    }
    this.placeCaretAtBoundary(content, false);
  }

  // Map a visible-text offset back to a DOM node/offset pair.
  locateVisibleDomPosition(content, offset) {
    const blocks = Array.from(content.childNodes);
    let remaining = Math.max(0, offset);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      if (blockIndex > 0) {
        remaining -= 1;
        if (remaining <= 0) return { node: block, offset: 0 };
      }
      if (block.nodeType === Node.TEXT_NODE) {
        const len = block.textContent?.length || 0;
        if (remaining <= len) return { node: block, offset: remaining };
        remaining -= len;
        continue;
      }
      if (block.nodeType !== Node.ELEMENT_NODE) continue;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const len = node.textContent?.length || 0;
        if (remaining <= len) return { node, offset: remaining };
        remaining -= len;
        node = walker.nextNode();
      }
      if (!remaining) {
        const hasMarkerChild = Array.from(block.childNodes).some(
          (child) => child.nodeType === Node.ELEMENT_NODE && child.dataset?.rawTag != null
        );
        return { node: block, offset: hasMarkerChild ? block.childNodes.length : 0 };
      }
    }
    return { node: content, offset: content.childNodes.length };
  }

  // Restore a range selection from visible-text offsets.
  setSelectionVisibleOffsets(content, start, end) {
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (from === to) {
      this.setCaretAtVisibleOffset(content, from);
      return;
    }
    const startPos = this.locateVisibleDomPosition(content, from);
    const endPos = this.locateVisibleDomPosition(content, to);
    if (!startPos?.node || !endPos?.node) return;
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    this.setCollapsedCaretBias(content, null);
  }

  // Place the caret from mouse coordinates, with fallbacks.
  placeCaretFromPoint(content, clientX, clientY) {
    const selection = getSelection();
    let placed = false;

    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos && content.contains(pos.offsetNode)) {
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        this.syncCollapsedCaretBiasFromSelection(content);
        placed = true;
      }
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (range && content.contains(range.startContainer)) {
        selection.removeAllRanges();
        selection.addRange(range);
        this.syncCollapsedCaretBiasFromSelection(content);
        placed = true;
      }
    }

    if (placed) return;

    const blocks = [...content.children];
    if (!blocks.length) {
      this.placeCaretAtBoundary(content, true);
      return;
    }

    const firstRect = blocks[0].getBoundingClientRect();
    const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
    if (clientX <= firstRect.left || clientY <= firstRect.top) {
      this.placeCaretAtBoundary(content, true);
      return;
    }
    if (clientX >= lastRect.right || clientY >= lastRect.bottom) {
      this.placeCaretAtBoundary(content, false);
      return;
    }

    const contentRect = content.getBoundingClientRect();
    this.placeCaretAtBoundary(content, clientX <= contentRect.left + contentRect.width / 2);
  }

  // Convert a mouse point to a visible-text offset.
  getVisibleOffsetFromPoint(content, clientX, clientY) {
    this.placeCaretFromPoint(content, clientX, clientY);
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return 0;
    return getSelectionTextOffsets(content, range).startOff;
  }

  // Re-render one bubble from a raw undo/redo snapshot.
  restoreUndoState(content, state) {
    const raw = typeof state === "string" ? state : state.raw;
    renderRawToContent(content, raw);
    content.dataset.raw = raw;
    content.focus();
    if (typeof state !== "string") {
      this.setCaretAtVisibleOffset(content, Math.min(state.caret, rawToPlainText(raw).length), state.bias || "after");
    }
    const bubbleRecord = this.findBubbleByContent(content);
    if (!bubbleRecord) return;
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(bubbleRecord.chain);
    this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
    this.updatePageSepLabels(bubbleRecord.chain);
  }

  // Apply one undo step to a bubble.
  doUndo(content) {
    const stack = getUndoStack(content);
    if (!stack.length) return;
    const current = content.dataset.raw ?? serializeContent(content);
    getRedoStack(content).push(makeUndoState(content, current));
    this.restoreUndoState(content, stack.pop());
  }

  // Apply one redo step to a bubble.
  doRedo(content) {
    const stack = getRedoStack(content);
    if (!stack.length) return;
    const current = content.dataset.raw ?? serializeContent(content);
    getUndoStack(content).push(makeUndoState(content, current));
    this.restoreUndoState(content, stack.pop());
  }

  // Create and mount one bubble card inside a chain.
  addBubble(chain, raw = "", afterBubble = null, joinKind = "pageBreak") {
    const card = document.createElement("div");
    card.className = "bubble-card bubble-outer";

    const metaBar = document.createElement("div");
    metaBar.className = "meta-bar";
    card.appendChild(metaBar);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = `<div class="bubble-content" contenteditable="true"><\/div>`;
    const fmtPopup = document.createElement("div");
    fmtPopup.className = "fmt-popup";
    this.buildFmtPopup(fmtPopup);
    bubble.appendChild(fmtPopup);
    card.appendChild(bubble);

    const bubbleButtons = document.createElement("div");
    bubbleButtons.className = "bub-btns";
    bubbleButtons.innerHTML = `
      <button class="bub-btn btn-add-bubble" title="Add page">+<\/button>
      <button class="bub-btn del btn-del-bubble" title="Delete page">×<\/button>
    `;
    card.appendChild(bubbleButtons);

    const content = bubble.querySelector(".bubble-content");
    renderRawToContent(content, raw);

    const bubbleRecord = {
      chain,
      card,
      bubble,
      fmtPopup,
      metaBar,
      content,
      pageSep: null,
      joinKind: afterBubble || chain.bubbles.length ? joinKind || "pageBreak" : null
    };

    const insertIndex = afterBubble ? chain.bubbles.indexOf(afterBubble) + 1 : chain.bubbles.length;
    if (afterBubble && afterBubble.card.nextSibling) {
      chain.bubbleList.insertBefore(card, afterBubble.card.nextSibling);
    } else {
      chain.bubbleList.appendChild(card);
    }
    chain.bubbles.splice(insertIndex, 0, bubbleRecord);
    if (chain.bubbles[0]) chain.bubbles[0].joinKind = null;
    this.updatePageSepLabels(chain);

    bubbleButtons.querySelector(".btn-add-bubble").addEventListener("click", () => this.addBubble(chain, "", bubbleRecord, "pageBreak"));
    bubbleButtons.querySelector(".btn-del-bubble").addEventListener("click", () => this.deleteBubble(bubbleRecord));

    bubble.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".bub-btn")) return;
      const marker = event.target.closest(".tag-node, .pause-node");
      const isDirectSurface = event.target === bubble || event.target === content;
      if (marker || isDirectSurface) {
        // Clicking a marker or empty bubble surface should still focus the real text layer.
        event.preventDefault();
        content.focus();
        const anchor = this.getVisibleOffsetFromPoint(content, event.clientX, event.clientY);
        this.surfaceDragSelection = { content, anchor };
        if (!content.firstElementChild?.textContent && !content.textContent) {
          const target = content.firstElementChild || content.appendChild(document.createElement("div"));
          const selection = getSelection();
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });

    content.addEventListener("focus", () => {
      this.activeContent = content;
      this.captureTagSelection(content, true);
      this.checkFmtSel(content, fmtPopup);
    });
    content.addEventListener("beforeinput", (event) => {
      // Handle newline and marker-edge deletes in raw first; native contenteditable gets these wrong.
      content._pendingInputEdit = null;
      capturePendingInputEdit(content, event.inputType);
      const selection = getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return;
      const { startOff, endOff } = getSelectionTextOffsets(content, range);
      const raw = content.dataset.raw ?? "";
      const plain = rawToPlainText(raw);

      if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
        event.preventDefault();
        saveUndo(content);
        content._pendingInputEdit = null;
        const nextRaw = spliceVisibleRange(raw, startOff, endOff, "\n", "after");
        this.applyContentRawEdit(bubbleRecord, nextRaw, startOff + 1);
        return;
      }

      if ((event.inputType === "deleteContentBackward" || event.inputType === "deleteContentForward") && startOff === endOff) {
        const deleteStart = event.inputType === "deleteContentBackward" ? Math.max(0, startOff - 1) : startOff;
        const deleteEnd = event.inputType === "deleteContentBackward" ? startOff : Math.min(startOff + 1, plain.length);
        if (plain.slice(deleteStart, deleteEnd) === "\n") {
          event.preventDefault();
          saveUndo(content);
          content._pendingInputEdit = null;
          const nextRaw = spliceVisibleRange(raw, deleteStart, deleteEnd, "");
          this.applyContentRawEdit(bubbleRecord, nextRaw, deleteStart);
          return;
        }
      }

      if (
        ["insertText", "insertLineBreak", "insertParagraph", "deleteContentBackward", "deleteContentForward", "deleteByCut", "insertFromPaste"].includes(
          event.inputType
        )
      ) {
        saveUndo(content);
      }
      if (event.inputType !== "deleteContentBackward" && event.inputType !== "deleteContentForward") return;
      if (startOff !== endOff) return;
      const tag = getBoundaryTag(raw, startOff, event.inputType === "deleteContentBackward" ? -1 : 1);
      if (!tag) return;
      if (isProtectedDeleteTag(tag)) return;
      // Marker deletes are handled in raw so browser DOM deletion cannot desync the tag layer.
      event.preventDefault();
      content._pendingInputEdit = null;
      saveUndo(content);
      const nextRaw = removeTagAndPairedReset(raw, tag);
      renderRawToContent(content, nextRaw);
      content.dataset.raw = nextRaw;
      content.focus();
      this.setCaretAtVisibleOffset(content, Math.min(startOff, rawToPlainText(nextRaw).length));
      this.syncMetaBar(bubbleRecord);
      this.refreshChoicePills(chain);
      this.updateBubbleOverflow(bubbleRecord, chain.typeSelect.value);
      this.checkFmtSel(content, fmtPopup);
    });
    content.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ" && !event.shiftKey) {
        event.preventDefault();
        this.doUndo(content);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.code === "KeyY" || (event.shiftKey && event.code === "KeyZ"))) {
        event.preventDefault();
        this.doRedo(content);
        return;
      }
      if (event.code === "Enter" && event.ctrlKey && !event.altKey) {
        event.preventDefault();
        this.addBubble(chain, "", bubbleRecord, "pageBreak");
      }
    });
    content.addEventListener("keyup", () => {
      if (content.childNodes.length === 0) {
        const newDiv = document.createElement("div");
        content.appendChild(newDiv);
        getSelection().getRangeAt(0).setStart(newDiv, 0);
      } else if (content.childNodes.length === 1 && !content.firstElementChild) {
        const newDiv = document.createElement("div");
        newDiv.textContent = content.textContent;
        content.textContent = "";
        content.appendChild(newDiv);
        getSelection().getRangeAt(0).selectNodeContents(newDiv);
        getSelection().collapseToEnd();
      }
      this.captureTagSelection(content, true);
      this.checkFmtSel(content, fmtPopup);
    });
    content.addEventListener("mouseup", () => {
      this.captureTagSelection(content, true);
      this.checkFmtSel(content, fmtPopup);
    });
    content.addEventListener("blur", () => {
      ensureEditableStructure(content);
      content._pendingInputEdit = null;
      fmtPopup.classList.remove("show");
    });
    content.addEventListener("input", () => {
      this.syncBubbleState(bubbleRecord);
      this.checkFmtSel(content, fmtPopup);
    });
    content.addEventListener("paste", (event) => this.insertPlaintext(event));
    content.addEventListener("drop", (event) => this.insertPlaintext(event));
    content.addEventListener("dblclick", (event) => {
      const tag = event.target.closest(".tag-token");
      if (tag) this.openRaw(bubbleRecord);
    });

    this.syncBubbleState(bubbleRecord);
    this.applyBubbleType(bubbleRecord, chain.typeSelect.value);
    return bubbleRecord;
  }

  // Delete one bubble card from a chain.
  deleteBubble(bubbleRecord) {
    const { chain, card } = bubbleRecord;
    chain.bubbles = chain.bubbles.filter((item) => item !== bubbleRecord);
    card.remove();
    if (!chain.bubbles.length) {
      this.addBubble(chain, "");
    }
    if (chain.bubbles[0]) chain.bubbles[0].joinKind = null;
    this.updatePageSepLabels(chain);
    this.applyChainType(chain, chain.typeSelect.value, true);
    this.setStatus("Bubble deleted");
  }

  // Paste/drop plain text without rich formatting.
  insertPlaintext(event) {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? event.dataTransfer?.getData("text/plain") ?? "";
    if (!text) return;
    const content = event.currentTarget;
    if (!content?.classList?.contains("bubble-content")) return;
    const bubbleRecord = this.findBubbleByContent(content);
    if (!bubbleRecord) return;
    if (event.type === "drop") {
      this.placeCaretFromPoint(content, event.clientX, event.clientY);
    }
    capturePendingInputEdit(content, "insertFromPaste");
    const pendingEdit = content._pendingInputEdit || null;
    if (!pendingEdit) return;
    const raw = content.dataset.raw ?? serializeContent(content);
    const start = pendingEdit.start;
    const editRawStart = pendingEdit.rawStart;
    const editRawEnd = pendingEdit.rawEnd;
    saveUndo(content);
    content._pendingInputEdit = null;
    const nextRaw = `${raw.slice(0, editRawStart)}${text}${raw.slice(editRawEnd)}`;
    this.applyContentRawEdit(bubbleRecord, nextRaw, start + text.length);
  }

  // Apply a raw edit and refresh all dependent bubble UI.
  applyContentRawEdit(bubbleRecord, nextRaw, caretOffset) {
    const { content, chain, fmtPopup } = bubbleRecord;
    renderRawToContent(content, nextRaw);
    content.dataset.raw = nextRaw;
    content.focus();
    this.setCaretAtVisibleOffset(content, Math.min(caretOffset, rawToPlainText(nextRaw).length));
    this.captureTagSelection(content, true);
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(chain);
    this.updateBubbleOverflow(bubbleRecord, chain.typeSelect.value);
    this.updatePageSepLabels(chain);
    this.checkFmtSel(content, fmtPopup);
  }

  // Apply inline color/size formatting to the active selection.
  applyFormat(type, value) {
    const content = this.activeContent;
    if (!content) return;
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return;

    const { startOff, endOff } = getSelectionTextOffsets(content, range);
    const bubbleRecord = this.findBubbleByContent(content);
    if (!bubbleRecord) return;
    const raw = content.dataset.raw ?? serializeContent(content);

    if (startOff === endOff) {
      if (value == null) return;
      saveUndo(content);
      const nextRaw = spliceVisibleRange(raw, startOff, endOff, FORMAT_DEFS[type].emitTag(value));
      renderRawToContent(content, nextRaw);
      content.dataset.raw = nextRaw;
      content.focus();
      this.setCaretAtVisibleOffset(content, startOff);
      this.syncMetaBar(bubbleRecord);
      this.refreshChoicePills(bubbleRecord.chain);
      this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
      bubbleRecord.fmtPopup?.classList.remove("show");
      return;
    }

    saveUndo(content);
    const nextRaw = applyFormatToRange(raw, startOff, endOff, type, value);
    renderRawToContent(content, nextRaw);
    content.dataset.raw = nextRaw;
    content.focus();
    this.setCaretAtVisibleOffset(content, endOff);
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(bubbleRecord.chain);
    this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
    this.updatePageSepLabels(bubbleRecord.chain);
    bubbleRecord.fmtPopup?.classList.remove("show");
  }

  syncBubbleState(bubbleRecord) {
    // Rebuild raw from the visible-text edit delta instead of trusting DOM order.
    const content = bubbleRecord.content;
    // Capture the current visible selection before rerendering the bubble from rebuilt raw.
    const selection = getSelection();
    let selectionOffsets = null;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (content.contains(range.startContainer) && content.contains(range.endContainer)) {
        selectionOffsets = getSelectionTextOffsets(content, range);
      }
    }
    const isIsolatedBreak = content.innerHTML === "<br>";
    const isIsolatedBreakNode =
      content.childElementCount === 1 &&
      content.firstElementChild &&
      content.firstElementChild.innerHTML === "<br>";
    if (isIsolatedBreak || isIsolatedBreakNode) {
      content.innerHTML = "";
    }
    const previousRaw = bubbleRecord.content.dataset.raw ?? "";
    const previousPlain = rawToPlainText(previousRaw);
    const nextPlain = contentToPlainText(bubbleRecord.content);
    const pendingEdit = content._pendingInputEdit || null;
    content._pendingInputEdit = null;
    let nextRaw = previousRaw;

    if (previousPlain !== nextPlain) {
      let prefix = 0;
      let oldSuffix = previousPlain.length;
      let newSuffix = nextPlain.length;

      if (pendingEdit && ["deleteContentBackward", "deleteContentForward", "deleteByCut"].includes(pendingEdit.inputType)) {
        prefix = pendingEdit.start;
        oldSuffix = pendingEdit.end;
        newSuffix = pendingEdit.start;
        nextRaw = spliceVisibleRange(previousRaw, pendingEdit.start, pendingEdit.end, "");
      } else if (pendingEdit && ["insertText", "insertLineBreak", "insertParagraph", "insertFromPaste"].includes(pendingEdit.inputType)) {
        prefix = pendingEdit.start;
        oldSuffix = pendingEdit.end;
        // The browser mutates visible text first; derive the inserted plain-text slice from that delta.
        const insertedLen = Math.max(0, nextPlain.length - (previousPlain.length - (pendingEdit.end - pendingEdit.start)));
        const insertedText = nextPlain.slice(pendingEdit.start, pendingEdit.start + insertedLen);
        newSuffix = pendingEdit.start + insertedText.length;
        nextRaw = spliceVisibleRange(previousRaw, pendingEdit.start, pendingEdit.end, insertedText, "after");
      } else {
        while (prefix < previousPlain.length && prefix < nextPlain.length && previousPlain[prefix] === nextPlain[prefix]) prefix++;
        while (oldSuffix > prefix && newSuffix > prefix && previousPlain[oldSuffix - 1] === nextPlain[newSuffix - 1]) {
          oldSuffix--;
          newSuffix--;
        }
        nextRaw = spliceVisibleRange(previousRaw, prefix, oldSuffix, nextPlain.slice(prefix, newSuffix));
      }
      nextRaw = normalizeLeadingFormatDeletion(previousRaw, nextRaw, pendingEdit, prefix, oldSuffix, newSuffix);
      bubbleRecord.content.dataset.raw = nextRaw;
    } else {
      nextRaw = previousRaw || serializeContent(bubbleRecord.content);
      bubbleRecord.content.dataset.raw = nextRaw;
    }

    // Re-render once from canonical raw, then restore the same visible selection/caret intent.
    renderRawToContent(content, nextRaw);
    if (selectionOffsets) {
      const plainLength = rawToPlainText(nextRaw).length;
      const start = Math.min(selectionOffsets.startOff, plainLength);
      const end = Math.min(selectionOffsets.endOff, plainLength);
      content.focus();
      if (start === end) {
        // Reapply the same visible offset together with the hidden-tag side captured before rerender.
        this.setCaretAtVisibleOffset(content, start, pendingEdit?.collapsedBias || content._nextInputCollapsedBias || "after");
      } else {
        this.setSelectionVisibleOffsets(content, start, end);
      }
    }
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(bubbleRecord.chain);
    this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
    this.updatePageSepLabels(bubbleRecord.chain);
  }

  refreshChoicePills(targetChain = null) {
    // Choice tags are shown below the entry as quick links to target labels.
    const chains = targetChain ? [targetChain] : this.chains;
    chains.forEach((chain) => {
      if (!chain.choicePills) return;
      chain.choicePills.innerHTML = "";
      const allRaw = chain.bubbles.map((bubble) => bubble.content.dataset.raw ?? serializeContent(bubble.content)).join("");
      const refs = [...allRaw.matchAll(/label\d*="(\d+)"/g)].map((match) => match[1]).filter((value, index, arr) => arr.indexOf(value) === index);
      if (!refs.length) return;
      refs.forEach((ref) => {
        const sameFile = this.chains.find(
          (candidate) =>
            candidate !== chain &&
            candidate.bcmlLocaleGroupId === chain.bcmlLocaleGroupId &&
            candidate.bcmlPathGroupId === chain.bcmlPathGroupId &&
            (candidate.labelInput.value === ref || candidate.labelInput.value === ref.padStart(4, "0"))
        );
        const target =
          sameFile ||
          this.chains.find(
            (candidate) => candidate !== chain && (candidate.labelInput.value === ref || candidate.labelInput.value === ref.padStart(4, "0"))
          );
        let text = ref;
        if (target?.bubbles?.[0]) {
          const firstRaw = target.bubbles[0].content.dataset.raw ?? serializeContent(target.bubbles[0].content);
          text = rawToPlainText(firstRaw).trim() || ref;
        }
        const pill = document.createElement("div");
        pill.className = "choice-pill";
        pill.textContent = text;
        pill.title = `label: ${ref}`;
        pill.addEventListener("click", () => {
          if (target) {
            target.section.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          const padded = ref.padStart(4, "0");
          const fallback = this.chains.find((candidate) => candidate.labelInput.value === padded || candidate.labelInput.value === ref);
          fallback?.section.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        chain.choicePills.appendChild(pill);
      });
    });
  }

  // Decide whether autosplit is allowed for this chain.
  canAutoSplitChain(chain) {
    return canAutoSplitDocument(this.currentDocMode, chain.bcmlPath);
  }

  // Return the line cap for the chain's current bubble type.
  getBubbleLineLimit(chain) {
    const type = chain?.typeSelect?.value || "dialogue";
    return BubbleType[type]?.lineCount ?? 3;
  }

  // Split oversized bubble text into following bubbles.
  autoSplitBubble(bubbleRecord) {
    if (!this.autoSplit || !this.canAutoSplitChain(bubbleRecord.chain)) return;
    const raw = bubbleRecord.content.dataset.raw ?? serializeContent(bubbleRecord.content);
    const limit = this.getBubbleLineLimit(bubbleRecord.chain);
    const split = splitRawAtLineLimit(raw, limit);
    if (!split) return;
    const { keepRaw, overflowRaw } = split;
    renderRawToContent(bubbleRecord.content, keepRaw);
    bubbleRecord.content.dataset.raw = keepRaw;
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(bubbleRecord.chain);
    this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
    const newBubble = this.addBubble(bubbleRecord.chain, overflowRaw, bubbleRecord, this.importSettings.autoSplitJoinKind());
    if (newBubble) this.autoSplitBubble(newBubble);
  }

  syncMetaBar(bubbleRecord) {
    // Non-format tags are surfaced here as chips instead of inline text.
    const raw = bubbleRecord.content.dataset.raw ?? serializeContent(bubbleRecord.content);
    const tags = parseRawTags(raw).filter((tag) => tag.name !== "color" && tag.name !== "size");
    bubbleRecord.metaBar.innerHTML = "";
    tags.forEach((tag, tagIndex) => {
      const chip = document.createElement("button");
      chip.className = "meta-btn";
      chip.type = "button";
      const color = tagColor(tag.name);
      chip.style.borderColor = color;
      chip.style.color = color;
      if (tag.name.startsWith("setEmotion")) chip.textContent = String(tag.args.emotion || "?");
      else if (tag.name === "setVoice") chip.textContent = `🔊 ${tag.args.asset || "?"}`;
      else if (tag.name === "animation") chip.textContent = `🎬 ${tag.args.name || "?"}`;
      else chip.textContent = tagSummary(tag.rawTag);
      chip.title = tag.rawTag;
      chip.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.openTE({ bubbleRecord, tagIndex, rawTag: tag.rawTag });
      });
      bubbleRecord.metaBar.appendChild(chip);
    });
  }

  // Mark a bubble as overflowed when it exceeds type limits.
  updateBubbleOverflow(bubbleRecord, type) {
    if (this.isImportingDocument) return;
    const config = BubbleType[type];
    const content = bubbleRecord.content;
    let charCount = 0;
    for (const block of content.childNodes) {
      charCount += block.textContent.length;
    }
    content.classList.add("test-line-count");
    let lineCount = 0;
    for (const block of content.children) {
      lineCount += block.getClientRects().length;
    }
    content.classList.remove("test-line-count");
    const overflow = lineCount > config.lineCount || (config.charLimit && charCount > config.charLimit) || (config.scrollWidth != null && content.scrollWidth > config.scrollWidth);
    bubbleRecord.bubble.classList.toggle("overflow", overflow);
  }

  // Open the raw tag/text editor for one bubble.
  openRaw(bubbleRecord) {
    this.rawTarget = bubbleRecord;
    this.rawTextarea.value = bubbleRecord.content.dataset.raw ?? serializeContent(bubbleRecord.content);
    this.rawModal.classList.add("open");
    this.rawTextarea.focus();
  }

  // Close the raw editor modal.
  closeRaw() {
    this.rawModal.classList.remove("open");
    this.rawTarget = null;
  }

  // Apply raw editor changes back to the bubble.
  applyRaw() {
    if (!this.rawTarget) return;
    saveUndo(this.rawTarget.content);
    renderRawToContent(this.rawTarget.content, this.rawTextarea.value);
    this.rawTarget.content.dataset.raw = this.rawTextarea.value;
    this.syncMetaBar(this.rawTarget);
    this.refreshChoicePills(this.rawTarget.chain);
    this.updateBubbleOverflow(this.rawTarget, this.rawTarget.chain.typeSelect.value);
    this.updatePageSepLabels(this.rawTarget.chain);
    this.closeRaw();
    this.setStatus("Raw applied");
  }

  // Open the tag editor for one rendered tag.
  openTE(target) {
    this.editTarget = target;
    const { name, args, order } = parseInlineTag(target.rawTag);
    this.teTitle.textContent = `Tag: ${name}`;
    this.teFields.innerHTML = "";

    let fieldOrder = order.filter((key) => key !== "unknown");
    if (/^choice[234]$/.test(name)) {
      const count = Number(name.slice(-1));
      fieldOrder = [];
      for (let i = 1; i <= count; i++) fieldOrder.push(`label${i}`);
      fieldOrder.push("selectedIndex", "cancelIndex");
    }

    if (!fieldOrder.length) {
      const row = document.createElement("div");
      row.className = "te-row";
      const label = document.createElement("label");
      label.textContent = "raw";
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.an = "__raw__";
      input.value = String(target.rawTag || "").slice(2, -2);
      input.style.fontFamily = "monospace";
      row.append(label, input);
      this.teFields.appendChild(row);
    } else {
      fieldOrder.forEach((key) => {
        const row = document.createElement("div");
        row.className = "te-row";
        const label = document.createElement("label");
        label.textContent = key;
        const input = document.createElement("input");
        input.type = "text";
        input.dataset.an = key;
        input.value = args[key] ?? "";
        row.append(label, input);
        this.teFields.appendChild(row);
      });
    }

    this.teModal.classList.add("open");
  }

  // Close the tag editor modal.
  closeTE() {
    this.teModal.classList.remove("open");
    this.editTarget = null;
  }

  // Save changes from the tag editor.
  saveTE() {
    if (!this.editTarget) return;
    const bubbleRecord = this.editTarget.bubbleRecord;
    saveUndo(bubbleRecord.content);
    const raw = bubbleRecord.content.dataset.raw ?? serializeContent(bubbleRecord.content);
    const tags = parseRawTags(raw);
    const targetTag = tags[this.editTarget.tagIndex];
    if (!targetTag) return;

    const rawInput = this.teFields.querySelector('[data-an="__raw__"]');
    let newRawTag = "";
    if (rawInput) {
      newRawTag = `{{${rawInput.value.trim()}}}`;
    } else {
      const { name } = parseInlineTag(this.editTarget.rawTag);
      const nextArgs = {};
      const order = [];
      this.teFields.querySelectorAll("[data-an]").forEach((input) => {
        const key = input.dataset.an;
        order.push(key);
        nextArgs[key] = input.value;
      });
      newRawTag = buildInlineTag(name, nextArgs, order);
    }

    const nextRaw = `${raw.slice(0, targetTag.start)}${newRawTag}${raw.slice(targetTag.end)}`;
    renderRawToContent(bubbleRecord.content, nextRaw);
    bubbleRecord.content.dataset.raw = nextRaw;
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(bubbleRecord.chain);
    this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
    this.closeTE();
    this.setStatus("Tag saved");
  }

  // Delete the tag currently edited in the tag editor.
  deleteTE() {
    if (!this.editTarget) return;
    const bubbleRecord = this.editTarget.bubbleRecord;
    saveUndo(bubbleRecord.content);
    const raw = bubbleRecord.content.dataset.raw ?? serializeContent(bubbleRecord.content);
    const tags = parseRawTags(raw);
    const targetTag = tags[this.editTarget.tagIndex];
    if (!targetTag) return;

    const nextRaw = `${raw.slice(0, targetTag.start)}${raw.slice(targetTag.end)}`;
    renderRawToContent(bubbleRecord.content, nextRaw);
    bubbleRecord.content.dataset.raw = nextRaw;
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(bubbleRecord.chain);
    this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
    this.closeTE();
    this.setStatus("Tag deleted");
  }

  // Close the bubble context menu.
  closeCtx() {
    this.ctxMenu.classList.remove("open");
    this.ctxTarget = null;
    this.ctxSelection = null;
  }

  // Open the context menu or tag editor from a right-click.
  handleContextMenu(event) {
    const tagNode = event.target.closest("[data-raw-tag]");
    if (tagNode) {
      event.preventDefault();
      const content = tagNode.closest(".bubble-content");
      const bubbleRecord = this.findBubbleByContent(content);
      if (!bubbleRecord) return;
      const raw = bubbleRecord.content.dataset.raw ?? serializeContent(bubbleRecord.content);
      const tagIndex = parseRawTags(raw).findIndex((tag) => tag.rawTag === tagNode.dataset.rawTag);
      if (tagIndex >= 0) this.openTE({ bubbleRecord, tagIndex, rawTag: tagNode.dataset.rawTag });
      return;
    }

    const bubble = event.target.closest(".bubble");
    if (!bubble) {
      this.closeCtx();
      return;
    }

    const content = bubble.querySelector(".bubble-content");
    const bubbleRecord = this.findBubbleByContent(content);
    if (!bubbleRecord) return;
    const selection = getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (content.contains(range.startContainer) && content.contains(range.endContainer)) {
        const { startOff, endOff } = getSelectionTextOffsets(content, range);
        this.ctxSelection = { content, start: startOff, end: endOff };
      } else {
        this.ctxSelection = null;
      }
    } else {
      this.ctxSelection = null;
    }
    event.preventDefault();
    this.ctxTarget = bubbleRecord;
    this.ctxMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 200)}px`;
    this.ctxMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 80)}px`;
    this.ctxMenu.classList.add("open");
  }

  // Open raw editor from the context menu target.
  openRawFromContext() {
    if (!this.ctxTarget) return;
    this.openRaw(this.ctxTarget);
    this.closeCtx();
  }

  // Insert a pause tag from the context menu.
  ctxInsertDelay(tagName) {
    if (!this.ctxTarget) return;
    const bubbleRecord = this.ctxTarget;
    const rawTag = `{{${tagName}}}`;
    const target = bubbleRecord.content;
    saveUndo(target);
    const saved = this.ctxSelection && this.ctxSelection.content === target ? this.ctxSelection : null;
    const raw = target.dataset.raw ?? serializeContent(target);
    const start = saved ? saved.start : rawToPlainText(raw).length;
    const end = saved ? saved.end : start;
    const nextRaw = spliceVisibleRange(raw, start, end, rawTag);
    this.closeCtx();
    renderRawToContent(target, nextRaw);
    target.dataset.raw = nextRaw;
    target.focus();
    this.setCaretAtVisibleOffset(target, start);
    this.syncMetaBar(bubbleRecord);
    this.refreshChoicePills(bubbleRecord.chain);
    this.updateBubbleOverflow(bubbleRecord, bubbleRecord.chain.typeSelect.value);
    this.setStatus("Pause inserted");
  }

  // Copy the target bubble raw text with tags.
  copyContextRaw() {
    if (!this.ctxTarget) return;
    const raw = this.ctxTarget.content.dataset.raw ?? serializeContent(this.ctxTarget.content);
    navigator.clipboard.writeText(raw).then(() => this.setStatus("Copied with tags"));
    this.closeCtx();
  }

  // Copy the target bubble as plain text.
  copyContextPlain() {
    if (!this.ctxTarget) return;
    const raw = this.ctxTarget.content.dataset.raw ?? serializeContent(this.ctxTarget.content);
    navigator.clipboard.writeText(rawToPlainText(raw)).then(() => this.setStatus("Copied without tags"));
    this.closeCtx();
  }

  // Find the bubble record that owns a contenteditable node.
  findBubbleByContent(content) {
    for (const chain of this.chains) {
      const bubble = chain.bubbles.find((item) => item.content === content);
      if (bubble) return bubble;
    }
    return null;
  }

  // Serialize one entry with the shared automatic-split boundary policy.
  serializeBubbleChain(chain) {
    let raw = "";
    let previousBubble = null;
    chain.bubbles.forEach((bubble, index) => {
      const bubbleRaw = bubble.content.dataset.raw ?? serializeContent(bubble.content);
      if (index === 0) {
        raw += bubbleRaw;
        previousBubble = bubble;
        return;
      }
      const previousRaw = previousBubble.content.dataset.raw ?? serializeContent(previousBubble.content);
      raw += separatorForBubbleBoundary(bubble.joinKind, previousRaw, this.getBubbleLineLimit(chain));
      raw += bubbleRaw;
      previousBubble = bubble;
    });
    return raw;
  }

  // AEON, MSYT and BCML now share the same soft-split semantics.
  serializeChainRaw(chain) {
    return this.serializeBubbleChain(chain);
  }

  serializeMsytChain(chain) {
    return this.serializeBubbleChain(chain);
  }

  // Apply one bubble type to all chains.
  applyGlobalType(type) {
    if (!type) return;
    this.chains.forEach((chain) => {
      chain.typeSelect.value = type;
      this.applyChainType(chain, type, true);
    });
    this.setStatus(`Type applied: ${type}`);
  }

  // Collect the whole document into export-ready chain objects.
  collectChains() {
    return this.chains.map((chain) => ({
      label: chain.labelInput.value,
      attrKey: chain.attrKey,
      attrVal: chain.attrInput.value,
      raw: this.serializeChainRaw(chain),
      msytRaw: this.serializeMsytChain(chain),
      bubbleType: chain.typeSelect.value,
      ...(this.currentDocMode === DOC_MODE_BCML
        ? {
            bcmlLocale: chain.bcmlLocale,
            bcmlPath: chain.bcmlPath,
            bcmlLocaleGroupId: chain.bcmlLocaleGroupId,
            bcmlPathGroupId: chain.bcmlPathGroupId
          }
        : {}),
      msytHasAttributes: chain.msytHasAttributes || chain.attrInput.value !== ""
    }));
  }

  // Filter visible entries and sidebar items by search query.
  doSearch(query) {
    const q = String(query || "").trim().toLowerCase();
    this.chains.forEach((chain) => {
      const contentText = chain.bubbles
        .map((bubble) => rawToPlainText(bubble.content.dataset.raw ?? serializeContent(bubble.content)))
        .join("\n")
        .toLowerCase();
      const haystack = `${chain.labelInput.value}\n${chain.attrInput.value}\n${chain.bcmlLocale ?? ""}\n${chain.bcmlPath ?? ""}\n${contentText}`.toLowerCase();
      const visible = !q || haystack.includes(q);
      chain.section.hidden = !visible;
      chain.sidebarItem.hidden = !visible;
    });
    if (this.currentDocMode === DOC_MODE_BCML) {
      this.chainList.querySelectorAll(".msyt-path-group").forEach((group) => {
        group.hidden = !group.querySelector(".chain:not([hidden])");
      });
      this.chainList.querySelectorAll(".msyt-locale-group").forEach((group) => {
        group.hidden = !group.querySelector(".msyt-path-group:not([hidden])");
      });
      this.sidebar.querySelectorAll(".sb-tree-path").forEach((group) => {
        group.hidden = !group.querySelector(".sb-item:not([hidden])");
      });
      this.sidebar.querySelectorAll(".sb-tree-locale").forEach((group) => {
        group.hidden = !group.querySelector(".sb-tree-path:not([hidden])");
      });
    }
  }

  // Build AEON YAML text from collected chains.
  buildAeonYaml(chains) {
    const meta =
      this.currentDocMode === DOC_MODE_AEON
        ? this.metaTextarea.value || this.yamlMeta
        : this.currentDocMode === DOC_MODE_MSYT
          ? this.msytDocInfo.aeonMeta || this.metaTextarea.value || buildAeonMetaFromMsyt(this.msytDocInfo.msytMeta, chains)
          : this.yamlMeta || buildAeonMetaFromMsyt(this.msytDocInfo.msytMeta, chains);
    let output = meta ? `${meta}\n` : "";
    const includeAttribute = hasATR1(this.currentGame, meta);
    const aeonAttrKey = getAeonAttributeKey(chains, this.currentDocMode);
    const parts = [];
    chains.forEach((chain) => {
      const entry = [];
      entry.push("---");
      entry.push(`label: ${chain.label}`);
      if (includeAttribute) entry.push(`${aeonAttrKey}: ${chain.attrVal || ""}`);
      entry.push("---");
      entry.push(chain.raw);
      parts.push(entry.join("\n"));
    });
    return `${output}${parts.join("\n\n")}\n`;
  }

  // Export the current document to the chosen format.
  exportDocument() {
    const chains = this.collectChains();
    if (!chains.length) {
      window.alert("There is nothing to export");
      return;
    }

    try {
      const mode = this.getEffectiveExportMode();
      const aeonAttrKey = getAeonAttributeKey(chains, this.currentDocMode);
      let exportChains =
        this.currentDocMode === DOC_MODE_AEON && mode !== DOC_MODE_AEON
          ? chains.map((chain) => ({
              ...chain,
              attrVal: aeonAttrKey === "attributeText" ? chain.attrVal : "",
              msytHasAttributes: aeonAttrKey === "attributeText"
            }))
          : chains;
      let msytDocInfo =
        this.currentDocMode === DOC_MODE_AEON
          ? {
              ...this.msytDocInfo,
              msytMeta: {
                ...(this.msytDocInfo.msytMeta && typeof this.msytDocInfo.msytMeta === "object" ? this.msytDocInfo.msytMeta : {}),
                group_count: getAeonLabelGroups(this.metaTextarea.value || this.yamlMeta)
              }
            }
          : this.msytDocInfo;
      if (this.currentDocMode === DOC_MODE_MSYT && mode === DOC_MODE_MSYT) {
        const aeonMeta = this.msytDocInfo.aeonMeta || this.metaTextarea.value;
        const converted = buildMsytMetaFromAeonMeta(this.msytDocInfo.msytMeta, aeonMeta, exportChains);
        exportChains = converted.chains;
        msytDocInfo = { ...this.msytDocInfo, msytMeta: converted.msytMeta };
      }
      let output = "";
      if (this.currentDocMode === DOC_MODE_BCML) output = buildMsytBcmlJson(exportChains, msytDocInfo, this.currentGame);
      else if (mode === DOC_MODE_AEON) output = this.buildAeonYaml(exportChains);
      else if (mode === DOC_MODE_MSYT) output = buildMsytYaml(exportChains, msytDocInfo, this.currentGame);
      else output = buildMsytBcmlJson(exportChains, msytDocInfo, this.currentGame);

      const label = this.currentDocMode === DOC_MODE_BCML ? "texts.json" : mode === DOC_MODE_MSYT ? ".msyt" : "YAML";
      navigator.clipboard.writeText(output).then(
        () => this.setStatus(`${label} copied`),
        () => this.setStatus(`Could not copy ${label}`)
      );
    } catch (error) {
      window.alert(`Error: ${error.message}`);
    }
  }
}
