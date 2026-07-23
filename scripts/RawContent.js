import { resolveEditorColorName } from "./GcfRegistry.js";

const TAG_RE = /\{\{([^}]*)\}\}/g;
const PAUSE_TAGS = new Set(["delay8", "delay15", "delay30"]);
const PAUSE_LABELS = {
  delay8: "8fr",
  delay15: "15fr",
  delay30: "30fr"
};
let currentGame = "BotW";

export function setRawContentGame(game) {
  currentGame = game === "TotK" ? "TotK" : "BotW";
  document.body.dataset.game = currentGame;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseTagBody(body) {
  const trimmed = String(body || "").trim();
  if (!trimmed) return { name: "", args: {} };
  const nameMatch = trimmed.match(/^([^\s]+)([\s\S]*)$/);
  const name = nameMatch?.[1] || "";
  const rest = nameMatch?.[2] || "";
  const args = {};
  for (const match of rest.matchAll(/([A-Za-z0-9_]+)="([^"]*)"/g)) {
    args[match[1]] = match[2];
  }
  return { name, args };
}

function normalizeColorId(id) {
  return resolveEditorColorName(currentGame, id);
}

function normalizeSizeValue(value) {
  const size = String(value || "100");
  if (size === "80" || size === "100" || size === "125") return size;
  return "100";
}

function createTextSpan(text, state) {
  const span = document.createElement("span");
  span.textContent = text;
  if (state.colorId != null) {
    span.dataset.rawColorId = state.colorId;
    span.dataset.color = state.colorId;
  }
  if (state.sizeValue != null) {
    span.dataset.rawSize = state.sizeValue;
    span.dataset.size = normalizeSizeValue(state.sizeValue);
  }
  return span;
}

function createTagNode(rawTag, state = {}) {
  const { name } = parseTagBody(rawTag.slice(2, -2));
  const token = document.createElement("span");
  // Raw tags are rendered as non-editable marker nodes, not as normal text.
  token.className = PAUSE_TAGS.has(name) ? "pause-node" : "tag-node";
  token.dataset.rawTag = rawTag;
  token.dataset.tagName = name;
  if (state.colorId != null) token.dataset.rawColorContext = state.colorId;
  if (state.sizeValue != null) token.dataset.rawSizeContext = state.sizeValue;
  token.contentEditable = "false";
  token.title = rawTag;
  if (name === "color" || name === "size") {
    token.dataset.fmt = "1";
    return token;
  }
  if (PAUSE_TAGS.has(name)) {
    token.dataset.label = PAUSE_LABELS[name];
  } else {
    token.style.setProperty("--tc", tagColor(name));
  }
  return token;
}

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

function applyMarkerOffsets(contentEl) {
  contentEl.querySelectorAll(".tag-node, .pause-node").forEach((node) => {
    node.removeAttribute("data-dot-offset");
    node.removeAttribute("data-stack-offset");
  });

  const lines = Array.from(contentEl.childNodes);
  lines.forEach((line) => {
    if (line.nodeType !== Node.ELEMENT_NODE) return;
    let dotIndex = 0;
    let prev = null;
    Array.from(line.childNodes).forEach((node) => {
      const isMarker =
        node.nodeType === Node.ELEMENT_NODE &&
        node.classList &&
        (node.classList.contains("tag-node") || node.classList.contains("pause-node"));
      const isPrevMarker =
        prev &&
        prev.nodeType === Node.ELEMENT_NODE &&
        prev.classList &&
        (prev.classList.contains("tag-node") || prev.classList.contains("pause-node"));
      if (isMarker) {
        dotIndex = isPrevMarker ? dotIndex + 1 : 0;
        if (dotIndex > 0) {
          if (node.classList.contains("tag-node")) node.dataset.dotOffset = String(dotIndex);
          if (node.classList.contains("pause-node")) node.dataset.stackOffset = String(dotIndex);
        }
        prev = node;
      } else {
        dotIndex = 0;
        prev = node;
      }
    });
  });
}

function appendTextWithState(line, text, state) {
  if (!text) return;
  line.appendChild(createTextSpan(text, state));
}

export function parseRawTags(raw) {
  const tags = [];
  for (const match of String(raw || "").matchAll(TAG_RE)) {
    const rawTag = match[0];
    const { name, args } = parseTagBody(match[1]);
    tags.push({
      rawTag,
      name,
      args,
      start: match.index,
      end: match.index + rawTag.length
    });
  }
  return tags;
}

export function rawToPlainText(raw) {
  return String(raw || "").replace(TAG_RE, "");
}

export function visibleOffsetToRaw(raw, offset, bias = "after") {
  const text = String(raw || "");
  let visible = 0;
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("{{", i)) {
      const end = text.indexOf("}}", i + 2);
      if (end === -1) break;
      if (visible === offset && bias === "before") return i;
      i = end + 2;
      if (visible === offset && bias === "after") continue;
      continue;
    }
    if (visible === offset) return i;
    visible++;
    i++;
  }
  return text.length;
}

function collapsedInsertRawOffset(raw, offset, bias = "after") {
  const rawBefore = visibleOffsetToRaw(raw, offset, "before");
  const rawAfter = visibleOffsetToRaw(raw, offset, "after");
  if (rawBefore === rawAfter) return rawBefore;
  return bias === "after" ? rawAfter : rawBefore;
}

export function spliceVisibleRange(raw, start, end, insertText, collapsedBias = "after") {
  const text = String(raw || "");
  if (start === end) {
    const rawPos = collapsedInsertRawOffset(text, start, collapsedBias);
    return `${text.slice(0, rawPos)}${insertText}${text.slice(rawPos)}`;
  }
  const rawStart = visibleOffsetToRaw(text, start, "after");
  const rawEnd = visibleOffsetToRaw(text, end, "before");
  return `${text.slice(0, rawStart)}${insertText}${text.slice(rawEnd)}`;
}

export function contentToPlainText(contentEl) {
  if (!contentEl) return "";
  const blocks = Array.from(contentEl.childNodes);
  return blocks
    .map((block) => {
      if (block.nodeType === Node.TEXT_NODE) return block.textContent || "";
      if (block.nodeType !== Node.ELEMENT_NODE) return "";
      return block.textContent || "";
    })
    .join("\n");
}

export function renderRawToContent(contentEl, raw) {
  const value = String(raw || "");
  const fragment = document.createDocumentFragment();
  let line = document.createElement("div");
  let lastIndex = 0;
  let state = {
    colorId: null,
    sizeValue: null
  };

  const pushText = (text) => {
    // Newlines become separate line divs so caret and overflow logic can count lines.
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      appendTextWithState(line, parts[i], state);
      if (i !== parts.length - 1) {
        if (!line.childNodes.length) {
          line.appendChild(document.createElement("br"));
        }
        fragment.appendChild(line);
        line = document.createElement("div");
      }
    }
  };

  for (const match of value.matchAll(TAG_RE)) {
    pushText(value.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const { name, args } = parseTagBody(match[1]);
    if (name === "color") {
      const id = args.id ?? "Default";
      state.colorId = normalizeColorId(id);
      continue;
    }
    if (name === "size") {
      const size = args.value ?? "100";
      state.sizeValue = size === "100" ? null : size;
      continue;
    }
    line.appendChild(createTagNode(match[0], state));
  }

  pushText(value.slice(lastIndex));
  if (!line.childNodes.length && value !== "") {
    line.appendChild(document.createElement("br"));
  }
  fragment.appendChild(line);

  contentEl.replaceChildren(...fragment.childNodes);
  contentEl.dataset.raw = value;
  applyMarkerOffsets(contentEl);
}

function collectSerializedPieces(node, pieces, inheritedState = { colorId: null, sizeValue: null }) {
  if (node.nodeType === Node.TEXT_NODE) {
    pieces.push({
      kind: "text",
      text: node.textContent || "",
      colorId: inheritedState.colorId,
      sizeValue: inheritedState.sizeValue
    });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.tagName === "BR") return;
  if (node.dataset?.rawTag != null) {
    if (node.dataset.fmt != null) return;
    pieces.push({
      kind: "tag",
      rawTag: node.dataset.rawTag,
      colorId: node.dataset.rawColorContext ?? inheritedState.colorId,
      sizeValue: node.dataset.rawSizeContext ?? inheritedState.sizeValue
    });
    return;
  }

  const nextState = {
    colorId: node.dataset?.rawColorId ?? inheritedState.colorId,
    sizeValue: node.dataset?.rawSize ?? inheritedState.sizeValue
  };
  for (const child of node.childNodes) {
    collectSerializedPieces(child, pieces, nextState);
  }
}

function syncSerializedState(output, state, nextColorId, nextSizeValue) {
  if (state.colorId !== nextColorId) {
    output.push(`{{color id="${nextColorId ?? "Default"}"}}`);
    state.colorId = nextColorId ?? null;
  }
  if (state.sizeValue !== nextSizeValue) {
    output.push(`{{size value="${nextSizeValue ?? "100"}"}}`);
    state.sizeValue = nextSizeValue ?? null;
  }
}

export function serializeContent(contentEl) {
  const output = [];
  const state = { colorId: null, sizeValue: null };
  const blocks = Array.from(contentEl.childNodes);
  blocks.forEach((block, index) => {
    const pieces = [];
    collectSerializedPieces(block, pieces);
    pieces.forEach((piece) => {
      const nextColorId = piece.kind === "tag" ? piece.colorId ?? state.colorId : piece.colorId;
      const nextSizeValue = piece.kind === "tag" ? piece.sizeValue ?? state.sizeValue : piece.sizeValue;
      syncSerializedState(output, state, nextColorId, nextSizeValue);
      if (piece.kind === "tag") output.push(piece.rawTag);
      else output.push(piece.text);
    });
    if (index !== blocks.length - 1) output.push("\n");
  });
  syncSerializedState(output, state, null, null);
  return output.join("");
}

export function ensureEditableStructure(contentEl) {
  const isIsolatedBreak = contentEl.innerHTML === "<br>";
  const isIsolatedBreakNode =
    contentEl.childElementCount === 1 &&
    contentEl.firstElementChild &&
    contentEl.firstElementChild.innerHTML === "<br>";
  if (isIsolatedBreak || isIsolatedBreakNode) {
    contentEl.innerHTML = "";
  }
  if (!contentEl.childNodes.length) {
    const line = document.createElement("div");
    contentEl.appendChild(line);
    return;
  }
  if (contentEl.childNodes.length === 1 && contentEl.firstChild.nodeType === Node.TEXT_NODE) {
    const line = document.createElement("div");
    line.appendChild(document.createTextNode(contentEl.textContent || ""));
    contentEl.replaceChildren(line);
    if (!line.childNodes.length && line.textContent !== "") {
      line.appendChild(document.createElement("br"));
    }
    return;
  }
  for (const child of Array.from(contentEl.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const line = document.createElement("div");
      line.appendChild(document.createTextNode(child.textContent || ""));
      contentEl.replaceChild(line, child);
      if (!line.childNodes.length) {
        line.appendChild(document.createElement("br"));
      }
    }
  }
}

export function tagSummary(rawTag) {
  const { name, args } = parseTagBody(rawTag.slice(2, -2));
  if (!name) return "tag";
  if (name === "animation") return `anim:${args.name || "?"}`;
  if (name === "setVoice") return `voice:${args.asset || "?"}`;
  if (PAUSE_TAGS.has(name)) return name;
  return name;
}
