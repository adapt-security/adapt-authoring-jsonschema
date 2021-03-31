const _ = require('lodash');
const { AbstractModule } = require('adapt-authoring-core');
const Ajv = require("ajv/dist/2019").default;
const fs = require('fs-extra');
const DataValidationError = require('./datavalidationerror');
const glob = require('glob');
const path = require('path');
const safeRegex = require('safe-regex');
const util = require('util');

/** @ignore */ const defaultRegExp = /.*/;
/**
 * Module which add support for the JSON Schema specification
 * @extends {AbstractModule}
 */
class JsonSchemaModule extends AbstractModule {
  /** @override */
  constructor(app, pkg) {
    super(app, pkg);
    this.app.jsonschema = this;
    /**
     * Maps schema extensions to their base schema
     * @type {Object}
     */
    this.schemaExtensions = {};
    /**
     * File paths to all registed schemas
     * @type {Object}
     */
    this.schemaPaths = {};
    /**
     * Reference to the Ajv instance
     * @type {Object}
     * @see https://github.com/epoberezkin/ajv#new-ajvobject-options---object
     */
    this.validator = new Ajv({
      addUsedSchema: false,
      allErrors: true,
      allowUnionTypes: true,
      loadSchema: this.getSchema.bind(this),
      removeAdditional: 'all',
      strict: false,
      verbose: true
    });
    this.initFormats();
    this.registerSchemas();
  }
  /**
   * Overrides the RegExps for built-in string formats
   * @return {Promise}
   */
  async initFormats() {
    Object.entries({
      "date-time": /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/,
      "email": /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/,
      "password": defaultRegExp,
      "time": /^(\d{2}):(\d{2}):(\d{2})\+(\d{2}):(\d{2})$/,
    }).forEach(([name, v]) => {
      this.validator.addFormat(name, v, 'string');
    });
    // on config load add any custom config overrides
    await this.app.waitForModule('config');
    const overrides = this.getConfig('formatOverrides');
    if(overrides) {
      Object.entries(overrides).forEach(([n,v]) => this.validator.addFormat(n, v, 'string'));
    }
    this.checkFormats();
  }
  /**
   * Attempt to warn if any of the specified string formats are likely to allow ReDoS attacks
   * @see https://github.com/substack/safe-regex
   */
  checkFormats() {
    Object.entries(this.validator.formats).forEach(([name,re]) => {
      if(!safeRegex(re)) {
        this.log('warn', `unsafe RegExp for format '${name}', using default`);
        this.validator.addFormat(name, defaultRegExp, 'string');
      }
    });
  }
  /**
   * Adds a new keyword to be used in JSON schemas
   * @param {Object} definition
   * @see https://github.com/ajv-validator/ajv/blob/master/docs/api.md#ajvaddkeyworddefinition-objects-ajv
   */
  addKeyword(definition) {
    this.validator.addKeyword(definition);
  }
  /**
   * Searches all Adapt dependencies for any local JSON schemas and registers them for use in the app. Schemas must be located in in a `/schema` folder, and be named appropriately: `*.schema.json`.
   * @return {Promise}
   */
  async registerSchemas() {
    this.schemaPaths = {};
    
    const deps = Object.values(this.app.dependencies).sort((a,b) => {
      if(a.name === this.name) return -1;
      if(b.name === this.name) return 1;
    });
    return Promise.all(deps.map(async d => {
      const files = await util.promisify(glob)('schema/*.schema.json', { cwd: d.rootDir });
      if(!files.length) {
        return;
      }
      const promises = files.map(async f => this.registerSchema(path.join(d.rootDir, f)));
      return Promise.allSettled(promises);
    }));
  }
  /**
   * Registers a single JSON schemas for use in the app
   * @param {String} filePath Path to the schema file
   * @return {Promise} Resolves with schema data
   */
  async registerSchema(filePath) {
    if(!_.isString(filePath)) {
      this.log('error', `failed to register schema, filePath must be a string`);
      return;
    }
    let json;
    try {
      json = await fs.readJson(filePath);
    } catch(e) {
      this.log('error', `failed to load schema ${filePath}, ${e}`);
      return;
    }
    const name = json.$anchor || path.basename(filePath).replace('.schema.json','');

    if(this.schemaPaths[name]) {
      this.log('error', `cannot register schema, name '${name}' is in use`);
      return;
    }
    this.schemaPaths[name] = filePath;

    this.log('debug', `registered schema '${name}' at ${filePath}`);

    if(json.$patch) {
      this.extendSchema(json.$patch?.source?.$ref, name);
    }
    return { name, filePath };
  }
  /**
   * Extends an existing schema with extra properties
   * @param {String} baseSchemaName The name of the schema to extend
   * @param {String} addSchemaName The name of the schema to extend with
   */
  extendSchema(baseSchemaName, addSchemaName) {
    if(!_.isString(baseSchemaName)) {
      this.log('error', `failed to extend schema, baseSchemaName must be a string`);
      return;
    }
    if(!_.isString(addSchemaName)) {
      this.log('error', `failed to extend '${baseSchemaName}' schema, addSchemaName must be a string`);
      return;
    }
    if(!this.schemaExtensions[baseSchemaName]) {
      this.schemaExtensions[baseSchemaName] = [];
    }
    this.schemaExtensions[baseSchemaName].push(addSchemaName);
    this.log('debug', `'${addSchemaName}' extension added to schema '${baseSchemaName}'`);
  }
  /**
   * Retrieves the specified schema
   * @param {String} schemaName The name of the schema to return
   * @return {Promise} Resolves with the schema
   */
  async getSchema(schemaName) {
    const modelSchemas = await this.loadSchemaHierarchy(schemaName);
    const schema = modelSchemas.reduce((m,s) => this.applyPatch(m,s), modelSchemas.shift());
    const baseSchema = await this.loadSchema('base');
    _.assign(schema.properties, baseSchema.properties);
    return schema;
  }
  /**
   * Recursively loads every schema defined in the inheritance hierarchy
   * @param {String} schemaName The name of the schema
   * @param {Array} schemas Used for recursion
   * @return {Promise} Resolves with an array of each schema in the hierarchy
   */
  async loadSchemaHierarchy(schemaName, schemas=[]) {
    const schema = _.isPlainObject(schemaName) ? schemaName : await this.loadSchema(schemaName);
    const extensions = await this.loadSchemaExtensions(schema.$anchor);

    extensions.forEach(e => this.applyPatch(schema, e, { extendAnnotations: false }));

    if(schema.$merge && schema.$merge.source) {
      await this.loadSchemaHierarchy(schema.$merge.source.$ref, schemas);
    }
    schemas.push(schema);
    return schemas;
  }
  /**
   * Loads all extensions schemas defined for a schema
   * @param {String} schemaName The name of the schema
   * @return {Promise} Resolves with an array of the extension schemas
   */
  async loadSchemaExtensions(schemaName) {
    const extensionSchemas = [];
    if(!this.schemaExtensions[schemaName]) {
      return extensionSchemas;
    }
    await Promise.all(this.schemaExtensions[schemaName].map(async s => {
      try {
        extensionSchemas.push(await this.loadSchema(s));
      } catch(e) {
        this.log('warn', `failed to load schema ${schemaName} extension '${s}', ${e.message}`);
      }
    }));
    return extensionSchemas;
  }
  /**
   * Applies a patch schema to another schema
   * @param {Object} sourceSchema The base schema to be patched
   * @param {Object} patchSchema The patch schema to apply to the base
   * @param {Object} options
   * @param {Object} options.extendAnnotations Whether annotation properties should be overwitten by the patch
   * @param {Object} options.overwriteProperties Whether existing properties should be overwritten by the patch schema
   * @return {Promise} Resolves with the schema
   */
  applyPatch(sourceSchema, patchSchema, options = { extendAnnotations: true, overwriteProperties: false }) {
    const patchData = patchSchema?.$patch?.with;
    if(!patchData) {
      this.log('warn', `cannot apply '${patchSchema.$anchor}' merge schema to ${sourceSchema.$anchor}, invalid schema format`);
      return sourceSchema;
    }
    if(options.extendAnnotations) {
      ['$anchor', 'title', 'description'].forEach(p => {
        if(patchSchema[p]) sourceSchema[p] = patchSchema[p];
      });
    }
    if(patchData.properties) {
      const func = options.overwriteProperties ? _.assign : _.merge;
      func(sourceSchema.properties, _.cloneDeep(patchData.properties));
    }
    ['required','allOf','anyOf','oneOf'].forEach(p => {
      if(patchData[p] && patchData[p].length) {
        const cloned = _.cloneDeep(patchData[p]);
        sourceSchema[p] = sourceSchema[p] ? [...sourceSchema[p], ...cloned] : [...cloned];
      }
    });
    if(sourceSchema.required) sourceSchema.required = _.uniq(sourceSchema.required);
    return sourceSchema;
  }
  /**
   * Loads the specified schema file. Note that the schema must have been registered already, and stored in {@link JsonSchemaModule#schemaPaths}.
   * @param {String} schemaName The name of the schema to load
   * @return {Promise}
   */
  async loadSchema(schemaName) {
    if(!schemaName) {
      const e = new Error(`Must provide a schema name`);
      e.statusCode = 400;
      throw e;
    }
    if(!this.schemaPaths[schemaName]) {
      const e = new Error(`Cannot load unknown schema '${schemaName}'`);
      e.statusCode = 404;
      throw e;
    }
    try {
      return fs.readJson(this.schemaPaths[schemaName]);
    } catch(e) {
      const e2 = new Error(`Failed to load schema file '${schemaName}'`);
      e2.detail = e.message;
      e2.statusCode = 500;
      throw e;
    }
  }
  /**
   * Applies defaults according to schema definition
   * @param {Object} schema The JSON schema object
   * @param {Object} data Optional object to apply defaults to
   * @return {Promise} resolves with defaults data
   */
  async applyDefaults(schema, data={}) {
    const getSchemaChain = async (name, schemas=[]) => {
      const s = _.isString(name) ? await this.loadSchema(name) : name;
      if(s.$merge) await getSchemaChain(s.$merge.source.$ref, schemas);
      schemas.push(s);
      return schemas;
    };
    const getObjectDefaults = (props, memo={}) => {
      return Object.entries(props).reduce((m,[k,v]) => {
        if(v.hasOwnProperty('default')) m[k] = v.default;
        if(v.type === 'object' && v.properties) getObjectDefaults(v.properties, m[k]);
        return m;
      }, memo);
    };
    try {
      return (await getSchemaChain(schema)).reduce((m,s) => {
        if(s.properties) getObjectDefaults(s.properties, m);
        if(s.$merge) getObjectDefaults(s.$merge.with.properties, m);
        return m;
      }, data);
    } catch(e) {
      this.log('warn', e.message);
    }
  }
  /**
   * Checks passed data against the specified schema (if it exists)
   * @param {String|Object} schemaName The name of the schema to validate against (or alternatively, a JSON schema object)
   * @param {Object} dataToValidate The data to be validated
   * @param {Object} options
   * @param {Boolean} options.useDefaults Whether to apply defaults
   * @param {Boolean} options.ignoreRequired Whether to ignore missing required fields
   * @return {Promise} Resolves with the validated data
   */
  async validate(schemaName, dataToValidate, options = {}) {
    const o = _.defaults(options, { useDefaults: true, ignoreRequired: false });
    const schema = _.isString(schemaName) ? await this.getSchema(schemaName) : schemaName;
    const data = _.mergeWith(dataToValidate, o.useDefaults ? await this.applyDefaults(schema) : {}, v => v);
    const validate = await this.validator.compileAsync(schema);
    if(validate(data)) {
      return data; // validated ok, nothing to do
    }
    const errors = validate.errors.reduce((memo, { dataPath, message }) => {
      if(o.ignoreRequired && message.includes('required')) return memo;
      return [...memo, dataPath ? `${dataPath} ${message}` : message];
    }, []);
    if(errors.length) {
      throw new DataValidationError('Data validation failed', errors);
    }
    return data;
  }
}

module.exports = JsonSchemaModule;
