import { getColorNameById } from "./GcfRegistry.js";

const BOTW_MSYT_GCF_TAG_NAMES = new Set([
  "color",
  "pageBreak",
  "choice2",
  "choice3",
  "choice4",
  "singleChoice",
  "icon",
  "size",
  "animation",
  "font",
  "setEmotion",
  "setEmotion2",
  "autoAdvance",
  "delay8",
  "delay15",
  "delay30",
  "delay",
  "string1",
  "number2",
  "number9",
  "number10",
  "string11",
  "string12",
  "number13",
  "number14",
  "number15",
  "number16",
  "number17",
  "number18",
  "number19"
]);

const MSYT_VARIABLE_KIND_TO_TAG = {
  1: "string1",
  2: "number2",
  9: "number9",
  11: "string11",
  12: "string12",
  14: "number14",
  15: "number15",
  16: "number16",
  17: "number17",
  18: "number18",
  19: "number19"
};

const MSYT_TAG_TO_VARIABLE_KIND = Object.fromEntries(
  Object.entries(MSYT_VARIABLE_KIND_TO_TAG).map(([kind, tag]) => [tag, Number(kind)])
);

const MSYT_RAW_ONE_FIELD_TO_TAG = {
  10: "number10",
  13: "number13"
};

const MSYT_TAG_TO_RAW_ONE_FIELD = Object.fromEntries(
  Object.entries(MSYT_RAW_ONE_FIELD_TO_TAG).map(([kind, tag]) => [tag, Number(kind)])
);

const BOTW_ICON_ID_TO_NAME = {
  0: "LStickUp",
  1: "LStickDown",
  2: "LStickLeft",
  3: "LStickRight",
  4: "RStickUpDown",
  5: "RStickRightLeft",
  6: "DPadUp",
  7: "DPadDown",
  8: "DPadLeft",
  9: "DPadRight",
  10: "AButton0",
  11: "AButton1",
  12: "JumpButton0",
  13: "YButton",
  14: "ZLTrigger0",
  15: "ZLTrigger1",
  17: "SprintButton1",
  20: "LBumper",
  21: "RBumper0",
  23: "PlusButton",
  24: "MinusButton",
  25: "RightArrow",
  26: "LeftArrow",
  27: "UpArrow",
  33: "LStick",
  34: "RStick",
  36: "Gamepad",
  37: "JumpButton1",
  38: "XButton2"
};

const BOTW_NAME_TO_ICON_ID = Object.fromEntries(Object.entries(BOTW_ICON_ID_TO_NAME).map(([id, name]) => [name, Number(id)]));

const BOTW_SET_EMOTION = {
  0: "Normal_Face",
  1: "Pleasure_Face",
  2: "Anger_Face",
  3: "Sorrow_Face",
  4: "Surprise_Face",
  5: "Thinking_Face",
  6: "Serious_Face",
  7: "Normal",
  8: "Pleasure",
  9: "Angry",
  10: "Sorrow",
  11: "Surprise",
  12: "Thinking",
  13: "Serious"
};

const BOTW_SET_EMOTION2 = {
  0: "Normal_Face",
  1: "Pleasure_Face",
  2: "Anger_Face",
  3: "Sorrow_Face",
  4: "Surprise_Face",
  5: "Thinking_Face",
  6: "Serious_Face",
  7: "Normal",
  8: "Pleasure",
  9: "Angry",
  10: "Sorrow",
  11: "Surprise",
  12: "Thinking",
  13: "Serious"
};

const MSYT_COLOR_TO_EDITOR = {
  red: "Red",
  light_green1: "Green",
  blue: "Cyan",
  grey: "Grey",
  light_green4: "Azure",
  orange: "Orange",
  light_grey: "DullGold"
};

const EDITOR_COLOR_TO_MSYT = Object.fromEntries(Object.entries(MSYT_COLOR_TO_EDITOR).map(([key, value]) => [value.toLowerCase(), key]));

export function isTagMappedToMsyt(name, game = "BotW") {
  if (game !== "BotW") return false;
  return BOTW_MSYT_GCF_TAG_NAMES.has(String(name || ""));
}

function normalizeNewlines(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseTI(inner) {
  const trimmed = String(inner || "").trim();
  const sp = trimmed.indexOf(" ");
  const name = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const args = {};
  for (const match of trimmed.matchAll(/(\w+)="([^"]*)"/g)) {
    args[match[1]] = match[2];
  }
  return { name, args };
}

function buildTagStr(name, args = {}, order = []) {
  const keys = order.length ? order : Object.keys(args);
  const parts = [name];
  keys.forEach((key) => {
    if (args[key] == null) return;
    parts.push(`${key}="${args[key]}"`);
  });
  return `{{${parts.join(" ")}}}`;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(text) {
  const bin = atob(String(text || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function makeMsytRawTag(control) {
  return buildTagStr("msyt", { json: utf8ToBase64(JSON.stringify(control)) });
}

function mapEmotionById(id, secondary = false) {
  const table = secondary ? BOTW_SET_EMOTION2 : BOTW_SET_EMOTION;
  return table[Number(id)] ?? String(id);
}

function mapEmotionIdByName(name, secondary = false) {
  const table = secondary ? BOTW_SET_EMOTION2 : BOTW_SET_EMOTION;
  for (const [id, value] of Object.entries(table)) {
    if (value === name) return Number(id);
  }
  return Number(name || 0);
}

function msytColorToEditorName(colour) {
  return MSYT_COLOR_TO_EDITOR[String(colour || "").toLowerCase()] || null;
}

function editorColorToMsyt(name) {
  return EDITOR_COLOR_TO_MSYT[String(name || "").toLowerCase()] || null;
}

function msytIconToEditorValue(icon) {
  if (typeof icon === "string") {
    const key = icon.toLowerCase();
    if (key === "l") return "LBumper";
    if (key === "r") return "RBumper0";
    if (key === "y") return "YButton";
    if (key === "b") return "SprintButton1";
    if (key === "plus") return "PlusButton";
    if (key === "minus") return "MinusButton";
    if (key === "d_pad_down") return "DPadDown";
    if (key === "d_pad_left") return "DPadLeft";
    if (key === "d_pad_right") return "DPadRight";
    if (key === "d_pad_up") return "DPadUp";
    if (key === "r_stick_horizontal") return "RStickRightLeft";
    if (key === "r_stick_press") return "RStick";
    if (key === "r_stick_vertical") return "RStickUpDown";
    if (key === "l_stick_back") return "LStickDown";
    if (key === "l_stick_forward") return "LStickUp";
    if (key === "l_stick_left") return "LStickLeft";
    if (key === "l_stick_press") return "LStick";
    if (key === "l_stick_right") return "LStickRight";
    if (key === "gamepad") return "Gamepad";
    if (key === "left_arrow") return "LeftArrow";
    if (key === "right_arrow") return "RightArrow";
    if (key === "up_arrow") return "UpArrow";
    return null;
  }
  if (icon && typeof icon === "object" && !Array.isArray(icon)) {
    if (icon.a != null) return BOTW_ICON_ID_TO_NAME[Number(icon.a)] || String(icon.a);
    if (icon.x != null) return BOTW_ICON_ID_TO_NAME[Number(icon.x)] || String(icon.x);
    if (icon.zl != null) return BOTW_ICON_ID_TO_NAME[Number(icon.zl)] || String(icon.zl);
    if (icon.unknown != null) return BOTW_ICON_ID_TO_NAME[Number(icon.unknown)] || String(icon.unknown);
  }
  return null;
}

function editorValueToMsytIcon(value) {
  const id = BOTW_NAME_TO_ICON_ID[value];
  if (id == null) return null;
  if (value === "LBumper") return "l";
  if (value === "RBumper0") return "r";
  if (value === "YButton") return "y";
  if (value === "SprintButton1") return "b";
  if (value === "PlusButton") return "plus";
  if (value === "MinusButton") return "minus";
  if (value === "DPadDown") return "d_pad_down";
  if (value === "DPadLeft") return "d_pad_left";
  if (value === "DPadRight") return "d_pad_right";
  if (value === "DPadUp") return "d_pad_up";
  if (value === "RStickRightLeft") return "r_stick_horizontal";
  if (value === "RStick") return "r_stick_press";
  if (value === "RStickUpDown") return "r_stick_vertical";
  if (value === "LStickDown") return "l_stick_back";
  if (value === "LStickUp") return "l_stick_forward";
  if (value === "LStickLeft") return "l_stick_left";
  if (value === "LStick") return "l_stick_press";
  if (value === "LStickRight") return "l_stick_right";
  if (value === "Gamepad") return "gamepad";
  if (value === "LeftArrow") return "left_arrow";
  if (value === "RightArrow") return "right_arrow";
  if (value === "UpArrow") return "up_arrow";
  if (id === 10 || id === 11) return { a: id };
  if (id === 12 || id === 37 || id === 38) return { x: id };
  if (id === 14 || id === 15) return { zl: id };
  return { unknown: id };
}

function msytChoiceTagName(labels) {
  return labels.length >= 2 && labels.length <= 4 ? `choice${labels.length}` : null;
}

// unknown choice2 -> 6 // choice3 -> 8 // choice4 -> 10
function msytChoiceUnknownDefault(count) {
  return count * 2 + 2;
}

function isMsytPageBreakControl(control) {
  return (
    !!control &&
    control.kind === "raw" &&
    control.zero &&
    control.zero.four &&
    Number(control.zero.four.field_1) === 0
  );
}

function msytRawOneFieldTagName(control) {
  const oneField = control?.two?.one_field;
  if (!Array.isArray(oneField) || oneField.length < 2) return null;
  const kind = Number(oneField[0]);
  const trailing = oneField[1];
  if (!Number.isFinite(kind) || !trailing || typeof trailing !== "object") return null;
  if (Number(trailing.field_1) !== 0) return null;
  return MSYT_RAW_ONE_FIELD_TO_TAG[kind] || null;
}

function msytControlToRaw(control) {
  if (!control || typeof control !== "object") return "";
  const kind = control.kind || "";
  if (isMsytPageBreakControl(control)) return "{{pageBreak}}";
  const rawOneFieldTag = msytRawOneFieldTagName(control);
  if (rawOneFieldTag) return buildTagStr(rawOneFieldTag);
  if (kind === "set_colour" && typeof control.colour === "string") {
    const editorName = msytColorToEditorName(control.colour);
    if (editorName) return buildTagStr("color", { id: editorName });
  }
  if (kind === "reset_colour") return buildTagStr("color", { id: "Default" });
  if (kind === "variable" && control.variable_kind != null && control.name != null) {
    const tagName = MSYT_VARIABLE_KIND_TO_TAG[Number(control.variable_kind)];
    if (tagName) {
      return buildTagStr(
        tagName,
        {
          ref: String(control.name),
          index: String(control.index ?? 0)
        },
        ["ref", "index"]
      );
    }
  }
  if (kind === "choice" && Array.isArray(control.choice_labels)) {
    const labels = control.choice_labels.map((value) => String(value));
    const tagName = msytChoiceTagName(labels);
    if (tagName) {
      const args = {};
      const order = [];
      labels.forEach((label, idx) => {
        const key = `label${idx + 1}`;
        order.push(key);
        args[key] = label;
      });
      order.push("selectedIndex", "cancelIndex");
      args.selectedIndex = String(control.selected_index ?? 0);
      args.cancelIndex = String(control.cancel_index ?? 0);
      return buildTagStr(tagName, args, order);
    }
  }
  if (kind === "single_choice" && control.label != null) {
    return buildTagStr("singleChoice", { label: String(control.label), confirmed: "1" });
  }
  if (kind === "icon" && control.icon != null) {
    const mapped = msytIconToEditorValue(control.icon);
    if (mapped) return buildTagStr("icon", { type: String(BOTW_NAME_TO_ICON_ID[mapped] ?? mapped) });
  }
  if (kind === "text_size" && control.percent != null) return buildTagStr("size", { value: String(control.percent) });
  if (kind === "animation" && typeof control.name === "string") return buildTagStr("animation", { name: control.name });
  if (kind === "font" && typeof control.font_kind === "string") {
    return buildTagStr("font", { face: control.font_kind === "hylian" ? "Hylian" : "Normal" });
  }
  if (kind === "sound" && Array.isArray(control.unknown) && control.unknown.length >= 2) {
    return buildTagStr("setEmotion", {
      emotion: mapEmotionById(control.unknown[0]),
      variant: String(control.unknown[1])
    });
  }
  if (kind === "sound2" && Array.isArray(control.unknown) && control.unknown.length >= 1) {
    return buildTagStr("setEmotion2", {
      emotion: mapEmotionById(control.unknown[0], true)
    });
  }
  if (kind === "auto_advance" && Number.isFinite(control.frames)) {
    const frames = Number(control.frames) >>> 0;
    return buildTagStr("autoAdvance", {
      framesLo: String(frames & 0xffff),
      framesHi: String((frames >>> 16) & 0xffff)
    });
  }
  if (kind === "pause") {
    if (typeof control.length === "string") {
      if (control.length === "short") return "{{delay8}}";
      if (control.length === "long") return "{{delay15}}";
      if (control.length === "longer") return "{{delay30}}";
    }
    if (Number.isFinite(control.frames)) {
      const frames = Number(control.frames) >>> 0;
      return buildTagStr("delay", {
        framesLo: String(frames & 0xffff),
        framesHi: String((frames >>> 16) & 0xffff)
      });
    }
  }
  return makeMsytRawTag(control);
}

function msytContentsToRaw(contents) {
  let out = "";
  for (const item of contents || []) {
    if (item && typeof item.text === "string") out += item.text;
    else if (item && item.control) out += msytControlToRaw(item.control);
  }
  return out;
}

function isMsytBcmlRoot(root) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return false;
  const locales = Object.keys(root);
  if (!locales.length) return false;
  for (const locale of locales) {
    const files = root[locale];
    if (!files || typeof files !== "object" || Array.isArray(files)) return false;
    for (const fileKey of Object.keys(files)) {
      const labels = files[fileKey];
      if (!labels || typeof labels !== "object" || Array.isArray(labels)) return false;
      for (const label of Object.keys(labels)) {
        const entry = labels[label];
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || !Array.isArray(entry.contents)) return false;
      }
    }
  }
  return true;
}

function msytYamlIndent(line) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function parseMsytYamlScalar(text) {
  const value = String(text).trim();
  if (value === "") return "";
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function parseMsytYamlKey(text) {
  const value = String(text).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function parseMsytYamlNode(lines, startIndex, indent) {
  let i = startIndex;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "---") {
      i++;
      continue;
    }
    const curIndent = msytYamlIndent(raw);
    if (curIndent < indent) return [null, i];
    break;
  }
  if (i >= lines.length) return [{}, i];
  const firstLine = lines[i];
  const firstTrimmed = firstLine.slice(indent);
  if (firstTrimmed.startsWith("- ")) {
    const arr = [];
    while (i < lines.length) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed) {
        i++;
        continue;
      }
      const curIndent = msytYamlIndent(raw);
      if (curIndent < indent) break;
      if (curIndent !== indent || !raw.slice(indent).startsWith("- ")) break;
      const rest = raw.slice(indent + 2);
      if (!rest.trim()) {
        const [val, next] = parseMsytYamlNode(lines, i + 1, indent + 2);
        arr.push(val);
        i = next;
        continue;
      }
      const match = rest.match(/^("([^"\\]|\\.)*"|'[^']*'|[^:]+):(.*)$/);
      if (match) {
        const key = parseMsytYamlKey(match[1]);
        const after = match[3].trimStart();
        if (after === "") {
          const [val, next] = parseMsytYamlNode(lines, i + 1, indent + 4);
          arr.push({ [key]: val });
          i = next;
          continue;
        }
        arr.push({ [key]: parseMsytYamlScalar(after) });
        i++;
        continue;
      }
      arr.push(parseMsytYamlScalar(rest));
      i++;
    }
    return [arr, i];
  }

  const obj = {};
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const curIndent = msytYamlIndent(raw);
    if (curIndent < indent) break;
    if (curIndent !== indent) throw new Error(`Unexpected indentation in msyt near: ${trimmed}`);
    const line = raw.slice(indent);
    if (line.startsWith("- ")) break;
    const match = line.match(/^("([^"\\]|\\.)*"|'[^']*'|[^:]+):(.*)$/);
    if (!match) throw new Error(`Unsupported msyt YAML line: ${line}`);
    const key = parseMsytYamlKey(match[1]);
    const after = match[3].trimStart();
    if (after === "") {
      const [val, next] = parseMsytYamlNode(lines, i + 1, indent + 2);
      obj[key] = val;
      i = next;
      continue;
    }
    obj[key] = parseMsytYamlScalar(after);
    i++;
  }
  return [obj, i];
}

export function parseMsytYaml(text) {
  const lines = normalizeNewlines(text).split("\n");
  const meta = {};
  const entries = [];
  let foundEntries = false;
  for (let i = 0; i < lines.length;) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed === "---") {
      i++;
      continue;
    }
    const indent = msytYamlIndent(rawLine);
    if (indent !== 0) throw new Error(`Unexpected top-level indentation in msyt near: ${trimmed}`);
    const match = rawLine.match(/^("([^"\\]|\\.)*"|'[^']*'|[^:]+):(.*)$/);
    if (!match) throw new Error(`Unsupported msyt YAML line: ${rawLine}`);
    const key = String(parseMsytYamlKey(match[1]));
    const after = match[3].trimStart();
    if (key !== "entries") {
      if (after === "") {
        const [value, next] = parseMsytYamlNode(lines, i + 1, 2);
        meta[key] = value;
        i = next;
      } else {
        meta[key] = parseMsytYamlScalar(after);
        i++;
      }
      continue;
    }
    if (after !== "") throw new Error("Unsupported inline entries block in .msyt");
    foundEntries = true;
    i++;
    while (i < lines.length) {
      const entryLine = lines[i];
      const entryTrimmed = entryLine.trim();
      if (!entryTrimmed) {
        i++;
        continue;
      }
      const entryIndent = msytYamlIndent(entryLine);
      if (entryIndent <= 0) break;
      if (entryIndent !== 2 || entryTrimmed.startsWith("- ")) {
        throw new Error(`Unsupported msyt entry line: ${entryTrimmed}`);
      }
      const entryMatch = entryLine.slice(2).match(/^("([^"\\]|\\.)*"|'[^']*'|[^:]+):(.*)$/);
      if (!entryMatch) throw new Error(`Unsupported msyt entry header: ${entryTrimmed}`);
      const label = String(parseMsytYamlKey(entryMatch[1]));
      const entryAfter = entryMatch[3].trimStart();
      let entry = {};
      if (entryAfter === "") {
        const [value, next] = parseMsytYamlNode(lines, i + 1, 4);
        entry = value && typeof value === "object" && !Array.isArray(value) ? value : {};
        i = next;
      } else {
        const inlineValue = parseMsytYamlScalar(entryAfter);
        entry = inlineValue && typeof inlineValue === "object" && !Array.isArray(inlineValue) ? inlineValue : {};
        i++;
      }
      entries.push({
        label,
        attrKey: "attributes",
        attrVal: entry.attributes != null ? String(entry.attributes) : "",
        msytHasAttributes: entry.attributes != null,
        content: msytContentsToRaw(entry.contents || []),
        docKey: String(label)
      });
    }
  }
  if (!foundEntries || !Number.isFinite(Number(meta.group_count))) {
    throw new Error("Unsupported .msyt structure");
  }
  return { entries, meta };
}

function formatMsytYamlKey(key) {
  const value = String(key);
  if (/^\d+$/.test(value)) return JSON.stringify(value);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : JSON.stringify(value);
}

function formatMsytYamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (text === "") return '""';
  if (
    text === "." ||
    text === "..." ||
    text === "---" ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(text) ||
    /[\n\r\t,:'"]/.test(text) ||
    /—/.test(text) ||
    /\s$|^\s/.test(text) ||
    /^(null|Null|NULL|true|True|TRUE|false|False|FALSE|~)$/.test(text) ||
    /^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)
  ) {
    return JSON.stringify(text);
  }
  return text;
}

function dumpMsytYamlNode(value, indent = 0) {
  const sp = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${sp}[]`;
    const lines = [];
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (entries.length === 1) {
          const [key, nested] = entries[0];
          if (nested && typeof nested === "object") {
            lines.push(`${sp}- ${formatMsytYamlKey(key)}:`);
            lines.push(dumpMsytYamlNode(nested, indent + 4));
          } else {
            lines.push(`${sp}- ${formatMsytYamlKey(key)}: ${formatMsytYamlScalar(nested)}`);
          }
        } else {
          lines.push(`${sp}-`);
          lines.push(dumpMsytYamlNode(item, indent + 2));
        }
      } else {
        lines.push(`${sp}- ${formatMsytYamlScalar(item)}`);
      }
    }
    return lines.join("\n");
  }
  if (value && typeof value === "object") {
    const lines = [];
    for (const [key, nested] of Object.entries(value)) {
      if (nested && typeof nested === "object") {
        if (Array.isArray(nested) && !nested.length) lines.push(`${sp}${formatMsytYamlKey(key)}: []`);
        else {
          lines.push(`${sp}${formatMsytYamlKey(key)}:`);
          lines.push(dumpMsytYamlNode(nested, indent + 2));
        }
      } else {
        lines.push(`${sp}${formatMsytYamlKey(key)}: ${formatMsytYamlScalar(nested)}`);
      }
    }
    return lines.join("\n");
  }
  return `${sp}${formatMsytYamlScalar(value)}`;
}

export function parseMsytBcmlJson(text) {
  const root = JSON.parse(text);
  if (!isMsytBcmlRoot(root)) throw new Error("Unsupported texts.json structure");
  const normalized = normalizeNewlines(text);
  const skipWs = (index) => {
    let i = index;
    while (i < normalized.length && /\s/.test(normalized[i])) i++;
    return i;
  };
  const parseString = (index) => {
    if (normalized[index] !== '"') throw new Error("Expected JSON string");
    let i = index + 1;
    let escaped = false;
    while (i < normalized.length) {
      const ch = normalized[i];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        const token = normalized.slice(index, i + 1);
        return [JSON.parse(token), i + 1];
      }
      i++;
    }
    throw new Error("Unterminated JSON string");
  };
  const skipValue = (index) => {
    let i = skipWs(index);
    const ch = normalized[i];
    if (ch === "{") {
      i = skipWs(i + 1);
      if (normalized[i] === "}") return i + 1;
      while (i < normalized.length) {
        const [, nextKey] = parseString(i);
        i = skipWs(nextKey);
        if (normalized[i] !== ":") throw new Error("Expected : in JSON object");
        i = skipValue(i + 1);
        i = skipWs(i);
        if (normalized[i] === "}") return i + 1;
        if (normalized[i] !== ",") throw new Error("Expected , in JSON object");
        i = skipWs(i + 1);
      }
      throw new Error("Unterminated JSON object");
    }
    if (ch === "[") {
      i = skipWs(i + 1);
      if (normalized[i] === "]") return i + 1;
      while (i < normalized.length) {
        i = skipValue(i);
        i = skipWs(i);
        if (normalized[i] === "]") return i + 1;
        if (normalized[i] !== ",") throw new Error("Expected , in JSON array");
        i = skipWs(i + 1);
      }
      throw new Error("Unterminated JSON array");
    }
    if (ch === '"') return parseString(i)[1];
    const primitive = normalized.slice(i).match(/^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!primitive) throw new Error("Unsupported JSON value");
    return i + primitive[1].length;
  };
  const parseObjectOrder = (index, level) => {
    let i = skipWs(index);
    if (normalized[i] !== "{") throw new Error("Expected JSON object");
    i = skipWs(i + 1);
    const items = [];
    if (normalized[i] === "}") return [items, i + 1];
    while (i < normalized.length) {
      const [key, nextKey] = parseString(i);
      i = skipWs(nextKey);
      if (normalized[i] !== ":") throw new Error("Expected : after JSON key");
      i = skipWs(i + 1);
      if (level < 2) {
        const [children, next] = parseObjectOrder(i, level + 1);
        items.push({ key, children });
        i = next;
      } else {
        i = skipValue(i);
        items.push({ key });
      }
      i = skipWs(i);
      if (normalized[i] === "}") return [items, i + 1];
      if (normalized[i] !== ",") throw new Error("Expected , after JSON property");
      i = skipWs(i + 1);
    }
    throw new Error("Unterminated JSON object");
  };
  const [orderedLocales] = parseObjectOrder(0, 0);
  const entries = [];
  const defaultLocale = orderedLocales[0]?.key || "EUen";
  let defaultPath = "NewFile.msyt";
  for (const localeNode of orderedLocales) {
    const locale = localeNode.key;
    const files = root[locale];
    if (!files || typeof files !== "object" || Array.isArray(files)) continue;
    for (const pathNode of localeNode.children || []) {
      const path = pathNode.key;
      if (defaultPath === "NewFile.msyt") defaultPath = path;
      const labels = files[path];
      if (!labels || typeof labels !== "object" || Array.isArray(labels)) continue;
      for (const labelNode of pathNode.children || []) {
        const label = labelNode.key;
        const entry = labels[label] || {};
        entries.push({
          label: String(label),
          attrKey: "attributes",
          attrVal: entry.attributes != null ? String(entry.attributes) : "",
          msytHasAttributes: entry.attributes != null,
          content: msytContentsToRaw(entry.contents || []),
          msytLocale: locale,
          msytPath: path,
          docKey: `${locale}::${path}::${label}`
        });
      }
    }
  }
  return { entries, defaultLocale, defaultPath };
}

function tryParseMsytControlFromRaw(rawTag) {
  const { name, args } = parseTI(rawTag.slice(2, -2));
  if (name === "pageBreak") return { kind: "raw", zero: { four: { field_1: 0 } } };
  if (name === "msyt" && args.json) return JSON.parse(base64ToUtf8(args.json));
  if (MSYT_TAG_TO_RAW_ONE_FIELD[name] != null) {
    return {
      kind: "raw",
      two: {
        one_field: [MSYT_TAG_TO_RAW_ONE_FIELD[name], { field_1: 0 }]
      }
    };
  }
  if (name === "color") {
    const id = args.id || "-1";
    if (id === "Default" || id === "-1") return { kind: "reset_colour" };
    const editorName = getColorNameById("BotW", id);
    const colour = editorColorToMsyt(editorName);
    if (colour) return { kind: "set_colour", colour };
    return { kind: "set_colour", colour: String(editorName).toLowerCase() };
  }
  if (/^choice[234]$/.test(name)) {
    const count = Number(name.slice(-1));
    const choice_labels = [];
    for (let i = 1; i <= count; i++) choice_labels.push(Number(args[`label${i}`] || 0));
    return {
      kind: "choice",
      choice_labels,
      selected_index: Number(args.selectedIndex ?? 0),
      cancel_index: Number(args.cancelIndex ?? 0),
      unknown: msytChoiceUnknownDefault(count)
    };
  }
  if (name === "singleChoice") return { kind: "single_choice", label: Number(args.label || 0) };
  if (MSYT_TAG_TO_VARIABLE_KIND[name] != null) {
    const control = {
      kind: "variable",
      variable_kind: MSYT_TAG_TO_VARIABLE_KIND[name],
      name: String(args.ref || "")
    };
    if (args.index != null && args.index !== "" && Number(args.index) !== 0) {
      control.index = Number(args.index);
    }
    return control;
  }
  if (name === "icon") {
    const mapped = BOTW_ICON_ID_TO_NAME[Number(args.type || 0)];
    const icon = editorValueToMsytIcon(mapped || String(args.type || 0));
    if (icon != null) return { kind: "icon", icon };
  }
  if (name === "size") return { kind: "text_size", percent: Number(args.value || 100) };
  if (name === "animation") return { kind: "animation", name: args.name || "" };
  if (name === "font") return { kind: "font", font_kind: (args.face || "Normal") === "Hylian" ? "hylian" : "normal" };
  if (name === "setEmotion") {
    return {
      kind: "sound",
      unknown: [mapEmotionIdByName(args.emotion, false), Number(args.variant || 0)]
    };
  }
  if (name === "setEmotion2") {
    return {
      kind: "sound2",
      unknown: [mapEmotionIdByName(args.emotion, true), 205]
    };
  }
  if (name === "autoAdvance") {
    const lo = Number(args.framesLo || 0) & 0xffff;
    const hi = Number(args.framesHi || 0) & 0xffff;
    return { kind: "auto_advance", frames: ((hi << 16) >>> 0) | lo };
  }
  if (name === "delay8") return { kind: "pause", length: "short" };
  if (name === "delay15") return { kind: "pause", length: "long" };
  if (name === "delay30") return { kind: "pause", length: "longer" };
  if (name === "delay") {
    const lo = Number(args.framesLo || 0) & 0xffff;
    const hi = Number(args.framesHi || 0) & 0xffff;
    return { kind: "pause", frames: ((hi << 16) >>> 0) | lo };
  }
  return null;
}

export function rawToMsytContents(raw) {
  const contents = [];
  let last = 0;
  for (const match of String(raw || "").matchAll(/\{\{([^}]*)\}\}/g)) {
    const text = raw.slice(last, match.index);
    if (text) contents.push({ text });
    last = match.index + match[0].length;
    const control = tryParseMsytControlFromRaw(match[0]);
    if (!control) throw new Error(`Unsupported msyt control tag: ${match[0]}`);
    contents.push({ control });
  }
  const tail = raw.slice(last);
  if (tail) contents.push({ text: tail });
  return contents;
}

export function buildMsytBcmlJson(chains, msytDocInfo) {
  if (!chains.length) throw new Error("There is nothing to export");
  const locales = [];
  const findBy = (items, key, value) => {
    for (const item of items) {
      if (item[key] === value) return item;
    }
    return null;
  };
  for (const chain of chains) {
    const locale = chain.msytLocale || msytDocInfo.defaultLocale || "EUen";
    const path = chain.msytPath || msytDocInfo.defaultPath || "NewFile.msyt";
    const label = chain.label || "";
    const raw = chain.msytRaw ?? chain.raw;
    let localeNode = findBy(locales, "locale", locale);
    if (!localeNode) {
      localeNode = { locale, paths: [] };
      locales.push(localeNode);
    }
    let pathNode = findBy(localeNode.paths, "path", path);
    if (!pathNode) {
      pathNode = { path, labels: [] };
      localeNode.paths.push(pathNode);
    }
    pathNode.labels.push({
      label,
      entry: {
        ...(chain.msytHasAttributes || chain.attrVal !== "" ? { attributes: chain.attrVal } : {}),
        contents: rawToMsytContents(raw)
      }
    });
  }
  const dumpValue = (value, indent) => {
    const sp = " ".repeat(indent);
    if (Array.isArray(value)) {
      if (!value.length) return "[]";
      return `[\n${value.map((item) => `${" ".repeat(indent + 2)}${dumpValue(item, indent + 2)}`).join(",\n")}\n${sp}]`;
    }
    if (value && typeof value === "object") {
      const pairs = Object.entries(value);
      if (!pairs.length) return "{}";
      return `{\n${pairs
        .map(([key, nested]) => `${" ".repeat(indent + 2)}${JSON.stringify(String(key))}: ${dumpValue(nested, indent + 2)}`)
        .join(",\n")}\n${sp}}`;
    }
    return JSON.stringify(value);
  };
  const lines = ["{"];
  locales.forEach((localeNode, localeIndex) => {
    lines.push(`  ${JSON.stringify(localeNode.locale)}: {`);
    localeNode.paths.forEach((pathNode, pathIndex) => {
      lines.push(`    ${JSON.stringify(pathNode.path)}: {`);
      pathNode.labels.forEach((labelNode, labelIndex) => {
        const suffix = labelIndex === pathNode.labels.length - 1 ? "" : ",";
        lines.push(`      ${JSON.stringify(String(labelNode.label))}: ${dumpValue(labelNode.entry, 6)}${suffix}`);
      });
      const pathSuffix = pathIndex === localeNode.paths.length - 1 ? "" : ",";
      lines.push(`    }${pathSuffix}`);
    });
    const localeSuffix = localeIndex === locales.length - 1 ? "" : ",";
    lines.push(`  }${localeSuffix}`);
  });
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

export function buildMsytYaml(chains, msytDocInfo) {
  if (!chains.length) throw new Error("There is nothing to export");
  const meta =
    msytDocInfo && msytDocInfo.msytMeta && typeof msytDocInfo.msytMeta === "object"
      ? msytDocInfo.msytMeta
      : { group_count: 0 };
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (key === "entries") continue;
    if (value && typeof value === "object") {
      if (Array.isArray(value) && !value.length) lines.push(`${formatMsytYamlKey(key)}: []`);
      else {
        lines.push(`${formatMsytYamlKey(key)}:`);
        lines.push(dumpMsytYamlNode(value, 2));
      }
    } else {
      lines.push(`${formatMsytYamlKey(key)}: ${formatMsytYamlScalar(value)}`);
    }
  }
  lines.push("entries:");
  for (const chain of chains) {
    const raw = chain.msytRaw ?? chain.raw;
    lines.push(`  ${formatMsytYamlKey(chain.label || "")}:`);
    lines.push(
      dumpMsytYamlNode(
        {
          ...(chain.msytHasAttributes || chain.attrVal !== "" ? { attributes: chain.attrVal } : {}),
          contents: rawToMsytContents(raw)
        },
        4
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
