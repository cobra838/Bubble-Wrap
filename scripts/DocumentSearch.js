import { rawToPlainText, serializeContent } from "./RawContent.js";

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default class DocumentSearch {
  // Keep the VS Code-style search controls and document filtering together.
  constructor(app) {
    this.app = app;
    this.searchInput = document.getElementById("search-box");
    this.options = { caseSensitive: false, wholeWord: false, regex: false, tags: false };
    this.optionButtons = {
      caseSensitive: document.getElementById("search-case"),
      wholeWord: document.getElementById("search-whole-word"),
      regex: document.getElementById("search-regex"),
      tags: document.getElementById("search-tags")
    };

    this.searchInput.addEventListener("input", () => this.filter(this.searchInput.value));
    Object.entries(this.optionButtons).forEach(([key, button]) => {
      button.addEventListener("click", () => this.toggleOption(key));
    });
  }

  // Compile the current query. Whole-word matching also supports non-Latin text.
  getMatcher(global = false) {
    const query = this.searchInput.value;
    if (!query) {
      this.searchInput.classList.remove("invalid");
      return null;
    }
    let source = this.options.regex ? query : escapeRegex(query);
    if (this.options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
    try {
      const flags = `${this.options.caseSensitive ? "" : "i"}${global ? "g" : ""}u`;
      const matcher = new RegExp(source, flags);
      this.searchInput.classList.remove("invalid");
      return matcher;
    } catch {
      this.searchInput.classList.add("invalid");
      return false;
    }
  }

  // Toggle one search option and immediately re-run the current filter.
  toggleOption(key) {
    this.options[key] = !this.options[key];
    this.optionButtons[key].classList.toggle("active", this.options[key]);
    this.filter(this.searchInput.value);
  }

  // Test one text value without retaining RegExp.lastIndex from another chain.
  matches(text, matcher) {
    matcher.lastIndex = 0;
    return matcher.test(text);
  }

  // Search visible text by default; the Tags option uses canonical raw text.
  chainMatches(chain, matcher) {
    const content = chain.bubbles
      .map((bubble) => {
        const raw = bubble.content.dataset.raw ?? serializeContent(bubble.content);
        return this.options.tags ? raw : rawToPlainText(raw);
      })
      .join("\n");
    return this.matches(`${chain.labelInput.value}\n${chain.attrInput.value}\n${chain.bcmlLocale ?? ""}\n${chain.bcmlPath ?? ""}\n${content}`, matcher);
  }

  // Filter visible entries and keep BCML locale/path groups in sync.
  filter(query = this.searchInput.value) {
    if (query !== this.searchInput.value) this.searchInput.value = query;
    const matcher = this.getMatcher();
    if (matcher === false) return;
    this.app.chains.forEach((chain) => {
      const visible = !matcher || this.chainMatches(chain, matcher);
      chain.section.hidden = !visible;
      chain.sidebarItem.hidden = !visible;
    });
    this.app.syncSearchGroups();
  }

}
