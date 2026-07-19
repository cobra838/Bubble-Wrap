import { renderRawToContent, serializeContent } from "./RawContent.js";
import { moveDelayTagSpaceAfter, swapRawFrameEndian, trimOuterBlankLines } from "./RawTransforms.js";

export default class BulkActions {
  // Own the Bulk actions dialog and apply its changes to the current document.
  constructor(app, parseInlineTag, buildInlineTag) {
    this.app = app;
    this.parseInlineTag = parseInlineTag;
    this.buildInlineTag = buildInlineTag;
    this.modal = document.getElementById("bulk-actions-modal");
    document.getElementById("bulk-force-page-breaks").addEventListener("click", () => this.forcePageBreaks());
    document.getElementById("bulk-collapse-soft-splits").addEventListener("click", () => this.collapseSoftSplits());
    document.getElementById("bulk-trim-empty").addEventListener("click", () => this.trimEmpty());
    document.getElementById("bulk-swap-delay-frames").addEventListener("click", () => this.swapDelayFrames());
    document.getElementById("bulk-fix-delay-spacing").addEventListener("click", () => this.fixDelaySpacing());
  }

  open() {
    this.modal.classList.add("open");
  }

  close() {
    this.modal.classList.remove("open");
  }

  // Read the authoritative raw text, including tags hidden by the editor UI.
  getRaw(bubble) {
    return bubble.content.dataset.raw ?? serializeContent(bubble.content);
  }

  // Replace raw text and rebuild the bubble without creating a new boundary.
  setRaw(bubble, raw) {
    renderRawToContent(bubble.content, raw);
    bubble.content.dataset.raw = raw;
    this.app.syncMetaBar(bubble);
  }

  // Rebuild labels and bubble layout after a document-wide change.
  refresh(chains) {
    chains.forEach((chain) => {
      if (chain.bubbles[0]) chain.bubbles[0].joinKind = null;
      this.app.updatePageSepLabels(chain);
      this.app.applyChainType(chain, chain.typeSelect.value, true);
    });
    this.app.refreshChoicePills();
  }

  // Turn every remembered soft-split boundary into an explicit page break.
  forcePageBreaks() {
    let changed = 0;
    this.app.chains.forEach((chain) => {
      chain.bubbles.forEach((bubble) => {
        if (bubble.joinKind !== "softBreak") return;
        bubble.joinKind = "pageBreak";
        changed += 1;
      });
    });
    this.refresh(this.app.chains);
    this.app.setStatus(`Bulk actions: ${changed} soft split${changed === 1 ? "" : "s"} changed to page break`);
    return changed;
  }

  // Merge only soft-split bubbles. Their original separation becomes a normal
  // newline inside the merged raw text, not a new soft split or page break.
  collapseSoftSplits() {
    let changed = 0;
    this.app.chains.forEach((chain) => {
      for (let index = 1; index < chain.bubbles.length; ) {
        const bubble = chain.bubbles[index];
        if (bubble.joinKind !== "softBreak") {
          index += 1;
          continue;
        }
        const previous = chain.bubbles[index - 1];
        this.setRaw(previous, `${this.getRaw(previous)}\n${this.getRaw(bubble)}`);
        chain.bubbles.splice(index, 1);
        bubble.card.remove();
        changed += 1;
      }
    });
    this.refresh(this.app.chains);
    this.app.setStatus(`Bulk actions: ${changed} soft split${changed === 1 ? "" : "s"} collapsed`);
    return changed;
  }

  // Trim blank lines only at bubble edges, then remove blank bubbles when the
  // chain has another bubble to keep. A fully empty entry keeps one bubble.
  trimEmpty() {
    let trimmed = 0;
    let removed = 0;
    this.app.chains.forEach((chain) => {
      chain.bubbles.forEach((bubble) => {
        const raw = this.getRaw(bubble);
        const nextRaw = trimOuterBlankLines(raw);
        if (nextRaw === raw) return;
        this.setRaw(bubble, nextRaw);
        trimmed += 1;
      });

      const remaining = chain.bubbles.filter((bubble) => this.getRaw(bubble) !== "");
      if (remaining.length) {
        chain.bubbles.forEach((bubble) => {
          if (remaining.includes(bubble)) return;
          bubble.card.remove();
          removed += 1;
        });
        chain.bubbles = remaining;
      } else if (chain.bubbles.length > 1) {
        const [first, ...emptyBubbles] = chain.bubbles;
        emptyBubbles.forEach((bubble) => {
          bubble.card.remove();
          removed += 1;
        });
        chain.bubbles = [first];
      }
    });
    this.refresh(this.app.chains);
    this.app.setStatus(`Bulk actions: trimmed ${trimmed} bubble${trimmed === 1 ? "" : "s"}; removed ${removed} empty bubble${removed === 1 ? "" : "s"}`);
    return { trimmed, removed };
  }

  // Swap only {{delay}} frame fields; {{autoAdvance}} is intentionally unchanged.
  swapDelayFrames() {
    let changed = 0;
    this.app.chains.forEach((chain) => {
      chain.bubbles.forEach((bubble) => {
        const raw = this.getRaw(bubble);
        const nextRaw = swapRawFrameEndian(raw, this.parseInlineTag, this.buildInlineTag, ["delay"]);
        if (nextRaw === raw) return;
        this.setRaw(bubble, nextRaw);
        changed += 1;
      });
    });
    this.refresh(this.app.chains);
    this.app.setStatus(`Bulk actions: swapped delay frames in ${changed} bubble${changed === 1 ? "" : "s"}`);
    return changed;
  }

  // Move horizontal whitespace before a delay tag after that tag when text follows.
  fixDelaySpacing() {
    let changed = 0;
    this.app.chains.forEach((chain) => {
      chain.bubbles.forEach((bubble) => {
        const raw = this.getRaw(bubble);
        const nextRaw = moveDelayTagSpaceAfter(raw);
        if (nextRaw === raw) return;
        this.setRaw(bubble, nextRaw);
        changed += 1;
      });
    });
    this.refresh(this.app.chains);
    this.app.setStatus(`Bulk actions: moved spaces around delay tags in ${changed} bubble${changed === 1 ? "" : "s"}`);
    return changed;
  }

  // Run selected actions in the same order as the dialog and test options.
  apply(actions = {}) {
    const result = {};
    if (actions.forcePageBreaks) result.forcePageBreaks = this.forcePageBreaks();
    if (actions.collapseSoftSplits) result.collapseSoftSplits = this.collapseSoftSplits();
    if (actions.trimEmpty) result.trimEmpty = this.trimEmpty();
    if (actions.swapDelayFrames) result.swapDelayFrames = this.swapDelayFrames();
    if (actions.fixDelaySpacing) result.fixDelaySpacing = this.fixDelaySpacing();
    return result;
  }
}
