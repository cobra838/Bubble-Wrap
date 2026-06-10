export const COLOR_CSS = {
  BotW: {
    Red: "#ff6666",
    Green: "#66cc66",
    Cyan: "#22dddd",
    Grey: "#aaaaaa",
    Azure: "#66bbff",
    Orange: "#ffaa44",
    DullGold: "#ccaa44",
    Blue: "#6699ff",
    Yellow: "#ffcc44",
    White: "#f0ece4",
    Default: null
  },
  TotK: {
    Orange: "#ff2209",
    Cyan: "#00ffff",
    Gray: "rgba(255,255,255,0.25)",
    Red: "#a31401",
    Green: "#5b996d",
    Purple: "#ff00fe",
    Default: null
  }
};

const registry = {
  BotW: { tags: [] },
  TotK: { tags: [] }
};

function ensureGame(game) {
  return game === "TotK" ? "TotK" : "BotW";
}

export function getColorCss(game) {
  const key = ensureGame(game);
  return COLOR_CSS[key] || COLOR_CSS.BotW;
}

export function getTags(game) {
  return registry[ensureGame(game)]?.tags || [];
}

export function getTagDef(game, name) {
  return getTags(game).find((tag) => tag.name === name) || null;
}

export function getColorValueMap(game) {
  const arg = getTagDef(game, "color")?.args?.find((item) => item.name === "id");
  return arg?.valueMap || {};
}

export function getColorChoices(game) {
  return Object.values(getColorValueMap(game)).filter((name) => name && name !== "Default");
}

export function getColorNameById(game, id) {
  const map = getColorValueMap(game);
  return map[String(id)] ?? String(id);
}

export function resolveEditorColorName(game, idOrName) {
  const raw = String(idOrName || "Default").trim();
  const key = raw.toLowerCase();
  if (key === "default" || key === "-1" || key === "65535") return null;

  const currentMap = getColorValueMap(game);
  if (currentMap[raw] != null && currentMap[raw] !== "Default") return currentMap[raw];

  for (const otherGame of ["BotW", "TotK"]) {
    const map = getColorValueMap(otherGame);
    if (map[raw] != null && map[raw] !== "Default") return map[raw];
  }

  const currentPalette = getColorCss(game);
  const currentDirect = Object.keys(currentPalette).find((name) => name.toLowerCase() === key);
  if (currentDirect && currentDirect !== "Default") return currentDirect;

  for (const palette of Object.values(COLOR_CSS)) {
    const direct = Object.keys(palette).find((name) => name.toLowerCase() === key);
    if (direct && direct !== "Default") return direct;
  }
  return null;
}

export function resolveColorCssValue(game, colorName) {
  if (!colorName) return null;
  const current = getColorCss(game)[colorName];
  if (current) return current;
  for (const palette of Object.values(COLOR_CSS)) {
    if (palette[colorName]) return palette[colorName];
  }
  return null;
}

export function parseGcfTags(text) {
  const lines = String(text || "").split(/\r?\n/);
  const tags = [];
  let inMsbt = false;
  let inTags = false;
  let currentTag = null;
  let currentArg = null;
  let inValueMap = false;

  const flushArg = () => {
    if (!currentArg || !currentTag) return;
    currentTag.args.push(currentArg);
    currentArg = null;
    inValueMap = false;
  };

  const flushTag = () => {
    flushArg();
    if (!currentTag) return;
    tags.push(currentTag);
    currentTag = null;
  };

  for (const line of lines) {
    if (!inMsbt) {
      if (/^msbt:\s*$/.test(line)) inMsbt = true;
      continue;
    }
    if (!inTags) {
      if (/^\s*tags:\s*$/.test(line)) inTags = true;
      continue;
    }

    if (/^  - name:\s+/.test(line)) {
      flushTag();
      currentTag = { name: line.replace(/^  - name:\s+/, "").trim(), description: "", args: [] };
      continue;
    }

    if (!currentTag) continue;

    const tagDescription = line.match(/^    description:\s*(.*)$/);
    if (tagDescription && !currentArg) {
      currentTag.description = tagDescription[1].trim();
      continue;
    }

    if (/^    - name:\s+/.test(line)) {
      flushArg();
      currentArg = { name: line.replace(/^    - name:\s+/, "").trim(), description: "", valueMap: {} };
      continue;
    }

    if (!currentArg) continue;

    const argDescription = line.match(/^      description:\s*(.*)$/);
    if (argDescription) {
      currentArg.description = argDescription[1].trim();
      continue;
    }

    if (/^\s*valueMap:\s*$/.test(line)) {
      inValueMap = true;
      continue;
    }

    if (inValueMap) {
      const match = line.match(/^\s{8}(-?\d+):\s*([A-Za-z0-9_]+)/);
      if (match) {
        currentArg.valueMap[match[1]] = match[2];
        continue;
      }
      if (!/^\s{8}/.test(line)) inValueMap = false;
    }
  }

  flushTag();
  return tags;
}

export function setGcfText(game, text) {
  const key = ensureGame(game);
  const tags = parseGcfTags(text);
  if (tags.length) registry[key] = { tags };
}
