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
  let tagIndent = null;
  let argIndent = null;
  let valueMapIndent = null;

  const flushArg = () => {
    if (!currentArg || !currentTag) return;
    currentTag.args.push(currentArg);
    currentArg = null;
    argIndent = null;
    inValueMap = false;
    valueMapIndent = null;
  };

  const flushTag = () => {
    flushArg();
    if (!currentTag) return;
    tags.push(currentTag);
    currentTag = null;
    tagIndent = null;
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

    const nameMatch = line.match(/^(\s*)- name:\s+(.*)$/);
    if (nameMatch) {
      const indent = nameMatch[1].length;
      const name = nameMatch[2].trim();
      if (!currentTag || tagIndent == null || indent <= tagIndent) {
        flushTag();
        currentTag = { name, description: "", args: [] };
        tagIndent = indent;
      } else {
        flushArg();
        currentArg = { name, description: "", valueMap: {} };
        argIndent = indent;
      }
      continue;
    }

    if (!currentTag) continue;

    if (inValueMap) {
      const valueMatch = line.match(/^(\s*)(-?\d+):\s*([A-Za-z0-9_]+)/);
      if (valueMatch && valueMatch[1].length > valueMapIndent) {
        currentArg.valueMap[valueMatch[2]] = valueMatch[3];
        continue;
      }
      if (line.trim() && line.match(/^(\s*)/)?.[1].length <= valueMapIndent) {
        inValueMap = false;
        valueMapIndent = null;
      }
    }

    const descriptionMatch = line.match(/^(\s*)description:\s*(.*)$/);
    if (descriptionMatch) {
      const indent = descriptionMatch[1].length;
      if (currentArg && argIndent != null && indent > argIndent) currentArg.description = descriptionMatch[2].trim();
      else if (!currentArg && tagIndent != null && indent > tagIndent) currentTag.description = descriptionMatch[2].trim();
      continue;
    }

    if (currentArg) {
      const valueMapMatch = line.match(/^(\s*)valueMap:\s*$/);
      if (valueMapMatch && argIndent != null && valueMapMatch[1].length > argIndent) {
        inValueMap = true;
        valueMapIndent = valueMapMatch[1].length;
      }
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
