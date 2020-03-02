/**
* Error for validation issues in which multiple errors are summarised in a single parent error
*/
class DataValidationError extends Error {
  /**
  * @param {String} messagePrefix String to prefix the Error.message
  * @param {Array} errors Child errors
  */
  constructor(messagePrefix, errors) {
    super(...arguments);
    /** @ignore */ this._messagePrefix = messagePrefix;
    /**
    * Name of the error
    * @type {String}
    */
    this.name = this.constructor.name;
    /**
    * Child errors
    * @type {Array<Error>}
    */
    this.errors = errors || [];

    this.updateMessage();
  }
  /**
  * Get string to prefix the Error.message with
  * @type {String}
  */
  get messagePrefix() {
    return this._messagePrefix;
  }
  /**
  * Set string to prefix the Error.message with
  * @type {String}
  */
  set messagePrefix(m) {
    this._messagePrefix = m;
    this.updateMessage();
  }
  /**
  * Adds a 'child' error to the list, and updates the error's message
  * @param {...Error} error Error(s) to add
  */
  addError(...error) {
    error.forEach(e => this.errors.push(e));
    this.updateMessage();
  }
  /**
  * Makes sure the error.message represents the current list of child errors
  */
  updateMessage() {
    /** @ignore */
    this.message = `${this.messagePrefix}: ${this.errors.join(', ')}.`;
  }
}

module.exports = DataValidationError;
