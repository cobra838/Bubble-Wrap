import { getColorNameById } from "./GcfRegistry.js";

const BOTW_MSYT_GCF_TAG_NAMES = new Set([
  "ruby",
  "color",
  "pageBreak",
  "choice2",
  "choice3",
  "choice4",
  "choiceByFlags",
  "fiveFlags",
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
  "textSpeed",
  "string1",
  "number2",
  "currentHorseName",
  "selectedHorseName",
  "cookingAdjective",
  "cookingEffectCaption",
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
  "number19",
  "noTextScroll",
  "setVoice",
  "wordInfo",
  "pluralCase",
  "gender",
  "uppercaseNextWord",
  "lowercaseNextWord"
]);

// TODO Korean: "batchimObject", "batchimDirection"


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
  3: "currentHorseName",
  4: "selectedHorseName",
  7: "cookingAdjective",
  8: "cookingEffectCaption",
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
  5: "RStickLeftRight",
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
  25: "ArrowRight",
  26: "ArrowLeft",
  27: "ArrowUp",
  33: "LStick",
  34: "RStick",
  36: "Gamepad",
  37: "JumpButton1",
  38: "XButton0"
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
  return Number(name);
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
    if (key === "r_stick_horizontal") return "RStickLeftRight";
    if (key === "r_stick_press") return "RStick";
    if (key === "r_stick_vertical") return "RStickUpDown";
    if (key === "l_stick_back") return "LStickDown";
    if (key === "l_stick_forward") return "LStickUp";
    if (key === "l_stick_left") return "LStickLeft";
    if (key === "l_stick_press") return "LStick";
    if (key === "l_stick_right") return "LStickRight";
    if (key === "gamepad") return "Gamepad";
    if (key === "left_arrow") return "ArrowLeft";
    if (key === "right_arrow") return "ArrowRight";
    if (key === "up_arrow") return "ArrowUp";
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
  if (value === "RStickLeftRight") return "r_stick_horizontal";
  if (value === "RStick") return "r_stick_press";
  if (value === "RStickUpDown") return "r_stick_vertical";
  if (value === "LStickDown") return "l_stick_back";
  if (value === "LStickUp") return "l_stick_forward";
  if (value === "LStickLeft") return "l_stick_left";
  if (value === "LStick") return "l_stick_press";
  if (value === "LStickRight") return "l_stick_right";
  if (value === "Gamepad") return "gamepad";
  if (value === "ArrowLeft") return "left_arrow";
  if (value === "ArrowRight") return "right_arrow";
  if (value === "ArrowUp") return "up_arrow";
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

function isMsytNoTextScrollControl(control) {
  return !!control && control.kind === "raw" && control.one && control.one.two && Number(control.one.two.field_1) === 0;
}

function isMsytUppercaseNextWordControl(control) {
  const oneField = control?.two_hundred_one?.one_field;
  if (!control || control.kind !== "raw" || !Array.isArray(oneField) || oneField.length < 2) return false;
  return Number(oneField[0]) === 3 && Number(oneField[1]?.field_1) === 0;
}

function isMsytLowercaseNextWordControl(control) {
  const oneField = control?.two_hundred_one?.one_field;
  if (!control || control.kind !== "raw" || !Array.isArray(oneField) || oneField.length < 2) return false;
  return Number(oneField[0]) === 4 && Number(oneField[1]?.field_1) === 0;
}

function msytTextSpeedValue(control) {
  const block = control?.one?.one;
  if (!control || control.kind !== "raw" || !block) return null;
  if (Number(block.field_1) !== 4 || !Number.isFinite(Number(block.field_2))) return null;
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, Number(block.field_2), true);
  const value = view.getFloat32(0, true);
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function msytSetVoiceAsset(control) {
  if (!control || control.kind !== "raw" || !control.four || !control.four.zero) return null;
  if (Number(control.four.zero.field_1) !== 10 || typeof control.four.zero.string !== "string") return null;
  return control.four.zero.string;
}

function isMsytRawFourThreeControl(control) {
  return !!control && control.kind === "raw" && control.four && control.four.three && Number(control.four.three.field_1) === 0;
}

function msytWordInfoArgs(control) {
  const dynamic = control?.two_hundred_one?.dynamic;
  if (!control || control.kind !== "raw" || !Array.isArray(dynamic) || dynamic.length < 2) return null;
  if (Number(dynamic[0]) !== 0) return null;
  const payload = dynamic[1];
  if (!payload || Number(payload.len) !== 4 || !Array.isArray(payload.field_2) || payload.field_2.length < 4) return null;
  return {
    gender: String(payload.field_2[0]),
    defArticle: String(payload.field_2[1]),
    indefArticle: String(payload.field_2[2]),
    isPlural: payload.field_2[3] ? "true" : "false"
  };
}

function msytRubyInfo(control) {
  const zero = control?.zero?.zero;
  if (!control || control.kind !== "raw" || !zero) return null;
  const valueBytes = Number(zero.field_3);
  const byteSpan = Number(zero.field_2);
  if (!Number.isInteger(valueBytes) || valueBytes < 0 || valueBytes % 2 !== 0) return null;
  if (!Number.isInteger(byteSpan) || byteSpan < 0 || byteSpan > 0xffff) return null;
  if (Number(zero.field_1) !== valueBytes + 4) return null;
  return { byteSpan, valueLength: valueBytes / 2 };
}

// Helper func for "choiceByFlags" and "fiveFlags"
function readMsytWordString(words, cursor) {
  const len = Math.floor(Number(words[cursor.index++] || 0) / 2);
  let text = "";
  for (let i = 0; i < len; i++) text += String.fromCharCode(Number(words[cursor.index++] || 0));
  return text;
}
function pushMsytWordString(words, text) {
  const value = String(text || "");
  words.push(value.length * 2);
  for (let i = 0; i < value.length; i++) words.push(value.charCodeAt(i));
}
function readMsytByteWord(bytes, offset = 0) {
  return (((Number(bytes?.[offset] || 0) & 0xff) << 8) | (Number(bytes?.[offset + 1] || 0) & 0xff)) & 0xffff;
}
function msytByteWord(value) {
  const v = Number(value) & 0xffff;
  return [(v >>> 8) & 0xff, v & 0xff];
}
function appendMsytUnknownPairs(words, value) {
  if (!Array.isArray(value)) return;
  if (Array.isArray(value[0])) {
    value.forEach((chunk) => {
      words.push(readMsytByteWord(chunk, 0), readMsytByteWord(chunk, 2));
    });
    return;
  }
  for (let i = 0; i + 3 < value.length; i += 4) {
    words.push(readMsytByteWord(value, i), readMsytByteWord(value, i + 2));
  }
}

function msytChoiceByFlagsArgs(control) {
  const block = control?.one?.eight;
  if (!control || control.kind !== "raw" || !block || !Array.isArray(block.field_1) || !Array.isArray(block.field_2)) return null;
  const words = [];
  appendMsytUnknownPairs(words, block.unknown_1);
  block.field_1.forEach((value) => words.push(Number(value) & 0xffff));
  const cursor = { index: 0 };
  return {
    varType: String(Number(words[cursor.index++] || 0) & 0xffff),
    flag1: readMsytWordString(words, cursor),
    choice1: String(Number(words[cursor.index++] || 0) & 0xffff),
    flag2: readMsytWordString(words, cursor),
    choice2: String(Number(words[cursor.index++] || 0) & 0xffff),
    flag3: readMsytWordString(words, cursor),
    choice3: String(Number(words[cursor.index++] || 0) & 0xffff),
    default: String(readMsytByteWord(block.field_2, 0)),
    cancel: String(readMsytByteWord(block.field_2, 2))
  };
}

function msytFiveFlagsArgs(control) {
  const block = control?.one?.nine;
  if (!control || control.kind !== "raw" || !block || !Array.isArray(block.strings) || !Array.isArray(block.field_6)) return null;
  const words = [];
  appendMsytUnknownPairs(words, block.unknown_1);
  block.strings.forEach((item) => {
    words.push(Number(item?.field_1 || 0) & 0xffff);
    pushMsytWordString(words, item?.string || "");
  });
  words.push(Number(block.field_3 || 0) & 0xffff, Number(block.field_4 || 0) & 0xffff);
  appendMsytUnknownPairs(words, block.unknown_2);
  const cursor = { index: 0 };
  return {
    flagIdx1: String(Number(words[cursor.index++] || 0) & 0xffff),
    name1: readMsytWordString(words, cursor),
    flagIdx2: String(Number(words[cursor.index++] || 0) & 0xffff),
    name2: readMsytWordString(words, cursor),
    flagIdx3: String(Number(words[cursor.index++] || 0) & 0xffff),
    name3: readMsytWordString(words, cursor),
    flagIdx4: String(Number(words[cursor.index++] || 0) & 0xffff),
    name4: readMsytWordString(words, cursor),
    flagIdx5: String(Number(words[cursor.index++] || 0) & 0xffff),
    name5: readMsytWordString(words, cursor),
    slot1: String(Number(words[cursor.index++] || 0) & 0xffff),
    cond1: String(Number(words[cursor.index++] || 0) & 0xffff),
    slot2: String(Number(words[cursor.index++] || 0) & 0xffff),
    cond2: String(Number(words[cursor.index++] || 0) & 0xffff),
    slot3: String(Number(words[cursor.index++] || 0) & 0xffff),
    cond3: String(Number(words[cursor.index++] || 0) & 0xffff),
    cancel: String(readMsytByteWord(block.field_6, 0))
  };
}

function buildMsytChoiceByFlagsControl(args) {
  const field_1 = [];
  const unknown_1 = [];
  const varType = Number(args.varType) & 0xffff;
  const flag1 = String(args.flag1);
  if (varType === 0xffff && flag1 === "") {
    unknown_1.push([255, 255, 0, 0]);
  } else {
    field_1.push(varType);
    pushMsytWordString(field_1, flag1);
  }
  field_1.push(Number(args.choice1) & 0xffff);
  pushMsytWordString(field_1, args.flag2);
  field_1.push(Number(args.choice2) & 0xffff);
  pushMsytWordString(field_1, args.flag3);
  field_1.push(Number(args.choice3) & 0xffff);
  return {
    kind: "raw",
    one: {
      eight: {
        unknown_1,
        field_1,
        field_2: [...msytByteWord(args.default), ...msytByteWord(args.cancel)]
      }
    }
  };
}

function isMsytEmptyFlagPair(words, offset) {
  return (Number(words[offset]) & 0xffff) === 0xffff && Number(words[offset + 1] || 0) === 0;
}

function readMsytStringEntry(words, cursor) {
  const field_1 = Number(words[cursor.index++] || 0) & 0xffff;
  const string = readMsytWordString(words, cursor);
  return { field_1, string };
}

function buildMsytFiveFlagsControl(args) {
  const words = [];
  for (let i = 1; i <= 5; i++) {
    words.push(Number(args[`flagIdx${i}`]) & 0xffff);
    pushMsytWordString(words, args[`name${i}`]);
  }
  for (let i = 1; i <= 3; i++) {
    words.push(Number(args[`slot${i}`]) & 0xffff, Number(args[`cond${i}`]) & 0xffff);
  }

  let unknown_1 = null;
  if (isMsytEmptyFlagPair(words, 0) && isMsytEmptyFlagPair(words, 2) && isMsytEmptyFlagPair(words, 4)) {
    unknown_1 = [255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0];
    words.splice(0, 6);
  }

  const cursor = { index: 0 };
  const strings = [
    readMsytStringEntry(words, cursor),
    readMsytStringEntry(words, cursor),
    readMsytStringEntry(words, cursor),
    readMsytStringEntry(words, cursor)
  ];
  const field_3 = Number(words[cursor.index++] || 0) & 0xffff;
  const field_4 = Number(words[cursor.index++] || 0) & 0xffff;

  let unknown_2 = null;
  if (isMsytEmptyFlagPair(words, cursor.index) && isMsytEmptyFlagPair(words, cursor.index + 2) && isMsytEmptyFlagPair(words, cursor.index + 4)) {
    unknown_2 = [255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0];
  }

  return {
    kind: "raw",
    one: {
      nine: {
        unknown_1,
        strings,
        field_3,
        field_4,
        unknown_2,
        field_6: msytByteWord(args.cancel)
      }
    }
  };
}

function msytControlToRaw(control) {
  if (!control || typeof control !== "object") return "";
  const kind = control.kind || "";
  if (isMsytPageBreakControl(control)) return "{{pageBreak}}";
  const rawOneFieldTag = msytRawOneFieldTagName(control);
  if (rawOneFieldTag) return buildTagStr(rawOneFieldTag);
  if (isMsytNoTextScrollControl(control)) return "{{noTextScroll}}";
  if (isMsytUppercaseNextWordControl(control)) return "{{uppercaseNextWord}}";
  if (isMsytLowercaseNextWordControl(control)) return "{{lowercaseNextWord}}";
  const textSpeedValue = msytTextSpeedValue(control);
  if (textSpeedValue != null) return buildTagStr("textSpeed", { value: textSpeedValue }, ["value"]);
  const setVoiceAsset = msytSetVoiceAsset(control);
  if (setVoiceAsset != null) return buildTagStr("setVoice", { asset: setVoiceAsset }, ["asset"]);
  if (isMsytRawFourThreeControl(control)) return "{{4:3}}";
  const wordInfoArgs = msytWordInfoArgs(control);
  if (wordInfoArgs) return buildTagStr("wordInfo", wordInfoArgs, ["gender", "defArticle", "indefArticle", "isPlural"]);
  const choiceByFlagsArgs = msytChoiceByFlagsArgs(control);
  if (choiceByFlagsArgs) return buildTagStr("choiceByFlags", choiceByFlagsArgs, ["varType", "flag1", "choice1", "flag2", "choice2", "flag3", "choice3", "default", "cancel"]);
  const fiveFlagsArgs = msytFiveFlagsArgs(control);
  if (fiveFlagsArgs) return buildTagStr("fiveFlags", fiveFlagsArgs, ["flagIdx1", "name1", "flagIdx2", "name2", "flagIdx3", "name3", "flagIdx4", "name4", "flagIdx5", "name5", "slot1", "cond1", "slot2", "cond2", "slot3", "cond3", "cancel"]);
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
  if (kind === "localisation" && control.localisation_kind === "plural" && Array.isArray(control.options) && control.options.length >= 3) {
    return buildTagStr(
      "pluralCase",
      {
        arg1: String(control.options[0] ?? ""),
        arg2: String(control.options[1] ?? ""),
        arg3: String(control.options[2] ?? "")
      },
      ["arg1", "arg2", "arg3"]
    );
  }
  if (kind === "localisation" && control.localisation_kind === "gender" && Array.isArray(control.options) && control.options.length >= 3) {
    return buildTagStr(
      "gender",
      {
        m: String(control.options[0] ?? ""),
        f: String(control.options[1] ?? ""),
        n: String(control.options[2] ?? "")
      },
      ["m", "f", "n"]
    );
  }
  if (kind === "icon" && control.icon != null) {
    const mapped = msytIconToEditorValue(control.icon);
    if (mapped) return buildTagStr("icon", { type: String(mapped) });
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
      framesLo: String((frames >>> 16) & 0xffff),
      framesHi: String(frames & 0xffff)
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
        framesLo: String((frames >>> 16) & 0xffff),
        framesHi: String(frames & 0xffff)
      });
    }
  }
  return makeMsytRawTag(control);
}

function msytContentsToRaw(contents) {
  let out = "";
  for (let index = 0; index < (contents || []).length; index++) {
    const item = contents[index];
    if (item && typeof item.text === "string") out += item.text;
    else if (item && item.control) {
      const ruby = msytRubyInfo(item.control);
      const next = contents[index + 1];
      if (ruby && typeof next?.text === "string" && next.text.length >= ruby.valueLength) {
        out += buildTagStr("ruby", {
          byteSpan: String(ruby.byteSpan),
          value: next.text.slice(0, ruby.valueLength)
        }, ["byteSpan", "value"]);
        out += next.text.slice(ruby.valueLength);
        index += 1;
      } else {
        out += msytControlToRaw(item.control);
      }
    }
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
  if (value === "~") return null;
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
        const item = { [key]: parseMsytYamlScalar(after) };
        let nextLineIndex = i + 1;
        while (nextLineIndex < lines.length) {
          const nextTrimmed = lines[nextLineIndex].trim();
          if (nextTrimmed && nextTrimmed !== "---") break;
          nextLineIndex++;
        }
        if (nextLineIndex < lines.length) {
          const nextRaw = lines[nextLineIndex];
          const nextIndent = msytYamlIndent(nextRaw);
          if (nextIndent >= indent + 2 && !nextRaw.slice(indent).startsWith("- ")) {
            const [tail, next] = parseMsytYamlNode(lines, i + 1, indent + 2);
            if (tail && typeof tail === "object" && !Array.isArray(tail)) {
              Object.assign(item, tail);
              arr.push(item);
              i = next;
              continue;
            }
          }
        }
        arr.push(item);
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
  if (value === null) return "~";
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
          const [[firstKey, firstValue], ...restEntries] = entries;
          if (firstValue && typeof firstValue === "object") {
            lines.push(`${sp}- ${formatMsytYamlKey(firstKey)}:`);
            lines.push(dumpMsytYamlNode(firstValue, indent + 4));
          } else {
            lines.push(`${sp}- ${formatMsytYamlKey(firstKey)}: ${formatMsytYamlScalar(firstValue)}`);
          }
          if (restEntries.length) {
            lines.push(dumpMsytYamlNode(Object.fromEntries(restEntries), indent + 2));
          }
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
        const valueStart = i;
        i = skipValue(i);
        items.push({ key, value: JSON.parse(normalized.slice(valueStart, i)) });
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
  const bcmlDefaultLocale = orderedLocales[0]?.key;
  for (const [localeIndex, localeNode] of orderedLocales.entries()) {
    const locale = localeNode.key;
    for (const [pathIndex, pathNode] of (localeNode.children || []).entries()) {
      const path = pathNode.key;
      for (const labelNode of pathNode.children || []) {
        const label = labelNode.key;
        const entry = labelNode.value || {};
        entries.push({
          label: String(label),
          attrKey: "attributes",
          attrVal: entry.attributes != null ? String(entry.attributes) : "",
          msytHasAttributes: entry.attributes != null,
          content: msytContentsToRaw(entry.contents || []),
          bcmlLocale: locale,
          bcmlPath: path,
          bcmlLocaleGroupId: `locale-${localeIndex}`,
          bcmlPathGroupId: `locale-${localeIndex}-path-${pathIndex}`,
          docKey: `${localeIndex}::${pathIndex}::${label}`
        });
      }
    }
  }
  return { entries, bcmlDefaultLocale, bcmlDefaultPath: entries[0]?.bcmlPath };
}

function tryParseMsytControlFromRaw(rawTag) {
  const { name, args } = parseTI(rawTag.slice(2, -2));
  if (name === "pageBreak") return { kind: "raw", zero: { four: { field_1: 0 } } };
  if (name === "msyt" && args.json) return JSON.parse(base64ToUtf8(args.json));
  if (name === "ruby") {
    const byteSpan = Number(args.byteSpan);
    const value = String(args.value ?? "");
    const valueBytes = value.length * 2;
    if (!Number.isInteger(byteSpan) || byteSpan < 0 || byteSpan > 0xffff || valueBytes > 0xffff - 4) return null;
    return {
      kind: "raw",
      zero: {
        zero: {
          field_1: valueBytes + 4,
          field_2: byteSpan,
          field_3: valueBytes
        }
      }
    };
  }
  if (MSYT_TAG_TO_RAW_ONE_FIELD[name] != null) {
    return {
      kind: "raw",
      two: {
        one_field: [MSYT_TAG_TO_RAW_ONE_FIELD[name], { field_1: 0 }]
      }
    };
  }
  if (name === "noTextScroll") {
    return {
      kind: "raw",
      one: {
        two: {
          field_1: 0
        }
      }
    };
  }
  if (name === "uppercaseNextWord") {
    return {
      kind: "raw",
      two_hundred_one: {
        one_field: [3, { field_1: 0 }]
      }
    };
  }
  if (name === "lowercaseNextWord") {
    return {
      kind: "raw",
      two_hundred_one: {
        one_field: [4, { field_1: 0 }]
      }
    };
  }
  if (name === "textSpeed") {
    if (args.value == null) return null;
    const floatValue = Number(args.value);
    if (!Number.isFinite(floatValue)) return null;
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, floatValue, true);
    return {
      kind: "raw",
      one: {
        one: {
          field_1: 4,
          field_2: view.getUint32(0, true)
        }
      }
    };
  }
  if (name === "setVoice") {
    return {
      kind: "raw",
      four: {
        zero: {
          field_1: 10,
          string: String(args.asset)
        }
      }
    };
  }
  if (name === "4:3") {
    return {
      kind: "raw",
      four: {
        three: {
          field_1: 0
        }
      }
    };
  }
  if (name === "pluralCase") {
    return {
      kind: "localisation",
      localisation_kind: "plural",
      options: [String(args.arg1), String(args.arg2), String(args.arg3)]
    };
  }
  if (name === "gender") {
    return {
      kind: "localisation",
      localisation_kind: "gender",
      options: [String(args.m), String(args.f), String(args.n)]
    };
  }
  if (name === "wordInfo") {
    return {
      kind: "raw",
      two_hundred_one: {
        dynamic: [
          0,
          {
            len: 4,
            field_2: [
              Number(args.gender),
              Number(args.defArticle),
              Number(args.indefArticle),
              String(args.isPlural).toLowerCase() === "true" ? 1 : 0
            ]
          }
        ]
      }
    };
  }
  if (name === "color") {
    const id = args.id;
    if (id === "Default" || id === "-1") return { kind: "reset_colour" };
    const editorName = getColorNameById("BotW", id);
    const colour = editorColorToMsyt(editorName);
    if (colour) return { kind: "set_colour", colour };
    return { kind: "set_colour", colour: String(editorName).toLowerCase() };
  }
  if (/^choice[234]$/.test(name)) {
    const count = Number(name.slice(-1));
    const choice_labels = [];
    for (let i = 1; i <= count; i++) choice_labels.push(Number(args[`label${i}`]));
    return {
      kind: "choice",
      choice_labels,
      selected_index: Number(args.selectedIndex),
      cancel_index: Number(args.cancelIndex),
      unknown: msytChoiceUnknownDefault(count)
    };
  }
  if (name === "choiceByFlags") return buildMsytChoiceByFlagsControl(args);
  if (name === "fiveFlags") return buildMsytFiveFlagsControl(args);
  if (name === "singleChoice") return { kind: "single_choice", label: Number(args.label) };
  if (MSYT_TAG_TO_VARIABLE_KIND[name] != null) {
    const control = {
      kind: "variable",
      variable_kind: MSYT_TAG_TO_VARIABLE_KIND[name],
      name: String(args.ref)
    };
    if (args.index != null && args.index !== "" && Number(args.index) !== 0) {
      control.index = Number(args.index);
    }
    return control;
  }
  if (name === "icon") {
    const mapped = BOTW_ICON_ID_TO_NAME[Number(args.type)];
    const icon = editorValueToMsytIcon(mapped || String(args.type));
    if (icon != null) return { kind: "icon", icon };
  }
  if (name === "size") return { kind: "text_size", percent: Number(args.value) };
  if (name === "animation") return { kind: "animation", name: args.name };
  if (name === "font") return { kind: "font", font_kind: args.face === "Hylian" ? "hylian" : "normal" };
  if (name === "setEmotion") {
    return {
      kind: "sound",
      unknown: [mapEmotionIdByName(args.emotion, false), Number(args.variant)]
    };
  }
  if (name === "setEmotion2") {
    return {
      kind: "sound2",
      unknown: [mapEmotionIdByName(args.emotion, true), 205]
    };
  }
  if (name === "autoAdvance") {
    const lo = Number(args.framesLo) & 0xffff;
    const hi = Number(args.framesHi) & 0xffff;
    return { kind: "auto_advance", frames: Math.max(lo, hi) }; // can get the wrong frame count when converting from AEON to MSYT because of framesLo/framesHi handling, if either value is not 0?
  }
  if (name === "delay8") return { kind: "pause", length: "short" };
  if (name === "delay15") return { kind: "pause", length: "long" };
  if (name === "delay30") return { kind: "pause", length: "longer" };
  if (name === "delay") {
    const lo = Number(args.framesLo) & 0xffff;
    const hi = Number(args.framesHi) & 0xffff;
    return { kind: "pause", frames: Math.max(lo, hi) }; // can get the wrong frame count when converting from AEON to MSYT because of framesLo/framesHi handling, if either value is not 0?
  }
  return null;
}

export function rawToMsytContents(raw) {
  const contents = [];
  const pushText = (text) => {
    if (!text) return;
    const previous = contents[contents.length - 1];
    if (previous && typeof previous.text === "string") previous.text += text;
    else contents.push({ text });
  };
  let last = 0;
  for (const match of String(raw || "").matchAll(/\{\{([^}]*)\}\}/g)) {
    const text = raw.slice(last, match.index);
    pushText(text);
    last = match.index + match[0].length;
    const { name, args } = parseTI(match[1]);
    const control = tryParseMsytControlFromRaw(match[0]);
    if (!control) throw new Error(`Unsupported msyt control tag: ${match[0]}`);
    contents.push({ control });
    if (name === "ruby") pushText(String(args.value ?? ""));
  }
  const tail = raw.slice(last);
  pushText(tail);
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
    const locale = chain.bcmlLocale;
    const path = chain.bcmlPath;
    const label = chain.label || "";
    const raw = chain.msytRaw ?? chain.raw;
    const localeGroupId = chain.bcmlLocaleGroupId || `locale:${locale}`;
    const pathGroupId = chain.bcmlPathGroupId || `path:${path}`;
    let localeNode = findBy(locales, "groupId", localeGroupId);
    if (!localeNode) {
      localeNode = { groupId: localeGroupId, locale, paths: [] };
      locales.push(localeNode);
    }
    let pathNode = findBy(localeNode.paths, "groupId", pathGroupId);
    if (!pathNode) {
      pathNode = { groupId: pathGroupId, path, labels: [] };
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
