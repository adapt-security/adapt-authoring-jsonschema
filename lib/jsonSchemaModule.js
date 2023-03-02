import _ from 'lodash';
import { AbstractModule } from 'adapt-authoring-core';
import Ajv from 'ajv/dist/2020.js';
import fs from 'fs/promises';
import glob from 'glob';
import Keywords from './Keywords.js'
import safeRegex from 'safe-regex';
import SchemaCache from './SchemaCache.js';
import xss from 'xss';

/** @ignore */ const BASE_SCHEMA_NAME = 'base';
/**
 * Module which add support for the JSON Schema specification
 * @memberof jsonschema
 * @extends {AbstractModule}
 */
class JsonSchemaModule extends AbstractModule {
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
    this.schemaCache = new SchemaCache();
    /**
     * Reference to the Ajv instance
     * @type {external:Ajv}
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
    this.addStringFormats({
      "date-time": /[A-za-z0-9:+\(\)]+/,
      "email": /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/,
      "time": /^(\d{2}):(\d{2}):(\d{2})\+(\d{2}):(\d{2})$/,
      "uri": /^(.+):\/\/(www\.)?[-a-zA-Z0-9@:%_\+.~#?&//=]{1,256}/,
    });
    this.onReady()
      .then(() => this.app.waitForModule('config', 'errors'))
      .then(() => this.addStringFormats(this.getConfig('formatOverrides')))
      .then(() => this.registerSchemas())
      .catch(e => this.log('error', e));
  }
  /**
   * Adds string formats to the Ajv validator
   */
  addStringFormats(formats) {
    Object.entries(formats).forEach(([name, re]) => {
      const isUnsafe = safeRegex(re);
      if(isUnsafe) this.log('warn', `unsafe RegExp for format '${name}' (${re}), using default`);
      this.validator.addFormat(name, isUnsafe ? /.*/ : re);
    });
  }
  /**
   * Adds a new keyword to be used in JSON schemas
   * @param {AjvKeyword} definition
   */
  addKeyword(definition) {
    try {
      this.validator.addKeyword(definition);
    } catch(e) {
      this.log('warn', `failed to define keyword '${definition.keyword}', ${e}`);
    }
  }
  /**
   * Returns all schema defaults as a correctly structured object
   * @param {Object} schema
   * @param {Object} memo For recursion
   * @returns {Object} The defaults object
   */
  getObjectDefaults(schema) {
    const props = schema.properties ?? schema.$merge?.with?.properties ?? schema.$patch?.with?.properties;
    return _.mapValues(props, s => s.properties ? this.getObjectDefaults(s) : s.default);
  }
  /**
   * Searches all Adapt dependencies for any local JSON schemas and registers them for use in the app. Schemas must be located in in a `/schema` folder, and be named appropriately: `*.schema.json`.
   * @return {Promise}
   */
  async registerSchemas() {
    this.schemaPaths = {};
    return Promise.all(Object.values(this.app.dependencies).map(async d => {
      const files = await new Promise((resolve, reject) => {
        glob('schema/*.schema.json', { cwd: d.rootDir, absolute: true }, (e,f) => e ? reject(e) : resolve(f))
      });
      (await Promise.allSettled(files.map(f => this.registerSchema(f))))
        .filter(r => r.status === 'rejected')
        .forEach(r => this.log('warn', r.reason));
    }));
  }
  /**
   * Registers a single JSON schema for use in the app
   * @param {String} filePath Path to the schema file
   * @param {RegisterSchemaOptions} options Extra options
   * @return {Promise}
   */
  async registerSchema(filePath, options = {}) {
    if(!_.isString(filePath)) {
      throw this.app.errors.INVALID_PARAMS.setData({ params: ['filePath'] });
    }
    let json, name;
    try {
      json = JSON.parse((await fs.readFile(filePath)).toString());
      name = json.$anchor;
    } catch(e) {
      throw this.app.errors.SCHEMA_LOAD_FAILED.setData({ schemaName: filePath });
    }
    this.validateSchema(json);

    if(this.schemaPaths[name]) {
      if(options.replace) this.deregisterSchema(name);
      else throw this.app.errors.SCHEMA_EXISTS.setData({ name, filepath });
    }
    this.schemaPaths[name] = filePath;
    this.log('debug', 'REGISTER_SCHEMA', name, filePath);
    
    if(json.$patch) this.extendSchema(json.$patch?.source?.$ref, name);
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
    if(!_.isString(baseSchemaName) || !_.isString(extSchemaName)) {
      throw this.app.errors.INVALID_PARAMS.setData({ params: ['baseSchemaName', 'extSchemaName'] });
    }
    if(!this.schemaExtensions[baseSchemaName]) {
      this.schemaExtensions[baseSchemaName] = [];
    }
    this.schemaExtensions[baseSchemaName].push(extSchemaName);
    this.log('debug', 'EXTEND_SCHEMA', baseSchemaName, extSchemaName);
  }
  /**
   * Loads a compiled schema validation function from the constituent schema parts
   * @param {String} schemaName
   * @param {LoadSchemaOptions} options 
   * @returns {Function} The compiled schema
   */
  async loadSchema(schemaName, options) {
    const { applyExtensions, extensionFilter } = options;
    let schema;
    try {
      schema = JSON.parse((await fs.readFile(this.schemaPaths[schemaName])).toString());
    } catch(e) {
      throw this.app.errors.SCHEMA_LOAD_FAILED.setData({ schemaName });
    }
    const mergeRef = schema?.$merge?.source?.$ref;

    if(mergeRef) { // merge parent schema
      schema = this.applyPatch(await this.getSchema(mergeRef, { ...options, compiled: false }), schema);
    } else if(schema?.$anchor !== BASE_SCHEMA_NAME) { // extend all schemas from the base schema
      this.applyPatch(schema, await this.getSchema(BASE_SCHEMA_NAME, { compiled: false }), { strict: false, extendAnnotations: false });
    }
    if(this.schemaExtensions[schemaName]) {
      await Promise.all(this.schemaExtensions[schemaName].map(async s => {
        const { schema: extSchema } = await this.getSchema(s, { useCache: options.useCache });
        const applyPatch = typeof extensionFilter === 'function' ? extensionFilter(extSchema.$anchor) : applyExtensions !== false;
        if(applyPatch) this.applyPatch(schema, extSchema, { extendAnnotations: false });
      }));
    }
    const compiled = await this.validator.compileAsync(JSON.parse(JSON.stringify(schema)));
    this.schemaCache.set(compiled);
    return compiled;
  }
  /**
   * Applies a patch schema to another schema
   * @param {Object} sourceSchema The base schema to be patched
   * @param {Object} patchSchema The patch schema to apply to the base
   * @param {ApplyPatchOptions} options
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
      const mergeFunc = opts.overwriteProperties ? _.merge : _.defaultsDeep;
      mergeFunc(sourceSchema.properties, patchData.properties);
    }
    ['allOf','anyOf','oneOf'].forEach(p => {
      if(patchData[p]?.length) sourceSchema[p] = (sourceSchema[p] ?? []).concat(_.cloneDeep(patchData[p]));
    });
    if(patchData.required) {
      sourceSchema.required = _.uniq([...(sourceSchema.required ?? []), ...patchData.required]);
    }
    return sourceSchema;
  }
  /**
   * Validates a JSON schema
   * @param {Object} schema Schema to validate
   */
  validateSchema(schema) {
    if(this.validator.validateSchema(schema)) {
      return;
    }
    const errors = this.validator.errors.map(e => e.instancePath ? `${e.instancePath} ${e.message}` : e.message);
    if(errors.length) {
      throw this.app.errors.INVALID_SCHEMA
        .setData({ schemaName: schema.$anchor, errors: errors.join(', ') });
    }
  }
  /**
   * Retrieves the specified schema. Recursively applies any schema merge/patch schemas. Will returned cached data if enabled.
   * @param {String} schemaName The name of the schema to return
   * @param {LoadSchemaOptions} options
   * @param {Boolean} options.compiled If false, the raw schema will be returned
   * @return {Promise} The compiled schema validation function (default) or the raw schema
   */
  async getSchema(schemaName, options = {}) {
    if(!_.isString(schemaName)) throw this.app.errors.INVALID_PARAMS.setData({ params: ['schemaName'] });
    if(!this.schemaPaths[schemaName]) throw this.app.errors.NOT_FOUND.setData({ type: 'schema', id: schemaName });

    const schema = (options.useCache !== false && this.schemaCache.get(schemaName)?.data) || 
      await this.loadSchema(schemaName, options);
      
    return options.compiled !== false ? schema : schema.schema;
  }
  /**
   * Checks passed data against the specified schema (if it exists)
   * @param {Function|String} validateFunc The compiled schema validation function (or alternatively, the name of the schema to validate against)
   * @param {Object} dataToValidate The data to be validated
   * @param {ValidateOptions} options
   * @return {Promise} Resolves with the validated data
   */
  async validate(validateFunc, dataToValidate, options = {}) {
    const opts = _.defaults(options, { useDefaults: true, ignoreRequired: false });
    if(_.isString(validateFunc)) validateFunc = await this.getSchema(validateFunc);

    const data = _.defaultsDeep(_.cloneDeep(dataToValidate), 
      opts.useDefaults ? this.getObjectDefaults(validateFunc.schema) : {});

    if(!validateFunc(data)) {
      const errors = validateFunc.errors
        .filter(e => !opts.ignoreRequired || e.message.includes('required'))
        .map(e => e.instancePath ? `${e.instancePath} ${e.message}` : e.message)
        .reduce((s, e) => s+= `${e}, `, '');

      if(errors.length) 
        throw this.app.errors.VALIDATION_FAILED.setData({ schemaName: validateFunc.schema.$anchor, errors, data })
    }
    return data;
  }
  /**
   * Sanitises data by removing attributes according to the context (provided by options)
   * @param {Function|Object} schemaName The schema validation function or raw schema itself
   * @param {Object} dataToValidate The data to be sanitised
   * @param {SanitiseOptions} options
   * @return {Promise} Resolves with the sanitised data
   */
  async sanitise(schema, dataToSanitise, options = {}) {
    const opts = _.defaults(options, { isInternal: false, isReadOnly: false, sanitiseHtml: true, strict: true });
    
    return _.mapValues((schema.schema ?? schema).properties, (config, prop) => {
      const value = dataToSanitise[prop];
      const ignore = (opts.isInternal && config.isInternal) || (opts.isReadOnly && config.isReadOnly);
      
      if(ignore && opts.strict) {
        throw this.app.errors.MODIFY_PROTECTED_ATTR.setData({ attribute: prop });
      }
      if(value !== undefined && !ignore) {
        return config.type === 'object' && config.properties ? this.sanitise(config, value, opts) : 
          config.type === 'string' && opts.sanitiseHtml ? xss(value, this.getConfig('xssWhitelist')) :
          value;
      }
    });
  }
}

export default JsonSchemaModule;