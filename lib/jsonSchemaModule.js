import _ from 'lodash';
import { AbstractModule } from 'adapt-authoring-core';
import Ajv from 'ajv/dist/2020.js';
import fs from 'fs/promises';
import globCallback from 'glob';
import Keywords from './Keywords.js'
import path from 'path';
import { promisify } from 'util';
import safeRegex from 'safe-regex';
import xss from 'xss';

const globPromise = promisify(globCallback);

/** @ignore */ const defaultRegExp = /.*/;
/**
 * Module which add support for the JSON Schema specification
 * @extends {AbstractModule}
 */
class JsonSchemaModule extends AbstractModule {
  static get BASE_SCHEMA_NAME() {
    return 'base';
  }
  /** @override */
  async init() {
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
     * Cache of loaded schemas
     * @type {Object}
     */
    this.schemaCache = this.getConfig('enableCache') && {};
    /**
     * Number of milliseconds before the schema cache data becomes invalidated
     * @type {Number}
     */
    this.cacheLifespan = this.getConfig('defaultCacheLifespan');
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
      verbose: true,
      keywords: Keywords.all
    });

    await this.app.waitForModule('errors');

    this.onReady() // we don't want to wait for these tasks before setting ready status
      .then(this.initFormats.bind(this))
      .then(this.registerSchemas.bind(this))
      .catch(e => this.log('error', e));
  }
  /**
   * Overrides the RegExps for built-in string formats
   * @return {Promise}
   */
  async initFormats() {
    Object.entries({
      "date-time": /[A-za-z0-9:+\(\)]+/,
      "email": /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/,
      "password": defaultRegExp,
      "time": /^(\d{2}):(\d{2}):(\d{2})\+(\d{2}):(\d{2})$/,
      "uri": /^(.+):\/\/(www\.)?[-a-zA-Z0-9@:%_\+.~#?&//=]{1,256}/
    }).forEach(([name, v]) => this.validator.addFormat(name, v));
    try {
      await this.app.waitForModule('config');
    } catch(e) {} // do nothing on error, app will halt anyway
    // on config load add any custom config overrides
    const overrides = this.getConfig('formatOverrides');
    if(overrides) {
      Object.entries(overrides).forEach(([n,v]) => this.validator.addFormat(n, v));
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
    try {
      this.validator.addKeyword(definition);
    } catch(e) {
      this.log('warn', `failed to define keyword '${definition.keyword}', ${e}`);
    }
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
      const files = await globPromise('schema/*.schema.json', { cwd: d.rootDir });
      if(!files.length) {
        return;
      }
      const promises = files.map(async f => this.registerSchema(path.join(d.rootDir, f)));
      return Promise.allSettled(promises);
    }));
  }
  /**
   * Registers a single JSON schema for use in the app
   * @param {String} filePath Path to the schema file
   * @param {Object} options Extra options
   * @param {Boolean} options.replace Will replace the existing schema if one exists
   * @return {Promise} Resolves with schema data
   */
  async registerSchema(filePath, options = {}) {
    if(!_.isString(filePath)) {
      return this.log('error', `failed to register schema, filePath must be a string`);
    }
    let json;
    try {
      json = JSON.parse((await fs.readFile(filePath)).toString());
    } catch(e) {
      return this.log('error', `failed to load schema ${filePath}, ${e}`);
    }
    const name = json.$anchor;
    if(!name) {
      return this.log('warn', 'MISSING_SCHEMA_ANCHOR', filePath);
    }
    if(this.schemaPaths[name]) {
      if(options.replace) this.deregisterSchema(name);
      else return this.log('error', `cannot register schema, name '${name}' is in use, ${filePath}`);
    }
    this.schemaPaths[name] = filePath;

    this.log('debug', 'REGISTER_SCHEMA', name, filePath);

    if(json.$patch) {
      this.extendSchema(json.$patch?.source?.$ref, name);
    }
    return { name, filePath };
  }
  /**
   * deregisters a single JSON schema
   * @param {String} name Schem name to deregister
   * @return {Promise} Resolves with schema data
   */
  deregisterSchema(name) {
    if(this.schemaPaths[name]) delete this.schemaPaths[name];
    this.log('debug', 'DEREGISTER_SCHEMA', name);
  }
  /**
   * Extends an existing schema with extra properties
   * @param {String} baseSchemaName The name of the schema to extend
   * @param {String} extSchemaName The name of the schema to extend with
   */
  extendSchema(baseSchemaName, extSchemaName) {
    if(!_.isString(baseSchemaName)) {
      return this.log('error', `failed to extend schema, baseSchemaName must be a string`);
    }
    if(!_.isString(extSchemaName)) {
      return this.log('error', `failed to extend '${baseSchemaName}' schema, extSchemaName must be a string`);
    }
    if(!this.schemaExtensions[baseSchemaName]) {
      this.schemaExtensions[baseSchemaName] = [];
    }
    this.schemaExtensions[baseSchemaName].push(extSchemaName);
    this.log('debug', 'EXTEND_SCHEMA', baseSchemaName, extSchemaName);
  }
  /**
   * Loads the specified schema file. Note that the schema must have been registered already, and stored in {@link JsonSchemaModule#schemaPaths}.
   * @param {String} schemaName The name of the schema to load
   * @return {Promise}
   */
  async loadSchema(schemaName) {
    if(!schemaName) {
      throw this.app.errors.MISSING_SCHEMA_NAME;
    }
    if(!this.schemaPaths[schemaName]) {
      throw this.app.errors.NOT_FOUND
        .setData({ type: 'schema', id: schemaName });
    }
    try {
      return JSON.parse((await fs.readFile(this.schemaPaths[schemaName])).toString());
    } catch(e) {
      throw this.app.errors.SCHEMA_LOAD_FAILED
        .setData({ schemaName });
    }
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
   * @param {Object} options.strict Restricts patches to only merge/patch schemas
   * @param {Object} options.overwriteProperties Whether existing properties should be overwritten by the patch schema
   * @return {Promise} Resolves with the schema
   */
  applyPatch(sourceSchema, patchSchema, options = {}) {
    const opts = _.defaults(options, { extendAnnotations: true, overwriteProperties: false, strict: true });
    const patchData = patchSchema?.$patch?.with || patchSchema?.$merge?.with || !opts.strict && patchSchema;
    if(!patchData) {
      this.log('warn', `cannot apply '${patchSchema.$anchor}' patch schema to ${sourceSchema.$anchor}, invalid schema format`);
      return sourceSchema;
    }
    if(opts.extendAnnotations) {
      ['$anchor', 'title', 'description'].forEach(p => {
        if(patchSchema[p]) sourceSchema[p] = patchSchema[p];
      });
    }
    if(patchData.properties) {
      const func = opts.overwriteProperties ? _.assign : _.merge;
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
   * Returns all schema defaults as a correctly structured object
   * @param {Object} schema
   * @param {Object} memo For recursion
   * @returns {Object} The defaults object
   */
  getObjectDefaults(schema, memo={}) {
    const props = schema.properties || schema.$merge?.with?.properties;
    return Object.entries(props).reduce((m,[k,v]) => {
      if(m[k]) return m;
      if(v.hasOwnProperty('default')) m[k] = v.default;
      if(v.type === 'object' && v.properties) this.getObjectDefaults(v, m[k]);
      return m;
    }, memo);
  }
  /**
   * Retrieves cached data
   * @param {String} key 
   * @return {Object} The cached schema, or undefined if unset or invalid
   */
  getCached(key) {
    const cache = this.schemaCache?.[key];
    const isValid = cache && Date.now() <= (cache.timestamp + this.cacheLifespan);
    if(isValid) return cache.schema;
  }
  /**
   * Update the cached schema data
   * @param {String} key 
   * @param {Object} schema The schema data to store
   */
  setCached(key, schema) {
    if(this.schemaCache) this.schemaCache[key] = { schema, timestamp: Date.now() };
  }
  /**
   * Retrieves the specified schema. Recursively applies any schema merge/patch schemas
   * @param {String} schemaName The name of the schema to return
   * @param {Object} options Extra options
   * @param {Boolean} options.applyExtensions Whether extension schemas are applied
   * @param {function} options.extensionFilter Function to selectively apply schema extensions. Function should return a boolean to signify whether the extension should be applied
   * @return {Promise} Resolves with the schema
   */
  async getSchema(schemaName, options = {}) {
    const cacheKey = `${schemaName}-${JSON.stringify(options)}`;
    const cachedData = this.getCached(cacheKey); 
    if(cachedData) {
      return cachedData;
    }
    const { applyExtensions, extensionFilter } = options;
    const schema = await this.loadSchema(schemaName);
    const mergeRef = schema?.$merge?.source?.$ref;
    if(!mergeRef) { // always apply the base schema
      this.applyPatch(await this.loadSchema(JsonSchemaModule.BASE_SCHEMA_NAME), schema, { strict: false });
    } else {
      const parentSchema = await this.getSchema(schemaName, options);
      schema = this.applyPatch(parentSchema, schema);
    }
    const extensions = await this.loadSchemaExtensions(schemaName);
    await Promise.all(extensions.map(async s => {
      const applyPatch = (typeof extensionFilter === 'function' && await extensionFilter(s.$anchor)) || applyExtensions;
      if(applyPatch) this.applyPatch(schema, s, { extendAnnotations: false });
    }));
    this.setCached(cacheKey, schema);
    return schema;
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
    const opts = _.defaults(options, { useDefaults: true, ignoreRequired: false });
    const schema = _.isString(schemaName) ? await this.getSchema(schemaName) : schemaName;
    const data = _.merge({}, opts.useDefaults ? this.getObjectDefaults(schema) : {}, dataToValidate);
    schema.adaptOpts = options;
    const validate = await this.validator.compileAsync(schema);
    if(validate(data)) {
      return data; // validated ok, nothing to do
    }
    const errors = validate.errors.reduce((memo, { instancePath, message }) => {
      if(opts.ignoreRequired && message.includes('required')) return memo;
      return [...memo, instancePath ? `${instancePath} ${message}` : message];
    }, []);
    if(errors.length) {
      throw this.app.errors.VALIDATION_FAILED
        .setData({ schemaName: schema.$anchor, errors: errors.join(', '), data })
    }
    return data;
  }
  /**
   * Sanitises data by removing attributes according to the context (provided by options)
   * @param {String|Object} schemaName The name of the schema to sanitise against (or alternatively, a JSON schema object)
   * @param {Object} dataToValidate The data to be sanitised
   * @param {Object} options
   * @param {Boolean} options.isInternal Whether internal attributes should be filtered
   * @param {Boolean} options.isReadOnly Whether read-only attributes should be filtered
   * @param {Boolean} options.sanitiseHtml Whether HTML text should be filtered
   * @param {Boolean} options.strict Whether to throw errors
   * @param {Object} memo Memo object to allow recursion
   * @return {Promise} Resolves with the sanitised data
   */
  async sanitise(schemaName, dataToSanitise, options = {}, memo = {}) {
    const opts = {
      isInternal: options.isInternal ?? false,
      isReadOnly: options.isReadOnly ?? false,
      sanitiseHtml: options.sanitiseHtml ?? true,
      strict: options.strict ?? true,
    };
    const schema = _.isString(schemaName) ? await this.getSchema(schemaName) : schemaName;
    Object.entries(schema.properties).forEach(([prop, config]) => {
      if(!dataToSanitise.hasOwnProperty(prop)) {
        return;
      }
      const omitProp = (opts.isInternal && config.isInternal) || (opts.isReadOnly && config.isReadOnly);
      if(omitProp) {
        if(opts.strict) throw this.app.errors.MODIFY_PROTECTED_ATTR.setData({ attribute: prop });
        return;
      }
      let value = dataToSanitise[prop];
      if(config.type === 'object' && config.properties) {
        memo[prop] = {};
        return this.sanitise(config, value, opts, memo[prop]);
      }
      if(config.type === 'string' && opts.sanitiseHtml) value = xss(value, this.getConfig('xssWhitelist'));
      memo[prop] = value;
    });
    return memo;
  }
}

export default JsonSchemaModule;