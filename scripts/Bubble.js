import BubbleManager from "./BubbleManager.js";

/** Manages the UI for an individual text box. */
export default class Bubble {
  /**
   * Creates a new Bubble. This constructor should only be called internally by BubbleManager.
   * @param {int} index The index of the bubble to create this one under.
   * @param {string} text (optional) A string to prefill the bubble with.
   */
  constructor(index, text) {
    // Tracking the index reliably would require updating all bubbles when a new one is created,
    // so it is instead exposed in Bubble.prototype.getIndex() (sourced from BubbleManager)

    // Create and insert the bubble element
    this.element = document.createElement("div");
    this.element.classList.add("bubble");
    this.element.innerHTML = BubbleManager.template;
    if (index == -1) {
      this.element.classList.add("test-bubble");
      BubbleManager.container.appendChild(this.element);
    } else if (index < BubbleManager.bubbles.length) {
      const indexBubble = BubbleManager.bubbles[index];
      indexBubble.element.insertAdjacentElement("afterend", this.element);
      index++;
    } else {
      BubbleManager.container.appendChild(this.element);
    }

    this.bubbleContentElement = this.element.querySelector(".bubble-content");
    this.btnAddBubbleElement = this.element.querySelector(".btn-add-bubble");
    this.btnDelBubbleElement = this.element.querySelector(".btn-del-bubble");
    this.bubbleValue = "";
    this.bubbleHeight = 0;
    this.lineCount = 0;

    // Populate bubble with first line
    const initLine = this.initializeContents(text);

    // If this is not the initial or test bubble, autofocus
    if (index > 0) {
      this.element.addEventListener("animationstart", () => {
        // Trigger autofocus once all post-click events have occurred
        this.bubbleContentElement.focus();
        const range = getSelection().getRangeAt(0);
        range.setStart(initLine, 0);
      });
      this.element.addEventListener("animationend", () => {
        // The delete button was disabled on the parent element earlier to prevent weird flickering,
        // but it can safely be re-enabled now
        BubbleManager.bubbles[index - 1].element.classList.remove("del-disabled");
      });
    }

    // Add UI logic for visible bubbles
    if (index > -1) {
      // Focus the bubble text input when any part of the bubble is clicked
      this.element.addEventListener("mousedown", (e) => {
        if (e.target.closest(".bubble-btn")) return;
        if (e.target == this.element || e.target.closest(".bubble-frame")) {
          e.preventDefault();
        }
        this.bubbleContentElement.focus();
        // Ensure the cursor is inside the initial `<div>` when the bubble is empty
        if (!this.bubbleContentElement.firstElementChild.textContent) {
          getSelection().setPosition(this.bubbleContentElement.firstElementChild, 0);
        }
      });

      // If text is cleared, repopulate with a `<div>`
      this.bubbleContentElement.addEventListener("keyup", () => {
        if (this.bubbleContentElement.childNodes.length == 0) {
          const newDiv = document.createElement("div");
          this.bubbleContentElement.appendChild(newDiv);
          getSelection().getRangeAt(0).setStart(newDiv, 0);
        } else if (this.bubbleContentElement.childNodes.length == 1 && !this.bubbleContentElement.firstElementChild) {
          // This content should be put in a node
          const newDiv = document.createElement("div");
          newDiv.textContent = this.bubbleContentElement.textContent;
          this.bubbleContentElement.textContent = "";
          this.bubbleContentElement.appendChild(newDiv);
          getSelection().getRangeAt(0).selectNodeContents(newDiv);
          getSelection().collapseToEnd();
        }
      });

      this.bubbleContentElement.addEventListener("paste", (e) => this.insertPlaintext(e, e.clipboardData.getData("text/plain")));
      this.bubbleContentElement.addEventListener("drop", (e) => this.insertPlaintext(e, e.dataTransfer.getData("text/plain")));
      this.bubbleContentElement.addEventListener("input", () => this.inputHandler());
      this.inputHandler(); // run once to evaluate overflow status

      // When bubble add button is clicked, create a new bubble below this one
      this.btnAddBubbleElement?.addEventListener("mousedown", (e) => {
        e.preventDefault();
        BubbleManager.addBubble(this);
      });
      this.element.addEventListener("keydown", (e) => {
        if (e.code == "Enter" && e.ctrlKey && !e.altKey && !BubbleManager.type.isSingleton) BubbleManager.addBubble(this);
      });

      // When bubble delete button is clicked, delete this bubble
      this.btnDelBubbleElement?.addEventListener("mousedown", (e) => {
        e.preventDefault();
        BubbleManager.deleteBubble(this);
        // if (confirm("Are you sure you want to delete this bubble? There is no undo!"))
      });
    }
  }

  /**
   * Sets or resets the contents to the bubble to the initial format.
   * @param {String} [text] The text to include in the initialized format.
   * @returns {Node} The first instance at which content can be inserted.
   */
  initializeContents(text) {
    this.bubbleContentElement.textContent = "";
    const initLine = document.createElement("div");
    initLine.textContent = text || "";
    this.bubbleContentElement.appendChild(initLine);
    return initLine;
  }

  /**
   * Gets the numeric position of this bubble in the list.
   * @returns The index of this bubble.
   */
  getIndex() {
    return BubbleManager.bubbles.indexOf(this);
  }

  inputHandler() {
    // Clear if <br> is the only content
    const isIsolatedBreak = this.bubbleContentElement.innerHTML == "<br>";
    const isIsolatedBreakNode =
      this.bubbleContentElement.childElementCount == 1 && this.bubbleContentElement.firstElementChild.innerHTML == "<br>";
    if (isIsolatedBreak || isIsolatedBreakNode) {
      this.bubbleContentElement.innerHTML = "";
    }

    // Flag input over the line count or character limit
    let charCount = 0;
    for (const div of this.bubbleContentElement.childNodes) {
      charCount += div.textContent.length;
    }
    let bubbleHeight = 0;
    for (const el of this.bubbleContentElement.children) {
      bubbleHeight += el.offsetHeight;
    }
    if (this.bubbleHeight != bubbleHeight) {
      // Cached line count is invalid, so recalculate
      this.bubbleContentElement.classList.add("test-line-count");
      this.lineCount = 0;
      for (const el of this.bubbleContentElement.children) {
        // Counts lines of text when display is set to inline
        this.lineCount += el.getClientRects().length;
      }
      this.bubbleContentElement.classList.remove("test-line-count");
      this.bubbleHeight = bubbleHeight;
    }
    const exceedsLineCount = this.lineCount > BubbleManager.type.lineCount;
    const exceedsCharLimit = BubbleManager.type.charLimit && charCount > BubbleManager.type.charLimit;
    if (exceedsLineCount || exceedsCharLimit) {
      // this.bubbleContentElement.innerHTML = this.bubbleValue;
      this.element.classList.add("overflow");
    } else {
      this.bubbleValue = this.bubbleContentElement.innerHTML;
      this.element.classList.remove("overflow");
    }
  }

  insertPlaintext(e, plaintext) {
    e.preventDefault();
    if (!plaintext) return;
    this.bubbleContentElement.focus();
    document.execCommand("insertText", false, plaintext);
    this.inputHandler();
  }
}
