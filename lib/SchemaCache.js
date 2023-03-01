import { App } from 'adapt-authoring-core';
/**
 * Time-limited schema cache
 * @memberof jsonschema
 */
class SchemaCache {
  constructor() {
    /**
     * Whether cache is enabled
     * @type {Boolean}
     */
    this.isEnabled = false;
    /**
     * Lifespan of cached items
     * @type {number}
     */
    this.lifespan = 0;
    /**
     * Schema cache
     * @type {Object}
     */
    this.cache = {};

    App.instance.config.onReady().then(() => {
      this.isEnabled = App.instance.jsonschema.getConfig('enableCache');
      this.lifespan = App.instance.jsonschema.getConfig('cacheLifespan');
    })
  }
  /**
   * Retrieve a cached schema
   * @param {String} schemaName 
   * @returns {Object} The schema
   */
  get(schemaName) {
    this.prune();
    if(this.isEnabled) return this.cache[schemaName]?.data;
  }
  /**
   * Cache a schema
   * @param {Function} compiledSchema The compiled schema validation function to cache
   */
  set(compiledSchema) {
    this.cache[compiledSchema.schema.$anchor] = { data: compiledSchema, timestamp: Date.now() };
  }
  /**
   * Removes invalid cache data
   */
  prune() {
    Object.keys(this.cache).forEach(s => {
      const cache = this.cache[s];
      if(Date.now() > (cache.timestamp + this.lifespan)) {
        delete this.cache[s];
      }
    });
  }
}

export default SchemaCache;