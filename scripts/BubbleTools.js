import BubbleManager from "./BubbleManager.js";

/**
 * Manages the UI of all functions that work with Bubbles
 * but are not contained within a Bubble object itself.
 */
export default class BubbleTools {
  static bubbleTypeElement = document.getElementById("bubble-type");
  static {
    // Update bubble type when select menu value is changed
    BubbleTools.bubbleTypeElement.addEventListener("change", () => {
      BubbleManager.updateType(BubbleTools.bubbleTypeElement.value);
    });
  }
}
