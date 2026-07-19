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
