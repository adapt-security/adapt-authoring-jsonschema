import { App } from 'adapt-authoring-core';
/**
 * Time-limited schema cache
 * @memberof jsonschema
 */
class SchemaCache {
  /** @override */
  constructor() {
    this.isEnabled = false;
    this.lifespan = 0;
    App.instance.config.onReady().then(() => {
      this.isEnabled = App.instance.jsonschema.getConfig('enableCache');
      this.lifespan = App.instance.jsonschema.getConfig('cacheLifespan');
    })
    this.cache = {};
  }
  /**
   * Retrieve a cached schema
   * @param {String} schemaName 
   * @returns {Object} The schema
   */
  get(schemaName) {
    this.prune();
    if(this.cache[schemaName]) return this.cache[schemaName].schema;
  }
  /**
   * Cache a schema
   * @param {Object} schema The schema to cache 
   */
  set(schema) {
    this.cache[schema.$anchor] = { schema, timestamp: Date.now() };
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