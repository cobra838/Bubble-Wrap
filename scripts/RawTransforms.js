// Shared raw-text transformation helpers for ImportSettings and BulkActions.

// Swap 16-bit frame fields in raw delay tags without changing other arguments.
export function swapRawFrameEndian(raw, parseInlineTag, buildInlineTag, tagNames = ["delay", "autoAdvance"]) {
  const names = new Set(tagNames);
  return String(raw || "").replace(/\{\{[^}]*\}\}/g, (rawTag) => {
    const tag = parseInlineTag(rawTag);
    if (!names.has(tag.name) || tag.args.framesLo == null || tag.args.framesHi == null) return rawTag;
    const args = { ...tag.args, framesLo: tag.args.framesHi, framesHi: tag.args.framesLo };
    return buildInlineTag(tag.name, args, tag.order);
  });
}

// Remove only blank lines at the start and end; preserve blank lines inside text.
export function trimOuterBlankLines(raw) {
  const lines = String(raw || "").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

// Move horizontal whitespace before a delay tag to after it when text follows.
export function moveDelayTagSpaceAfter(raw) {
  return String(raw || "").replace(/([ \t]+)(\{\{([^\s}]+)[^}]*\}\})(?=\S)/g, (match, space, tag, name) => {
    return name.startsWith("delay") ? `${tag} ` : match;
  });
}
