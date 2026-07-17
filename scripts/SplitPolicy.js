// Shared policy for editor-created automatic bubble splits.

const BCML_AUTO_SPLIT_PATHS = ["EventFlowMsg/", "DemoMsg/"];

// BCML may auto-split only message files whose paths support this behavior.
export function canAutoSplitDocument(documentMode, path = "") {
  if (documentMode !== "msyt-bcml") return true;
  const value = String(path || "");
  return BCML_AUTO_SPLIT_PATHS.some((prefix) => value.startsWith(prefix));
}

// Return the two raw fragments when text exceeds the current bubble line limit.
export function splitRawAtLineLimit(raw, lineLimit) {
  const lines = String(raw || "").split("\n");
  if (lines.length <= lineLimit) return null;
  return {
    keepRaw: lines.slice(0, lineLimit).join("\n"),
    overflowRaw: lines.slice(lineLimit).join("\n")
  };
}

// A soft break remains a text newline only while the preceding bubble is still full.
// Explicit page breaks and legacy newline boundaries retain their own meaning.
export function separatorForBubbleBoundary(joinKind, previousRaw, lineLimit) {
  if (joinKind === "pageBreak") return "{{pageBreak}}";
  if (joinKind !== "softBreak") return "\n";
  return String(previousRaw || "").split("\n").length === lineLimit ? "\n" : "{{pageBreak}}";
}
