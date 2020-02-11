const _ = require('lodash');
const { DataValidationError } = require('adapt-authoring-core');
const Ajv = require('ajv');
const fs = require('fs-extra');
const path = require('path');
const safeRegex = require('safe-regex');

const defaultRegExp = /.+/;

class JsonSchemaValidator {
  constructor() {
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
    this.ajv = new Ajv({
      allErrors: true,
      useDefaults: true,
      loadSchema: s => this.getSchema(s),
      formats: {
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
      }
    });
  }
  /**
  * Attempt to warn if any of the specified string formats are likely to allow ReDoS attacks
  * @see https://github.com/substack/safe-regex
  */
  checkFormats() {
    Object.entries(this.ajv._formats).forEach(([name,re]) => {
      if(!safeRegex(re)) {
        this.log('warn', `unsafe RegExp for format '${name}', using default`);
        this.ajv.addFormat(name, defaultRegExp, 'string');
      }
    });
  }
  /**
  * Registers a single JSON schemas for use in the app
  * @param {String} filePath Path to the schema file
  * @return {Promise} Resolves with schema data
  */
  registerSchema(filePath) {
    if(!_.isString(filePath)) {
      throw new Error(`failed to register schema, filePath must be a string`);
    }
    const name = path.basename(filePath).replace('.schema.json','');

    if(this.schemaPaths[name]) {
      const e = new Error(`cannot register schema, name '${name}' is in use`);
      e.name = name;
      throw e;
    }
    this.schemaPaths[name] = filePath;
    return { name, filePath };
  }
  /**
  * Extends an existing schema with extra properties
  * @param {String} schemaName The name of the schema to extend
  * @param {String} addSchemaName The name of the schema to extend with
  */
  extendSchema(schemaName, addSchemaName) {
    const existing = this.schemaExtensions[schemaName] || [];
    this.schemaExtensions[schemaName] = [ ...existing, addSchemaName ];
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
      return (await fs.readJson(this.schemaPaths[schemaName]));
    } catch(e) {
      const e2 = new Error(`Failed to load schema file '${schemaName}'`);
      e2.detail = e.message;
      e2.statusCode = 500;
      throw e;
    }
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
    const results = await Promise.all(additionalSchemaNames.map(async s => {
      const ext = await this.loadSchema(s);
      base.properties = _.defaultsDeep(base.properties, ext.properties);
      if(!ext.required || !ext.required.length) {
        return;
      }
      if(!base.required) base.required = [];
      base.required.push(...ext.required);
    }));
    results.forEach(r => {
      console.log(r);
      // this.log('warn', `${s} not added to composed schema (${baseSchemaName}), ${e.message}`);
    });
    return base;
  }
  /**
  * Retrieves the specified schema
  * @param {String} schemaName The name of the schema to return
  * @return {Promise} Resolves with the schema
  */
  async getSchema(schemaName) {
    const exts = this.schemaExtensions[schemaName];
    return exts ? this.composeSchema(schemaName, ...exts) : this.loadSchema(schemaName);
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
    this.ajv._opts.useDefaults = options.useDefaults;

    const data = _.defaultsDeep({}, dataToValidate);
    const schema = _.isString(schemaName) ? await this.getSchema(schemaName) : schemaName;
    const validate = await this.ajv.compileAsync(schema);

    if(validate(data)) {
      return data; // validated ok, nothing to do
    }
    const errors = [];
    validate.errors.forEach(e => {
      const message = e.dataPath ? `${e.dataPath} ${e.message}` : e.message;
      if(options.ignoreRequired && message.includes('required')) return;
      errors.push(message);
    });
    if(errors.length) {
      throw new DataValidationError('Data validation failed', errors);
    }
    return data;
  }
}

module.exports = JsonSchemaValidator;
