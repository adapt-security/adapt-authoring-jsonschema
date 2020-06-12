const _ = require('lodash');
const { AbstractModule } = require('adapt-authoring-core');
const Ajv = require('ajv');
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
    this.validator = new Ajv({ allErrors: true, loadSchema: this.getSchema.bind(this) });

    this.setReady();

    this.overrideFormats();
    this.registerSchemas();
  }
  /**
  * Overrides the RegExps for built-in string formats
  * @return {Promise}
  */
  async overrideFormats() {
    Object.entries({
      "date-time": /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/,
      "email": /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/,
      "password": /^(?=.*[\w])(?=.*[\W])[\w\W]{8,}$/,
      "time": /^(\d{2}):(\d{2}):(\d{2})\+(\d{2}):(\d{2})$/,
      /* Override built-in unsafe RegExps to default */
      'hostname': defaultRegExp,
      'ipv4': defaultRegExp,
      'ipv6': defaultRegExp,
      'json-pointer-uri-fragment': defaultRegExp,
      'json-pointer': defaultRegExp,
      'relative-json-pointer': defaultRegExp,
      'uri-reference': defaultRegExp,
      'uri-template': defaultRegExp,
      'uri': defaultRegExp,
      'url': defaultRegExp,
      'uuid': defaultRegExp
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
    Object.entries(this.validator._formats).forEach(([name,re]) => {
      if(!safeRegex(re)) {
        this.log('warn', `unsafe RegExp for format '${name}', using default`);
        this.validator.addFormat(name, defaultRegExp, 'string');
      }
    });
  }
  /**
  * Adds a new keyword to be used in JSON schemas
  * @param {String} keyword Name of the keyword
  * @param {Object} options
  * @see https://github.com/epoberezkin/ajv#addkeywordstring-keyword-object-definition---ajv
  */
  addKeyword(keyword, options) {
    this.validator.addKeyword(keyword, options);
  }
  /**
  * Searches all Adapt dependencies for any local JSON schemas and registers them for use in the app. Schemas must be located in in a `/schema` folder, and be named appropriately: `*.schema.json`.
  * @return {Promise}
  */
  async registerSchemas() {
    this.schemaPaths = {};
    return Promise.all(Object.values(this.app.dependencies).map(async d => {
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
    const name = json.$id || path.basename(filePath).replace('.schema.json','');

    if(this.schemaPaths[name]) {
      this.log('error', `cannot register schema, name '${name}' is in use`);
      return;
    }
    this.schemaPaths[name] = filePath;

    this.log('debug', `registered schema '${name}' at ${filePath}`);
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
  * @param {String} baseSchemaName The name of the schema to return
  * @return {Promise} Resolves with the schema
  */
  async getSchema(baseSchemaName) {
    const modelSchemas = await this.loadSchemaHierarchy(baseSchemaName);
    const extensionSchemas = await this.loadSchemaExtensions(baseSchemaName);
    const schema = modelSchemas.reduce((m,s) => this.applyPatch(m,s), modelSchemas.shift());
    extensionSchemas.forEach(s => this.applyPatch(schema, s, { extendAnnotations: false }));
    return schema;
  }
  async loadSchemaHierarchy(schemaName, schemas=[]) {
    const schema = _.isString(schemaName) ? await this.loadSchema(schemaName) : schemaName;
    if(schema.$merge) {
      await this.loadSchemaHierarchy(schema.$merge.source.$ref, schemas);
    }
    schemas.push(schema);
    return schemas;
  }
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
  applyPatch(sourceSchema, patchSchema, options={ extendAnnotations: true }) {
    let mergeData;
    try {
      mergeData = patchSchema.$merge.with;
    } catch {
      this.log('warn', `cannot apply '${patchSchema.$id}' merge schema to ${sourceSchema.$id}, invalid schema format`, patchSchema);
      return sourceSchema;
    }
    if(options.extendAnnotations) {
      ['$id', 'title', 'description'].forEach(p => {
        if(patchSchema[p]) sourceSchema[p] = patchSchema[p];
      });
    }
    if(mergeData.properties) {
      Object.assign(sourceSchema.properties, _.cloneDeep(mergeData.properties));
    }
    ['required','allOf','anyOf','oneOf'].forEach(p => {
      if(mergeData[p] && mergeData[p].length) {
        const cloned = _.cloneDeep(mergeData[p]);
        sourceSchema[p] = sourceSchema[p] ? [...sourceSchema[p], ...cloned]: [...cloned];
      }
    });
    return sourceSchema;
  }
  /**
  * Loads the specified schema file. Note that the schema must have been registered already, and stored in {@link JsonSchemaModule#schemaPaths}.
  * @param {String} schemaName The name of the schema to load
  * @return {Promise}
  */
  async loadSchema(schemaName) {
    if(!schemaName) {
      throw new Error(`Must provide a schema name`);
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
    const data = _.defaultsDeep(o.useDefaults ? await this.applyDefaults(schema) : {}, dataToValidate);
    const validate = await this.validator.compileAsync(schema);
    if(validate(data)) {
      return data; // validated ok, nothing to do
    }
    const errors = [];
    validate.errors.forEach(e => {
      const message = e.dataPath ? `${e.dataPath} ${e.message}` : e.message;
      if(o.ignoreRequired && message.includes('required')) return;
      errors.push(message);
    });
    if(errors.length) {
      throw new DataValidationError('Data validation failed', errors);
    }
    return data;
  }
}

module.exports = JsonSchemaModule;
