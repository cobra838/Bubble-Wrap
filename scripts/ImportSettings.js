import { swapRawFrameEndian, moveDelayTagSpaceAfter } from "./RawTransforms.js";

const STORAGE_IMPORT_BIG_ENDIAN_KEY = "bubble_wrap_import_big_endian";
const STORAGE_IMPORT_HAS_ATR1_KEY = "bubble_wrap_import_has_atr1";
const STORAGE_DISABLE_SOFT_SPLIT_KEY = "bubble_wrap_disable_soft_split";
const STORAGE_TRIM_EMPTY_ON_IMPORT_KEY = "bubble_wrap_trim_empty_on_import";
const STORAGE_FIX_DELAY_SPACING_ON_IMPORT_KEY = "bubble_wrap_fix_delay_spacing_on_import";

// Read an optional import override from localStorage.
function readImportBooleanSetting(key) {
  const value = localStorage.getItem(key);
  return value === "true" ? true : value === "false" ? false : null;
}

// Keep one AEON YAML metadata value in sync with an import override.
function setAeonBooleanMeta(yamlMeta, key, enabled) {
  const value = enabled ? "true" : "false";
  const meta = String(yamlMeta || "");
  const line = new RegExp(`^${key}:\\s*(?:true|false)\\s*$`, "m");
  if (!meta) return `%%%\n${key}: ${value}\n%%%\n`;
  if (line.test(meta)) return meta.replace(line, `${key}: ${value}`);
  return meta.replace(/^%%%\n/, `%%%\n${key}: ${value}\n`);
}

// Remove attributes when the imported document is forced to hasATR1: false.
function removeImportedAttributes(entries) {
  entries.forEach((entry) => {
    entry.attrVal = "";
    entry.msytHasAttributes = false;
  });
}


// Func
export default class ImportSettings {
  // Cache the Settings dialog and restore its saved import overrides.
  constructor() {
    this.disableSoftSplit = localStorage.getItem(STORAGE_DISABLE_SOFT_SPLIT_KEY) === "1";
    this.bigEndian = readImportBooleanSetting(STORAGE_IMPORT_BIG_ENDIAN_KEY);
    this.hasATR1 = readImportBooleanSetting(STORAGE_IMPORT_HAS_ATR1_KEY);
    this.trimEmpty = localStorage.getItem(STORAGE_TRIM_EMPTY_ON_IMPORT_KEY) === "1";
    this.fixDelaySpacingOnImport = localStorage.getItem(STORAGE_FIX_DELAY_SPACING_ON_IMPORT_KEY) === "1";
    this.modal = document.getElementById("settings-modal");
    this.disableSoftSplitSelect = document.getElementById("setting-disable-soft-split");
    this.bigEndianSelect = document.getElementById("setting-big-endian");
    this.hasATR1Select = document.getElementById("setting-has-atr1");
    this.trimEmptySelect = document.getElementById("setting-trim-empty");
    this.fixDelaySpacingSelect = document.getElementById("setting-fix-delay-spacing");
    this.disableSoftSplitSelect.addEventListener("change", () => this.save());
    this.bigEndianSelect.addEventListener("change", () => this.save());
    this.hasATR1Select.addEventListener("change", () => this.save());
    this.trimEmptySelect.addEventListener("change", () => this.save());
    this.fixDelaySpacingSelect.addEventListener("change", () => this.save());
    this.syncUi();
  }

  // Refresh the controls from the saved import overrides.
  syncUi() {
    this.disableSoftSplitSelect.value = String(this.disableSoftSplit);
    this.bigEndianSelect.value = this.bigEndian == null ? "" : String(this.bigEndian);
    this.hasATR1Select.value = this.hasATR1 == null ? "" : String(this.hasATR1);
    this.trimEmptySelect.value = String(this.trimEmpty);
    this.fixDelaySpacingSelect.value = String(this.fixDelaySpacingOnImport);
  }

  // Save import overrides selected in Settings.
  save() {
    this.disableSoftSplit = this.disableSoftSplitSelect.value === "true";
    this.bigEndian = this.bigEndianSelect.value === "" ? null : this.bigEndianSelect.value === "true";
    this.hasATR1 = this.hasATR1Select.value === "" ? null : this.hasATR1Select.value === "true";
    this.trimEmpty = this.trimEmptySelect.value === "true";
    this.fixDelaySpacingOnImport = this.fixDelaySpacingSelect.value === "true";
    localStorage.setItem(STORAGE_DISABLE_SOFT_SPLIT_KEY, this.disableSoftSplit ? "1" : "0");
    if (this.bigEndian == null) localStorage.removeItem(STORAGE_IMPORT_BIG_ENDIAN_KEY);
    else localStorage.setItem(STORAGE_IMPORT_BIG_ENDIAN_KEY, String(this.bigEndian));
    if (this.hasATR1 == null) localStorage.removeItem(STORAGE_IMPORT_HAS_ATR1_KEY);
    else localStorage.setItem(STORAGE_IMPORT_HAS_ATR1_KEY, String(this.hasATR1));
    localStorage.setItem(STORAGE_TRIM_EMPTY_ON_IMPORT_KEY, this.trimEmpty ? "1" : "0");
    localStorage.setItem(STORAGE_FIX_DELAY_SPACING_ON_IMPORT_KEY, this.fixDelaySpacingOnImport ? "1" : "0");
  }

  // Set import overrides programmatically for the export tests.
  set(settings = {}) {
    if (Object.prototype.hasOwnProperty.call(settings, "disableSoftSplit")) {
      this.disableSoftSplitSelect.value = String(Boolean(settings.disableSoftSplit));
    }
    if (Object.prototype.hasOwnProperty.call(settings, "bigEndian")) this.bigEndianSelect.value = settings.bigEndian == null ? "" : String(Boolean(settings.bigEndian));
    if (Object.prototype.hasOwnProperty.call(settings, "hasATR1")) this.hasATR1Select.value = settings.hasATR1 == null ? "" : String(Boolean(settings.hasATR1));
    if (Object.prototype.hasOwnProperty.call(settings, "trimEmpty")) this.trimEmptySelect.value = String(Boolean(settings.trimEmpty));
    if (Object.prototype.hasOwnProperty.call(settings, "fixDelaySpacing")) this.fixDelaySpacingSelect.value = String(Boolean(settings.fixDelaySpacing));
    this.save();
  }

  // Choose the boundary created by Auto-split.
  autoSplitJoinKind() {
    return this.disableSoftSplit ? "pageBreak" : "softBreak";
  }

  // Open or close the toolbar Settings dialog.
  open() {
    this.syncUi();
    this.modal.classList.add("open");
  }

  close() {
    this.modal.classList.remove("open");
  }

  // AEON stores bigEndian and hasATR1 in the YAML metadata block.
  // AEON: false + Force false does not swap delay framesLo / framesHi; true + Force false swaps delay framesLo / framesHi; false + Force true swaps delay framesLo / framesHi. Matching values do nothing.
  // DocumentApp calls BulkActions.trimEmpty() after renderDoc(), where auto-split creates the bubbles.
  applyAeon(doc, sourceBigEndian, parseInlineTag, buildInlineTag) {
    if (this.bigEndian != null) {
      if (sourceBigEndian !== this.bigEndian) {
        doc.entries.forEach((entry) => {
          entry.content = swapRawFrameEndian(entry.content, parseInlineTag, buildInlineTag);
        });
      }
      doc.yamlMeta = setAeonBooleanMeta(doc.yamlMeta, "bigEndian", this.bigEndian);
    }
    if (this.hasATR1 != null) doc.yamlMeta = setAeonBooleanMeta(doc.yamlMeta, "hasATR1", this.hasATR1);
    if (this.hasATR1 === false) removeImportedAttributes(doc.entries);
    if (this.fixDelaySpacingOnImport) {
      doc.entries.forEach((entry) => {
        entry.content = moveDelayTagSpaceAfter(entry.content);
      });
    }
  }

  // In MSYT, hasATR1 is represented by entry attributes rather than metadata.
  // MSYT has no bigEndian metadata, so there is nothing to compare.
  // Its delay fields are always treated as source bigEndian: true.
  // DocumentApp calls BulkActions.trimEmpty() after renderDoc(), where auto-split creates the bubbles.
  applyMsyt(doc, parseInlineTag, buildInlineTag) {
    // MSYT delay fields are big-endian. Flip their raw tags only when the
    // import setting explicitly changes the generated AEON metadata to false.
    if (this.bigEndian === false) {
      doc.entries.forEach((entry) => {
        entry.content = swapRawFrameEndian(entry.content, parseInlineTag, buildInlineTag);
      });
    }
    if (this.hasATR1 === true) {
      doc.entries.forEach((entry) => {
        entry.msytHasAttributes = true;
      });
    } else if (this.hasATR1 === false) {
      removeImportedAttributes(doc.entries);
    }
    if (this.fixDelaySpacingOnImport) {
      doc.entries.forEach((entry) => {
        entry.content = moveDelayTagSpaceAfter(entry.content);
      });
    }
  }

  // BCML has no file-wide bigEndian or hasATR1 metadata.
  // Delay spacing applies to its entry text;
  // DocumentApp calls BulkActions.trimEmpty() after renderDoc(), where auto-split creates the bubbles.
  applyBcml(doc) {
    if (this.fixDelaySpacingOnImport) {
      doc.entries.forEach((entry) => {
        entry.content = moveDelayTagSpaceAfter(entry.content);
      });
    }
  }
}
