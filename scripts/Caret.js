import { parseRawTags, rawToPlainText, spliceVisibleRange, visibleOffsetToRaw } from "./RawContent.js";

let tagCaretPositionEnabled = true;

function deleteDirection(inputType) {
  if (inputType === "deleteContentBackward" || inputType === "deleteWordBackward") return -1;
  if (inputType === "deleteContentForward" || inputType === "deleteWordForward") return 1;
  return 0;
}

// Find the visible word range that Ctrl+Backspace/Delete should remove beside a marker.
function getWordDeleteRange(text, offset, dir) {
  const value = String(text || "");
  const at = Math.max(0, Math.min(offset, value.length));
  if (dir < 0) {
    let start = at;
    while (start > 0 && /\s/.test(value[start - 1])) start--;
    while (start > 0 && !/\s/.test(value[start - 1])) start--;
    return { start, end: at };
  }
  let end = at;
  while (end < value.length && /\s/.test(value[end])) end++;
  while (end < value.length && !/\s/.test(value[end])) end++;
  return { start: at, end };
}

// Toggle special caret behavior around hidden tag markers.
export function setTagCaretPosition(enabled) {
  tagCaretPositionEnabled = Boolean(enabled);
}

// Find a tag that sits exactly on the caret boundary for Backspace/Delete.
export function getBoundaryTag(raw, offset, dir, bias = "after") {
  if ((dir < 0 && bias !== "after") || (dir > 0 && bias !== "before")) return null;
  const rawBefore = visibleOffsetToRaw(raw, offset, "before");
  const rawAfter = visibleOffsetToRaw(raw, offset, "after");
  if (rawBefore === rawAfter) return null;
  const tags = parseRawTags(raw).filter((tag) => tag.start >= rawBefore && tag.end <= rawAfter);
  if (!tags.length) return null;
  return dir < 0 ? tags[tags.length - 1] : tags[0];
}

// Pick the boundary tag affected by a Backspace or Delete key press.
export function getBoundaryTagForInput(raw, offset, inputType) {
  if (inputType !== "deleteContentBackward" && inputType !== "deleteContentForward") return null;
  const dir = inputType === "deleteContentBackward" ? -1 : 1;
  return getBoundaryTag(raw, offset, dir, dir < 0 ? "after" : "before");
}

// Decide what a delete key does when its direction reaches a hidden marker.
export function getMarkerDeleteAction(raw, edit) {
  if (!edit) return null;
  const dir = deleteDirection(edit.inputType);
  if (!dir) return null;
  // Firefox cannot delete text backwards from its DOM boundary just before a marker.
  if (!edit.markerOnDeleteSide) {
    if (
      !tagCaretPositionEnabled &&
      (edit.inputType === "deleteContentBackward" || edit.inputType === "deleteWordBackward") &&
      edit.tagCaretAnchor?.side === "before" &&
      edit.start < edit.end
    ) {
      return { kind: "visibleText", start: edit.start, end: edit.end };
    }
    return null;
  }
  // true has only the after-tag position, so Backspace from that position deletes the tag.
  if (tagCaretPositionEnabled) {
    const tag = getBoundaryTag(raw, edit.caretOffset ?? edit.start, dir, "after");
    return tag ? { kind: "marker", tag } : null;
  }
  const anchor = edit.tagCaretAnchor;
  if (anchor) {
    if ((dir < 0 && anchor.side !== "after") || (dir > 0 && anchor.side !== "before")) return null;
    const tag = getRawMarkerAtIndex(raw, anchor.markerIndex);
    return tag ? { kind: "marker", tag } : null;
  }
  const tag = getBoundaryTag(raw, edit.caretOffset ?? edit.start, dir, dir < 0 ? "after" : "before");
  return tag ? { kind: "marker", tag } : null;
}

// Insert visible text at a saved marker side. The marker index is resolved only for this raw edit.
export function insertPendingText(raw, edit, text) {
  const anchor = edit?.tagCaretAnchor;
  if (anchor && edit.start === edit.end) {
    const markers = getRawMarkers(raw);
    const tag = markers[anchor.markerIndex];
    if (tag) {
      const offset = anchor.side === "before" ? tag.start : tag.end;
      const nextRaw = `${raw.slice(0, offset)}${text}${raw.slice(offset)}`;
      if (anchor.side === "before") return { nextRaw, tagCaretAnchor: anchor };
      const nextMarker = markers[anchor.markerIndex + 1];
      // Text inserted between adjacent markers remains before the following marker.
      if (nextMarker && rawToPlainText(raw.slice(tag.end, nextMarker.start)) === "") {
        return { nextRaw, tagCaretAnchor: { markerIndex: anchor.markerIndex + 1, side: "before" } };
      }
      return { nextRaw, tagCaretAnchor: null };
    }
  }
  return {
    nextRaw: spliceVisibleRange(raw, edit?.start ?? 0, edit?.end ?? 0, text, edit?.restoreSide || "after"),
    tagCaretAnchor: null
  };
}

// Collect active format runs across visible text.
function getFormatRuns(raw, type, formatDefs) {
  const def = formatDefs[type];
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

// Repair color/size tags after a normal text deletion. Empty tag pairs are cleaned elsewhere.
export function normalizeLeadingFormatDeletion(oldRaw, nextRaw, edit, startOff, oldEndOff, newEndOff, formatDefs, applyFormatToRange) {
  // Prevent leading format tags from sticking to text after destructive edits.
  if (edit && ["deleteContentBackward", "deleteContentForward", "deleteByCut"].includes(edit.inputType)) {
    for (const type of ["color", "size"]) {
      const run = getFormatRuns(oldRaw, type, formatDefs).find((item) => item.start === edit.start && item.end > edit.start);
      if (!run) continue;
      const removed = Math.max(0, Math.min(edit.end, run.end) - edit.start);
      if (removed <= 0) continue;
      const nextRunEnd = edit.start + Math.max(0, run.end - edit.end);
      if (nextRunEnd > edit.start) nextRaw = applyFormatToRange(nextRaw, edit.start, nextRunEnd, type, null);
    }
    return nextRaw;
  }
  if (newEndOff !== startOff) return nextRaw;
  for (const type of ["color", "size"]) {
    const run = getFormatRuns(oldRaw, type, formatDefs).find((item) => item.start === startOff && item.end > startOff);
    if (!run) continue;
    const nextRunEnd = startOff + Math.max(0, run.end - oldEndOff);
    if (nextRunEnd > startOff) nextRaw = applyFormatToRange(nextRaw, startOff, nextRunEnd, type, null);
  }
  return nextRaw;
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
export function inferCollapsedCaretBias(content, range, fallback = "after") {
  const beforeNode = boundaryNeighbor(content, range.startContainer, range.startOffset, -1);
  const afterNode = boundaryNeighbor(content, range.startContainer, range.startOffset, 1);
  if (isRawTagNode(beforeNode) && !isRawTagNode(afterNode)) return "after";
  if (isRawTagNode(afterNode) && !isRawTagNode(beforeNode)) return "before";
  return fallback;
}

// Rendered markers and raw markers have the same order. Store that marker number, never a raw character offset.
function getMarkerNodes(content) {
  return Array.from(content?.querySelectorAll?.("[data-raw-tag]") || []);
}

function getMarkerIndex(content, marker) {
  return getMarkerNodes(content).indexOf(marker);
}

function getRawMarkers(raw) {
  return parseRawTags(raw).filter((tag) => tag.name !== "color" && tag.name !== "size");
}

function getRawMarkerAtIndex(raw, markerIndex) {
  return getRawMarkers(raw)[markerIndex] || null;
}

// Keep the gap between adjacent markers when the marker in that gap is deleted.
export function getMarkerDeleteRestoreAnchor(raw, tag) {
  const markers = getRawMarkers(raw);
  const markerIndex = getRawMarkerIndex(raw, tag);
  if (markerIndex < 0) return null;
  const previous = markers[markerIndex - 1];
  const next = markers[markerIndex + 1];
  if (next && rawToPlainText(raw.slice(tag.end, next.start)) === "") {
    return { markerIndex, side: "before" };
  }
  if (previous && rawToPlainText(raw.slice(previous.end, tag.start)) === "") {
    return { markerIndex: markerIndex - 1, side: "after" };
  }
  return null;
}

function getRawMarkerIndex(raw, tag) {
  return getRawMarkers(raw).findIndex((candidate) => candidate.start === tag?.start && candidate.end === tag?.end);
}

// Read the exact before/after side of a marker from a collapsed DOM range.
function readTagCaretAnchor(content, range) {
  if (tagCaretPositionEnabled || !range?.collapsed) return null;
  const beforeNode = boundaryNeighbor(content, range.startContainer, range.startOffset, -1);
  const afterNode = boundaryNeighbor(content, range.startContainer, range.startOffset, 1);
  if (isRawTagNode(beforeNode)) {
    const markerIndex = getMarkerIndex(content, beforeNode);
    if (markerIndex >= 0) return { markerIndex, side: "after" };
  }
  if (isRawTagNode(afterNode)) {
    const markerIndex = getMarkerIndex(content, afterNode);
    if (markerIndex >= 0) return { markerIndex, side: "before" };
  }
  return null;
}

// Snapshot the intended visible-text edit before contenteditable mutates the DOM.
export function capturePendingInputEdit(content, inputType, targetRange = null) {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) {
    content._pendingInputEdit = null;
    return;
  }
  let range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) {
    content._pendingInputEdit = null;
    return;
  }
  // A marker side has one canonical DOM position in either mode.
  if (range.collapsed) {
    normalizeTagCaretSelection(content);
    range = selection.getRangeAt(0);
  }
  const { startOff, endOff } = getSelectionTextOffsets(content, range);
  let start = startOff;
  let end = endOff;
  const raw = content.dataset.raw ?? "";
  const plain = rawToPlainText(raw);
  let tagCaretAnchor = null;
  let restoreTagCaretAnchor = null;
  let markerOnDeleteSide = false;
  let hasDeleteTargetRange = false;
  const targetOffsets =
    targetRange && content.contains(targetRange.startContainer) && content.contains(targetRange.endContainer)
      ? getSelectionTextOffsets(content, targetRange)
      : null;
  if (startOff === endOff) {
    // false keeps the exact side of a marker; true has already been normalized after it.
    tagCaretAnchor = readTagCaretAnchor(content, range);
    restoreTagCaretAnchor = tagCaretAnchor;
    const dir = deleteDirection(inputType);
    if ((inputType === "deleteWordBackward" || inputType === "deleteWordForward") && targetOffsets?.startOff !== targetOffsets?.endOff) {
      start = targetOffsets.startOff;
      end = targetOffsets.endOff;
      hasDeleteTargetRange = true;
    }
    if (dir < 0) {
      markerOnDeleteSide = isRawTagNode(boundaryNeighbor(content, range.startContainer, range.startOffset, -1));
      if (inputType === "deleteContentBackward" && startOff > 0) {
        start = startOff - 1;
        end = startOff;
      }
    } else if (dir > 0) {
      markerOnDeleteSide = isRawTagNode(boundaryNeighbor(content, range.startContainer, range.startOffset, 1));
      if (inputType === "deleteContentForward") {
        start = startOff;
        end = Math.min(startOff + 1, plain.length);
      }
    }
    // Deleting the last visible character before a marker leaves the caret on its before side.
    if (!tagCaretPositionEnabled && inputType === "deleteContentForward" && !markerOnDeleteSide) {
      const tag = getBoundaryTag(raw, end, 1, "before");
      const markerIndex = getRawMarkerIndex(raw, tag);
      if (markerIndex >= 0) restoreTagCaretAnchor = { markerIndex, side: "before" };
    }
    // Likewise, deleting the first visible character after a marker leaves it after the marker.
    if (!tagCaretPositionEnabled && inputType === "deleteContentBackward" && !markerOnDeleteSide) {
      const tag = getBoundaryTag(raw, start, -1, "after");
      const markerIndex = getRawMarkerIndex(raw, tag);
      if (markerIndex >= 0) restoreTagCaretAnchor = { markerIndex, side: "after" };
    }
    if (!tagCaretPositionEnabled && inputType === "deleteWordBackward" && tagCaretAnchor?.side === "before" && !hasDeleteTargetRange) {
      ({ start, end } = getWordDeleteRange(plain, startOff, -1));
      hasDeleteTargetRange = start < end;
    }
  }
  content._pendingInputEdit = {
    inputType,
    start,
    end,
    tagCaretAnchor,
    restoreTagCaretAnchor,
    markerOnDeleteSide,
    hasDeleteTargetRange,
    caretOffset: startOff,
    restoreSide: restoreTagCaretAnchor?.side || "after",
    wasCollapsed: startOff === endOff
  };
}

// Remember the marker side for the next collapsed caret/input near hidden tags.
function setTagCaretSide(content, side) {
  if (content) content._tagCaretSide = side || null;
}

function setTagCaretAnchor(content, anchor) {
  if (content) content._tagCaretAnchor = anchor ? { ...anchor } : null;
  setTagCaretSide(content, anchor?.side || null);
}

// Read the current false-mode marker side for undo/redo restoration.
export function getTagCaretAnchor(content) {
  if (tagCaretPositionEnabled || !content?._tagCaretAnchor) return null;
  return { ...content._tagCaretAnchor };
}

// In normal mode a marker has no stop before it: land after its whole consecutive run.
function placeAfterMarkerRun(content, marker) {
  const parent = marker?.parentNode;
  if (!parent) return false;
  let offset = Array.prototype.indexOf.call(parent.childNodes, marker);
  if (offset < 0) return false;
  do {
    offset += 1;
  } while (isRawTagNode(parent.childNodes[offset]));
  const range = document.createRange();
  range.setStart(parent, offset);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  setTagCaretAnchor(content, null);
  setTagCaretSide(content, "after");
  return true;
}

// Keep true on its one after-tag position and false on exactly two marker sides.
export function normalizeTagCaretSelection(content) {
  if (!content) return false;
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !content.contains(range.startContainer) || !content.contains(range.endContainer)) return false;
  const beforeNode = boundaryNeighbor(content, range.startContainer, range.startOffset, -1);
  const afterNode = boundaryNeighbor(content, range.startContainer, range.startOffset, 1);
  if (tagCaretPositionEnabled) {
    if (isRawTagNode(afterNode)) return placeAfterMarkerRun(content, afterNode);
    setTagCaretAnchor(content, null);
    setTagCaretSide(content, inferCollapsedCaretBias(content, range, "after"));
    return false;
  }
  // A text-node edge beside a marker is the same semantic position as its parent boundary.
  if (isRawTagNode(beforeNode)) {
    return setCaretAtTagCaretAnchor(content, { markerIndex: getMarkerIndex(content, beforeNode), side: "after" });
  }
  if (isRawTagNode(afterNode)) {
    return setCaretAtTagCaretAnchor(content, { markerIndex: getMarkerIndex(content, afterNode), side: "before" });
  }
  setTagCaretAnchor(content, null);
  setTagCaretSide(content, inferCollapsedCaretBias(content, range, "after"));
  return false;
}

// Re-derive the marker position from the current DOM selection after mouse placement.
function syncTagCaretAnchorFromSelection(content, fallback = content?._tagCaretSide || "after") {
  if (!content) return;
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) {
    setTagCaretAnchor(content, null);
    return;
  }
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !content.contains(range.startContainer) || !content.contains(range.endContainer)) {
    setTagCaretAnchor(content, null);
    return;
  }
  if (normalizeTagCaretSelection(content)) return;
  if (tagCaretPositionEnabled) return;
  const anchor = readTagCaretAnchor(content, range);
  if (anchor) {
    setTagCaretAnchor(content, anchor);
    return;
  }
  setTagCaretAnchor(content, null);
  setTagCaretSide(content, inferCollapsedCaretBias(content, range, fallback));
}

// Move through a marker without ever leaving an invalid normal-mode before-tag position.
export function moveTagCaretAcrossMarker(content, dir, byWord = false) {
  if (dir !== -1 && dir !== 1) return false;
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !content.contains(range.startContainer)) return false;

  if (byWord) {
    const { startOff } = getSelectionTextOffsets(content, range);
    const word = getWordDeleteRange(rawToPlainText(content.dataset.raw ?? ""), startOff, dir);
    setCaretAtVisibleOffset(content, dir < 0 ? word.start : word.end, "after");
    return true;
  }

  const marker = boundaryNeighbor(content, range.startContainer, range.startOffset, dir);
  if (!isRawTagNode(marker) || !marker.parentNode) {
    // Firefox cannot leave the DOM boundary immediately before a non-editable marker with ←.
    if (!tagCaretPositionEnabled && dir < 0 && isRawTagNode(boundaryNeighbor(content, range.startContainer, range.startOffset, 1))) {
      const { startOff } = getSelectionTextOffsets(content, range);
      if (startOff > 0) {
        setCaretAtVisibleOffset(content, startOff - 1, "after");
        return true;
      }
    }
    return false;
  }

  if (tagCaretPositionEnabled) {
    if (dir > 0) return placeAfterMarkerRun(content, marker);
    const { startOff } = getSelectionTextOffsets(content, range);
    setCaretAtVisibleOffset(content, Math.max(0, startOff - 1), "after");
    return true;
  }
  const index = Array.prototype.indexOf.call(marker.parentNode.childNodes, marker);
  if (index < 0) return false;

  const nextRange = document.createRange();
  nextRange.setStart(marker.parentNode, dir < 0 ? index : index + 1);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  const markerIndex = getMarkerIndex(content, marker);
  setTagCaretAnchor(content, markerIndex >= 0 ? { markerIndex, side: dir < 0 ? "before" : "after" } : null);
  return true;
}

// Restore a caret at one exact rendered marker side after the DOM was rebuilt from raw.
export function setCaretAtTagCaretAnchor(content, anchor) {
  if (tagCaretPositionEnabled) return false;
  const marker = getMarkerNodes(content)[anchor?.markerIndex];
  if (!marker?.parentNode) return false;
  const index = Array.prototype.indexOf.call(marker.parentNode.childNodes, marker);
  if (index < 0) return false;
  const range = document.createRange();
  range.setStart(marker.parentNode, anchor.side === "before" ? index : index + 1);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  setTagCaretAnchor(content, anchor);
  return true;
}

// Find the contiguous marker run immediately beside a text-node edge.
function findAdjacentMarkerRun(node, dir) {
  let current = node;
  let parent = current?.parentNode;
  while (parent && parent.nodeType === Node.ELEMENT_NODE) {
    const siblings = Array.from(parent.childNodes);
    const index = siblings.indexOf(current);
    if (index < 0) return null;
    let cursor = index + (dir > 0 ? 1 : -1);
    const firstMarker = cursor;
    while (cursor >= 0 && cursor < siblings.length) {
      if (!isRawTagNode(siblings[cursor])) break;
      cursor += dir;
    }
    if (cursor !== firstMarker) {
      const before = dir > 0 ? firstMarker : cursor + 1;
      const after = dir > 0 ? cursor : firstMarker + 1;
      return { node: parent, before, after };
    }
    current = parent;
    parent = parent.parentNode;
  }
  return null;
}

// Restore a collapsed caret from a visible-text offset and its saved tag side.
export function setCaretAtVisibleOffset(content, offset, side = content._tagCaretSide || "after") {
  const resolvedSide = tagCaretPositionEnabled ? "after" : side;
  setTagCaretAnchor(content, null);
  restoreVisibleCaret(content, offset, resolvedSide, {
    findTextBoundaryPosition: (node, textOffset) => findTagTextEdgeCaretPosition(node, textOffset, resolvedSide),
    findEmptyBlockPosition: (block) => findEmptyTagBlockCaretPosition(block, resolvedSide)
  });
}

// Find the requested side of a hidden tag beside a text node.
function findTagTextEdgeCaretPosition(node, textOffset, side) {
  const length = node.textContent?.length || 0;
  if (textOffset !== 0 && textOffset !== length) return null;
  const run = findAdjacentMarkerRun(node, textOffset === length ? 1 : -1);
  if (run) return { node: run.node, offset: side === "before" ? run.before : run.after };
  return null;
}

// Find the requested side of hidden markers in an otherwise empty visual block.
function findEmptyTagBlockCaretPosition(block, side) {
  const hasMarkerChild = Array.from(block.childNodes).some(
    (child) => child.nodeType === Node.ELEMENT_NODE && child.dataset?.rawTag != null
  );
  if (!hasMarkerChild) return null;
  // Empty visual blocks can still contain hidden markers, so collapse using the saved bias.
  return { node: block, offset: side === "after" ? block.childNodes.length : 0 };
}



// General caret, selection, and mouse helpers.

// Count text a user can see. Raw tag markers have no visible width.
function getVisibleTextLength(node) {
  if (!node) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.length;
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
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
        if (current.dataset?.rawTag !== undefined) return;
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
    if (current.dataset?.rawTag !== undefined || current.tagName === "BR") return;

    for (const child of current.childNodes) {
      walk(child);
      if (found) return;
    }
  };

  walk(node);
  return found ? total : null;
}

// Translate DOM selection into visible-text offsets, ignoring hidden tag markers.
export function getSelectionTextOffsets(content, range) {
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

  return {
    startOff: offsetFromPoint(range.startContainer, range.startOffset),
    endOff: offsetFromPoint(range.endContainer, range.endOffset)
  };
}

// Place the caret at the visible start or end of a bubble.
function placeCaretAtBoundary(content, atStart) {
  const target = content.firstElementChild || content.appendChild(document.createElement("div"));
  const selection = getSelection();
  const range = document.createRange();
  range.selectNodeContents(atStart ? target : content.lastElementChild || target);
  range.collapse(atStart);
  selection.removeAllRanges();
  selection.addRange(range);
  setTagCaretAnchor(content, null);
  setTagCaretSide(content, atStart ? "before" : "after");
}

// Restore a collapsed caret from a visible-text offset without knowing about tags.
function restoreVisibleCaret(content, offset, bias, { findTextBoundaryPosition, findEmptyBlockPosition }) {
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
        setTagCaretSide(content, bias);
        return;
      }
    }
    if (block.nodeType === Node.TEXT_NODE) {
      const len = block.textContent?.length || 0;
      if (remaining <= len) {
        const range = document.createRange();
        const position = findTextBoundaryPosition?.(block, remaining);
        if (position) range.setStart(position.node, position.offset);
        else range.setStart(block, remaining);
        range.collapse(true);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        setTagCaretSide(content, bias);
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
        const position = findTextBoundaryPosition?.(node, remaining);
        if (position) range.setStart(position.node, position.offset);
        else range.setStart(node, remaining);
        range.collapse(true);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        setTagCaretSide(content, bias);
        return;
      }
      remaining -= len;
      node = walker.nextNode();
    }
    if (!remaining) {
      const range = document.createRange();
      range.selectNodeContents(block);
      const position = findEmptyBlockPosition?.(block);
      if (position) range.setStart(position.node, position.offset);
      else range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      setTagCaretSide(content, position ? bias : "after");
      return;
    }
  }
  placeCaretAtBoundary(content, false);
}

// Map a visible-text offset back to a DOM node/offset pair.
function locateVisibleDomPosition(content, offset) {
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
export function setSelectionVisibleOffsets(content, start, end) {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from === to) {
    setCaretAtVisibleOffset(content, from);
    return;
  }
  const startPos = locateVisibleDomPosition(content, from);
  const endPos = locateVisibleDomPosition(content, to);
  if (!startPos?.node || !endPos?.node) return;
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  setTagCaretAnchor(content, null);
}

// Place the caret from mouse coordinates, with fallbacks.
export function placeCaretFromPoint(content, clientX, clientY) {
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
      syncTagCaretAnchorFromSelection(content);
      placed = true;
    }
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (range && content.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
      syncTagCaretAnchorFromSelection(content);
      placed = true;
    }
  }

  if (placed) return;

  const blocks = [...content.children];
  if (!blocks.length) return placeCaretAtBoundary(content, true);

  const firstRect = blocks[0].getBoundingClientRect();
  const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
  if (clientX <= firstRect.left || clientY <= firstRect.top) return placeCaretAtBoundary(content, true);
  if (clientX >= lastRect.right || clientY >= lastRect.bottom) return placeCaretAtBoundary(content, false);

  const contentRect = content.getBoundingClientRect();
  placeCaretAtBoundary(content, clientX <= contentRect.left + contentRect.width / 2);
}

// Convert a mouse point to a visible-text offset.
export function getVisibleOffsetFromPoint(content, clientX, clientY) {
  placeCaretFromPoint(content, clientX, clientY);
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return 0;
  return getSelectionTextOffsets(content, range).startOff;
}
