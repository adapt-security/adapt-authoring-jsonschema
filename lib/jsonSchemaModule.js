import _ from 'lodash';
import { AbstractModule } from 'adapt-authoring-core';
import Ajv from 'ajv/dist/2020.js';
import fs from 'fs/promises';
import globCallback from 'glob';
import Keywords from './Keywords.js'
import path from 'path';
import { promisify } from 'util';
import safeRegex from 'safe-regex';
import SchemaCache from './SchemaCache.js';
import xss from 'xss';

const globPromise = promisify(globCallback);

/** @ignore */ const defaultRegExp = /.*/;
/**
 * Module which add support for the JSON Schema specification
 * @memberof jsonschema
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
    this.schemaCache = new SchemaCache();
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
    Object.entries(this.getConfig('formatOverrides')).forEach(f => this.validator.addFormat(...f));
    // warn if any of the specified string formats are likely to allow ReDoS attacks
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
      const files = await globPromise('schema/*.schema.json', { cwd: d.rootDir });
      (await Promise.allSettled(files.map(f => this.registerSchema(path.join(d.rootDir, f)))))
        .filter(r => r.status === 'rejected')
        .forEach(r => this.log('warn', r.reason));
    }));
  }
  /**
   * Registers a single JSON schema for use in the app
   * @param {String} filePath Path to the schema file
   * @param {RegisterSchemaOptions} options Extra options
   * @return {Promise} Resolves with schema data
   */
  async registerSchema(filePath, options = {}) {
    if(!_.isString(filePath)) {
      throw this.app.errors.INVALID_PARAMS.setData({ params: ['filePath'] });
    }
    let json;
    try {
      json = JSON.parse((await fs.readFile(filePath)).toString());
    } catch(e) {
      throw this.app.errors.SCHEMA_LOAD_FAILED.setData({ schemaName: filePath });
    }
    const name = json.$anchor;
    if(!name) {
      throw this.app.errors.INVALID_SCHEMA.setData({ errors: [`Schema ${filePath} is missing $anchor`] });
    }
    this.validateSchema(json);

    if(this.schemaPaths[name]) {
      if(options.replace) this.deregisterSchema(name);
      else throw this.app.errors.SCHEMA_EXISTS.setData({ name, filepath });
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
    } else if(schema?.$anchor !== JsonSchemaModule.BASE_SCHEMA_NAME) { // extend all schemas from the base schema
      this.applyPatch(schema, await this.getSchema(JsonSchemaModule.BASE_SCHEMA_NAME, { compiled: false }), { strict: false, extendAnnotations: false });
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
   * @param {String|Object} schemaName The name of the schema to sanitise against (or alternatively, a JSON schema object)
   * @param {Object} dataToValidate The data to be sanitised
   * @param {SanitiseOptions} options
   * @param {Object} memo Memo object to allow recursion
   * @return {Promise} Resolves with the sanitised data
   */
  async sanitise(schemaName, dataToSanitise, options = {}, memo = {}) {
    const opts = _.defaults(options, { isInternal: false, isReadOnly: false, sanitiseHtml: true, strict: true });
    const schema = schemaName?.schema ?? 
      (_.isString(schemaName) ? await this.getSchema(schemaName, { compiled: false }) : schemaName);

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
      if(config.type === 'string' && opts.sanitiseHtml) {
        value = xss(value, this.getConfig('xssWhitelist'));
      }
      memo[prop] = value;
    });
    return memo;
  }
}

export default JsonSchemaModule;