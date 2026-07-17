/**
 * A bubble type configuration.
 * @typedef {Object} BubbleConfig
 * @property {string} className The internal identifier used for this bubble type.
 * @property {string} label The user-facing label shown in type selectors.
 * @property {number | null} charLimit The maximum character count allowed per bubble, or `null` for no limit.
 * @property {number | null} scrollWidth The maximum rendered text width before the bubble shows an overflow warning.
 * @property {number} lineCount The number of lines per bubble.
 * @property {boolean} isSingleton Whether more than one bubble should be allowed at once.
 */

/**
 * A collection of bubble type configurations.
 * @type {Object.BubbleConfig}
 */
export default {
  dialogue: {
    className: "dialogue",
    label: "NPC",
    charLimit: null,
    scrollWidth: 520,
    lineCount: 3,
    isSingleton: false
  },
  signboard: {
    className: "signboard",
    label: "Sign",
    charLimit: null,
    scrollWidth: 520,
    lineCount: 3,
    isSingleton: false
  },
  item: {
    className: "item",
    label: "Item",
    charLimit: 204,
    scrollWidth: null,
    lineCount: 4,
    isSingleton: true
  },
  compendium: {
    className: "compendium",
    label: "Compendium",
    charLimit: null,
    scrollWidth: null,
    lineCount: 9,
    isSingleton: true
  },
  questBOTW: {
    className: "questBOTW",
    label: "Quest BotW",
    charLimit: null,
    scrollWidth: null,
    lineCount: 11,
    isSingleton: true
  },
  questTOTK: {
    className: "questTOTK",
    label: "Quest TotK",
    charLimit: null,
    scrollWidth: null,
    lineCount: 8,
    isSingleton: true
  },
  choice: {
    className: "choice",
    label: "Choice",
    charLimit: null,
    scrollWidth: null,
    lineCount: 1,
    isSingleton: false
  },
  tip: {
    className: "tip",
    label: "Tip",
    charLimit: null,
    scrollWidth: null,
    lineCount: 3,
    isSingleton: true
  }
};
// TODO: Test for what actual `charLimit` values are
