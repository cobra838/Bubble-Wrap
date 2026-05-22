import Bubble from "./Bubble.js";
import BubbleUtil from "./BubbleUtil.js";
import BubbleManager from "./BubbleManager.js";

/** Manages the wrapping and formatting of text for bubbles. */
export default class BubbleTester {
  /**
   * Breaks a single line of text into multiple lines using the currently
   * set bubble type to perform wrapping.
   * @param {string} text The text to wrap.
   * @returns {Array<string>} An array of individual lines of text.
   */
  static breakTextAtWrap(text) {
    if (text == "") return "";
    const nodes = BubbleTester.breakNodesAtWrap(new Bubble(-1, text));
    return nodes.flat().map((el) => el.textContent);
  }

  /**
   * Sorts text nodes into multiple lines using the currently set bubble type
   * to perform wrapping. Manual line breaks are preserved.
   * @param {Bubble} b The bubble containing the text nodes to wrap.
   * @returns {Array<Array<Node>>} A new set of nodes in the format returned by
   * `BubbleUtil.getTextNodes()`.
   */
  static breakNodesAtWrap(b) {
    let wrappingBubbleContainer = BubbleManager.wrappingBubble.bubbleContentElement;
    resetWrapContainer();
    let output = [[]];
    let currentLine = 0;
    BubbleUtil.iterateInsideBubble(b, (currentNode, newParentNode, isManualLineBreak) => {
      if (isManualLineBreak) {
        output.push([]);
        currentLine++;
        resetWrapContainer();
      } else {
        let text = currentNode.textContent;
        let words = text.split(" ");
        words.forEach((word, i) => {
          // Treat hyphenated words as separate
          if (word.includes("-") && word != "-") {
            const newWords = word.split("-");
            newWords.forEach((newWord, ni) => {
              // Attach hyphens to ends of words
              if (ni != newWords.length - 1) newWords[ni] += "-";
            });
            words.splice(i, 1, ...newWords);
          }
        });
        let testString;
        let outputString = "";
        let newNode = currentNode.cloneNode();
        newNode.textContent = "";
        wrappingBubbleContainer.appendChild(newNode);
        while (words.length > 0) {
          let isFirstIteration = true;
          testString = "";
          while (!isTextWrapped()) {
            outputString = testString;
            if (!isFirstIteration) words.splice(0, 1);
            else isFirstIteration = false;
            if (words.length == 0) break;
            testString += words[0];
            if (words.length > 1 && (!testString.endsWith("-") || testString == "-")) testString += " ";
            newNode.textContent = testString;
          }
          // Handle words/nodes that spill across lines
          if (!outputString && words[0] && (!newNode.offsetHeight || words.length == 1)) {
            let word = words[0].split("");
            let outputWordString;
            let outputWord = "";
            while (word.length > 0) {
              testString = "";
              newNode.textContent = "";
              while (!isTextWrapped()) {
                outputWordString = testString;
                if (outputWordString) word.splice(0, 1);
                if (word.length == 0) break;
                testString += word[0];
                newNode.textContent = testString;
              }
              outputWord += outputWordString;
              if (word.length > 0) {
                newNode.textContent = outputWord;
                output[currentLine].push(newNode.cloneNode(true));
                output.push([]);
                currentLine++;
                resetWrapContainer(newNode);
                outputWord = "";
                newNode.textContent = "";
              }
            }
            words.splice(0, 1);
          }
          if (words.length > 0) {
            // Filter out singular end spaces
            if (outputString.endsWith(" ") && !outputString.endsWith("  ")) {
              outputString = outputString.slice(0, -1);
            }
            newNode.textContent = outputString;
            output[currentLine].push(newNode.cloneNode(true));
            output.push([]);
            currentLine++;
            resetWrapContainer(newNode);
            newNode.textContent = "";
          }
        }
        output[currentLine].push(newNode);
      }
    });
    return output;

    function resetWrapContainer(newNode) {
      wrappingBubbleContainer.textContent = "";
      if (newNode) wrappingBubbleContainer.appendChild(newNode);
    }

    function isTextWrapped() {
      // TODO: Reduce overhead of multiple redraws
      wrappingBubbleContainer.classList.add("wrap-test");
      const noWrapHeight = wrappingBubbleContainer.offsetHeight;
      wrappingBubbleContainer.classList.remove("wrap-test");
      return noWrapHeight < wrappingBubbleContainer.offsetHeight;
    }
  }
}
