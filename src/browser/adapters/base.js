/**
 * Base interface for browser conversation adapters.
 *
 * Adapters encapsulate all provider-specific DOM knowledge:
 * - Which selectors to use for assistant messages, composer, send button
 * - How to detect generating/stopped state
 * - How to extract conversation identity from a page
 *
 * The transport layer (ProviderChannel, BrowserInstructionRelay) must
 * remain completely agnostic of adapter internals.
 */
class BrowserConversationAdapter {
  /**
   * Test whether this adapter matches the given browser URL.
   * @param {string} url - The page URL to test
   * @returns {boolean} true if this adapter handles this provider
   */
  matches(url) {
    throw new Error('matches() must be implemented by subclass');
  }

  /**
   * Extract conversation identity from a page.
   * Returns { provider, conversationId, url } or null if not identifiable.
   * @param {object} page - CDP page object
   * @returns {object|null} identity info or null
   */
  extractIdentity(page) {
    throw new Error('extractIdentity() must be implemented by subclass');
  }

  /**
   * Get all CSS selectors needed for browser interaction.
   * @returns {object} { assistant, composer, send, stop } arrays of selectors
   */
  getSelectors() {
    throw new Error('getSelectors() must be implemented by subclass');
  }

  /**
   * Detect whether the page is currently in a generating/stopped state.
   * @param {object} page - CDP page object
   * @returns {Promise<boolean>} true if generating
   */
  async isGenerating(page) {
    throw new Error('isGenerating() must be implemented by subclass');
  }

  /**
   * Extract provenance information from an assistant message.
   * @param {object} page - CDP page object
   * @returns {object} { verifiedAssistant, authorRole, selectorFamily, ... }
   */
  async extractProvenance(page) {
    throw new Error('extractProvenance() must be implemented by subclass');
  }
}

module.exports = { BrowserConversationAdapter };