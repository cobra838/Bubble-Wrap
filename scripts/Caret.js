import { parseRawTags, rawToPlainText, visibleOffsetToRaw } from "./RawContent.js";

// Find a tag that sits exactly on the caret boundary for Backspace/Delete.
export function getBoundaryTag(raw, offset, dir) {
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
  return getBoundaryTag(raw, offset, inputType === "deleteContentBackward" ? -1 : 1);
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

// Snapshot the intended visible-text edit before contenteditable mutates the DOM.
export function capturePendingInputEdit(content, inputType) {
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

// Remember the raw-side intent for the next collapsed caret/input near hidden tags.
function setCollapsedCaretBias(content, bias) {
  if (content) content._nextInputCollapsedBias = bias || null;
}

// Re-derive that before/after intent from the current DOM selection after mouse placement.
function syncCollapsedCaretBiasFromSelection(content, fallback = content?._nextInputCollapsedBias || "after") {
  if (!content) return;
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0) {
    setCollapsedCaretBias(content, null);
    return;
  }
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !content.contains(range.startContainer) || !content.contains(range.endContainer)) {
    setCollapsedCaretBias(content, null);
    return;
  }
  setCollapsedCaretBias(content, inferCollapsedCaretBias(content, range, fallback));
}

// Skip across contiguous tag markers when a visible offset lands on a hidden-tag boundary.
function findTagBoundaryCaretPosition(node, dir) {
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
    if (sawTag) return { node: parent, offset: dir > 0 ? cursor : cursor + 1 };
    current = parent;
    parent = parent.parentNode;
  }
  return null;
}

// Restore a collapsed caret from a visible-text offset.
export function setCaretAtVisibleOffset(content, offset, bias = content._nextInputCollapsedBias || "after") {
  restoreVisibleCaret(content, offset, bias, {
    findTextBoundaryPosition: (node, textOffset) => findTagTextEdgeCaretPosition(node, textOffset, bias),
    findEmptyBlockPosition: (block) => findEmptyTagBlockCaretPosition(block, bias)
  });
}

// Find the requested side of a hidden tag beside a text node.
function findTagTextEdgeCaretPosition(node, textOffset, bias) {
  const length = node.textContent?.length || 0;
  // At text edges, preserve whether the caret belongs before or after adjacent hidden tags.
  if (textOffset === length && bias === "after") return findTagBoundaryCaretPosition(node, 1);
  if (textOffset === 0 && bias === "before") return findTagBoundaryCaretPosition(node, -1);
  return null;
}

// Find the requested side of hidden markers in an otherwise empty visual block.
function findEmptyTagBlockCaretPosition(block, bias) {
  const hasMarkerChild = Array.from(block.childNodes).some(
    (child) => child.nodeType === Node.ELEMENT_NODE && child.dataset?.rawTag != null
  );
  if (!hasMarkerChild) return null;
  // Empty visual blocks can still contain hidden markers, so collapse using the saved bias.
  return { node: block, offset: bias === "after" ? block.childNodes.length : 0 };
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
  setCollapsedCaretBias(content, atStart ? "before" : "after");
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
        setCollapsedCaretBias(content, bias);
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
        setCollapsedCaretBias(content, bias);
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
      const position = findEmptyBlockPosition?.(block);
      if (position) range.setStart(position.node, position.offset);
      else range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      setCollapsedCaretBias(content, position ? bias : "after");
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
  setCollapsedCaretBias(content, null);
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
      syncCollapsedCaretBiasFromSelection(content);
      placed = true;
    }
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (range && content.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
      syncCollapsedCaretBiasFromSelection(content);
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
