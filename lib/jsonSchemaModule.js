const { AbstractModule, DataValidationError, Utils } = require('adapt-authoring-core');
const Ajv = require('ajv');
const fs = require('fs-extra');
const glob = require('glob');
const _ = require('lodash');
const path = require('path');
const safeRegex = require('safe-regex');
const util = require('util');
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

    const ajvDefaults = {
      allErrors: true,
      loadSchema: s => this.getSchema(s)
    };
    /**
     * Reference to the Ajv instance
    * @type {Object}
    * @see https://github.com/epoberezkin/ajv#new-ajvobject-options---object
    */
    this.validatorFull = new Ajv({ ...ajvDefaults, useDefaults: true });
    this.validatorLite = new Ajv(ajvDefaults);

    this.setReady();

    this.overrideFormats();
    this.registerSchemas();
  }
  /**
  * Overrides the RegExps for built-in string formats
  * @return {Promise}
  */
  async overrideFormats() {
    const defaultRegExp = /.*/;
    Object.entries({
      "date-time": /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/,
      "email": /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/,
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
      this.validatorFull.addFormat(name, v, 'string');
      this.validatorLite.addFormat(name, v, 'string');
    });
    // on config load add any custom config overrides
    await this.app.waitForModule('config');
    const overrides = Object.entries(this.getConfig('formatOverrides'));
    overrides.forEach(([n,v]) => {
      this.validatorFull.addFormat(n, v, 'string');
      this.validatorLite.addFormat(n, v, 'string');
    });

    this.checkFormats();
  }
  /**
  * Attempt to warn if any of the specified string formats are likely to allow ReDoS attacks
  * @see https://github.com/substack/safe-regex
  */
  checkFormats() {
    Object.entries(this.validatorFull._formats).forEach(([name,re]) => {
      if(!safeRegex(re)) {
        this.log('warn', `unsafe RegExp for format '${name}', using default`);
        this.validatorFull.addFormat(name, defaultRegExp, 'string');
        this.validatorLite.addFormat(name, defaultRegExp, 'string');
      }
    });
  }
  addKeyword(keyword, options) {
    this.validatorFull.addKeyword(keyword, options);
    this.validatorLite.addKeyword(keyword, options);
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
    if(!Utils.isString(filePath)) {
      this.log('error', `failed to register schema, filePath must be a string`);
      return;
    }
    const name = path.basename(filePath).replace('.schema.json','');

    if(this.schemaPaths[name]) {
      this.log('error', `cannot register schema, name '${name}' is in use`);
      return;
    }
    this.schemaPaths[name] = filePath;
    this.log('debug', `registered schema '${name}' at ${filePath}`);
    return { name, filePath };

    this.log('error', e);
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
    options = _.defaults(options, { useDefaults: true, ignoreRequired: false });
    const data = _.defaultsDeep({}, dataToValidate);
    const schema = Utils.isString(schemaName) ? await this.getSchema(schemaName) : schemaName;
    const validator = options.useDefaults ? this.validatorFull : this.validatorLite;
    const validate = await validator.compileAsync(schema);
    if(validate(data)) {
      return data; // validated ok, nothing to do
    }
    const errors = [];
    validate.errors.forEach(e => {
      const message = (e.dataPath) ? `${e.dataPath} ${e.message}` : e.message;
      if(options.ignoreRequired && message.includes('required')) return;
      errors.push(message);
    });
    if(errors.length) {
      throw new DataValidationError('Data validation failed', errors);
    }
    return data;
  }
  /**
  * Extends an existing schema with extra properties
  * @param {String} schemaName The name of the schema to extend
  * @param {String} addSchemaName The name of the schema to extend with
  */
  extendSchema(schemaName, addSchemaName) {
     if(!this.schemaExtensions[schemaName]) {
       this.schemaExtensions[schemaName] = [];
     }
     /** @todo validate schema here (must also check for overlapping attributes - possibly allow for overrides) */
    this.schemaExtensions[schemaName].push(addSchemaName);
    this.log('debug', `'${addSchemaName}' extension added to schema '${schemaName}'`);
  }
  /**
  * Retrieves the specified schema
  * @param {String} schemaName The name of the schema to return
  * @return {Promise} Resolves with the schema
  */
  getSchema(schemaName) {
    const exts = this.schemaExtensions[schemaName];
    return exts ? this.composeSchema(schemaName, ...exts) : this.loadSchema(schemaName);
  }
  /**
  * Like getSchema, but returns a composite schema from several existing schemas
  * @param {String} baseSchemaName The name of the schema to be used as the base schema
  * @param {...String} additionalSchemaNames The name of the schemas to extend the base schema
  * @return {Promise} Resolves with the composite schema
  */
  async composeSchema(baseSchemaName, ...additionalSchemaNames) {
    const base = await this.loadSchema(baseSchemaName);
    if(!additionalSchemaNames.length) {
      return base;
    }
    await Promise.all(additionalSchemaNames.map(async s => {
      try {
        const ext = await this.loadSchema(s);
        base.properties = _.defaultsDeep(base.properties, ext.properties);
        if(!ext.required || !ext.required.length) {
          return;
        }
        if(!base.required) base.required = [];
        base.required.push(...ext.required);
      } catch(e) {
        this.log('warn', `${s} not added to composed schema (${baseSchemaName}), ${e.message}`);
      }
    }));
    return base;
  }
  /**
  * Loads the specified schema file. Note that the schema must have been registered already, and stored in {@link JsonSchemaModule#schemaPaths}.
  * @param {String} schemaName The name of the schema to load
  * @return {Promise}
  */
  loadSchema(schemaName) {
    return new Promise(async (resolve, reject) => {
      if(!schemaName) {
        return reject(new Error(`Must provide a schema name`));
      }
      if(!this.schemaPaths[schemaName]) {
        const e = new Error(`Cannot load unknown schema '${schemaName}'`);
        e.statusCode = 404;
        return reject(e);
      }
      try {
        resolve(await fs.readJson(this.schemaPaths[schemaName]));
      } catch(e) {
        const e2 = new Error(`Failed to load schema file '${schemaName}'`);
        e2.detail = e.message;
        e2.statusCode = 500;
        reject(e2);
      }
    });
  }
}

module.exports = JsonSchemaModule;
