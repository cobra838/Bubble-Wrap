/** A collection of utility methods for working with a Bubble object. */
export default class BubbleUtil {
  /**
   * Iterates through and runs the callback on each text node in the Bubble.
   * Line breaks will also be returned.
   * @param {Bubble} bubble The Bubble to iterate through.
   * @param {iteratedNodeCallback} callback The callback to execute for each node.
   * @param {Boolean} [applyChanges] If any changes made to the copy of the parent
   * should be applied to the original parent.
   */
  static iterateInsideBubble(bubble, callback, applyChanges) {
    let originalOuterNodes = bubble.bubbleContentElement.childNodes;
    let newContentElement = document.createElement("div");
    originalOuterNodes.forEach((outerNode, index) => {
      // Each outer div (lines separated by manual line breaks)
      if (index == originalOuterNodes.length - 1 && outerNode.tagName == "BR") return;
      let outerNodeContent = outerNode.childNodes;
      let newOuterNode = document.createElement("div");
      // Scan each inner span / text node
      outerNodeContent.forEach((innerNode, innerIndex) => {
        if (innerIndex == outerNodeContent.length - 1 && innerNode.tagName == "BR") return;
        if (innerNode.tagName == "BR") {
          callback(null, null, true);
          return;
        }
        callback(innerNode, newOuterNode);
      });
      // Signal manual line break
      if (index != originalOuterNodes.length - 1) {
        callback(null, null, true);
      }
      // Apply any changes to the replacement bubble
      if (applyChanges) newContentElement.appendChild(newOuterNode);
    });
    // Apply any changes to the actual bubble
    if (applyChanges) {
      bubble.bubbleContentElement.replaceChildren(...newContentElement.childNodes);
    }
  }
}
