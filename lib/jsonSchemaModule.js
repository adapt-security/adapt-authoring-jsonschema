const { AbstractModule } = require('adapt-authoring-core');
const glob = require('util').promisify(require('glob'));
const JsonSchemaValidator = require('./jsonSchemaValidator');
const path = require('path');
/**
* Module which add support for the JSON Schema specification
* @extends {AbstractModule}
*/
class JsonSchemaModule extends AbstractModule {
  /** @override */
  constructor(app, pkg) {
    super(app, pkg);
    /**
     * Reference to the validator
    * @type {JsonSchemaValidator}
    */
    this.validator = new JsonSchemaValidator();
    /**
    * @type {Function}
    * @see JsonSchemaValidator#validate
    */
    this.validate = (...args) => this.validator.validate(...args);
    /**
    * @type {Function}
    * @see JsonSchemaValidator#registerSchema
    */
    this.registerSchema = (...args) => this.validator.registerSchema(...args);
    /**
    * @type {Function}
    * @see JsonSchemaValidator#extendSchema
    */
    this.extendSchema = (...args) => this.validator.extendSchema(...args);
    /**
    * @type {Function}
    * @see JsonSchemaValidator#composeSchema
    */
    this.composeSchema = (...args) => this.validator.composeSchema(...args);
    /**
    * @type {Function}
    * @see JsonSchemaValidator#getSchema
    */
    this.getSchema = (...args) => this.validator.getSchema(...args);

    this.init();
  }
  async init() {
    await this.addFormatOverrides();
    await this.registerSchemas();
    this.setReady();
  }
  /**
  *
  * @return {Promise}
  */
  async addFormatOverrides() {
    await this.app.waitForModule('config');
    const overrides = Object.entries(this.getConfig('formatOverrides'));
    overrides.forEach(([k,v]) => this.validator.addFormat(k, v, 'string'));
  }
  /**
  * Searches all Adapt dependencies for any local JSON schemas and registers them for use in the app. Schemas must be located in in a `/schema` folder, and be named appropriately: `*.schema.json`.
  * @return {Promise}
  */
  async registerSchemas() {
    return Promise.all(Object.values(this.app.dependencies).map(async d => {
      const files = await glob('schema/*.schema.json', { cwd: d.rootDir });
      if(!files.length) {
        return;
      }
      const promises = files.map(f => this.validator.registerSchema(path.join(d.rootDir, f)));
      (await Promise.allSettled(promises)).forEach(r => {
        r.status === 'rejected' ?
          this.log('warn', `failed to register '${r.reason.name}' schema `) :
          this.log('debug', `registered '${r.value.name}' schema `);
      });
    }));
  }
}

module.exports = JsonSchemaModule;
