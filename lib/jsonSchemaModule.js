const { AbstractModule, DataValidationError } = require('adapt-authoring-core');
const Ajv = require('ajv');
const fs = require('fs-extra');
const glob = require('glob');
const path = require('path');
const safeRegex = require('safe-regex');
/**
* Module which add support for the JSON Schema specification
* @extends {AbstractModule}
*/
class JsonSchemaModule extends AbstractModule {
  /** @override */
  constructor(app, pkg) {
    super(app, pkg);
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
      allErrors: true,
      removeAdditional: true,
      strictDefaults: true,
      strictKeywords: true,
      useDefaults: true,
      loadSchema: s => this.getSchema(s)
    });
    this.overrideFormats();
    this.checkFormats();
  }
  /**
  * Overrides the RegExps for built-in string formats
  */
  overrideFormats() {
    const defaultRegExp = /.*/;
    Object.entries({
      "date-time": /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/,
      "email": /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/,
      "objectid": /^[a-f\d]{24}$/,
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
      'uuid': defaultRegExp,
      ...this.getConfig('formatOverrides')
    }).forEach(([name, v]) => this.validator.addFormat(name, v, 'string'));
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
  /** @override */
  preload(app, resolve, reject) {
    /**
    * Reference to the router instance 
    * @type {express~Router}
    */
    this.router = app.getModule('server').api.createChildRouter('jsonschemas');
    this.router.addRoute({
      route: '/:name?.schema.json',
      handlers: { get: this.serveSchemas.bind(this) }
    });
    this.registerSchemas().then(resolve).catch(reject);
  }
  /**
  * Searches all Adapt dependencies for any local JSON schemas and registers them for use in the app. Schemas must be located in in a `/schema` folder, and be named appropriately: `*.schema.json`.
  * @return {Promise}
  */
  registerSchemas() {
    const globPattern = 'schema/*.schema.json';
    const re = /schema\/(.+)\.schema\.json/;
    this.schemaPaths = {};
    return Promise.all(Object.values(this.app.dependencies).map(d => {
      return new Promise((resolve, reject) => {
        glob(globPattern, { cwd: d.dir }, (error, files) => {
          if(error) return reject(error);
          if(!files.length) return resolve();
          files.forEach(f => this.schemaPaths[f.match(re)[1]] = path.join(d.dir, f));
          resolve();
        });
      });
    }));
  }
  /**
  * Checks passed data against the specified schema (if it exists)
  * @param {String} schemaName The name of the schema to validate against
  * @param {Object} dataToValidate The data to be validated
  * @return {Promise}
  */
  validate(schemaName, dataToValidate) {
    return new Promise(async (resolve, reject) => {
      let validate;
      try {
        const schema = await this.getSchema(schemaName);
        validate = await this.validator.compileAsync(schema);
      } catch(e) {
        return reject(e);
      }
      const isValid = validate(dataToValidate);
      if(!isValid) {
        const errors = validate.errors.map(e => (e.dataPath) ? `${e.dataPath} ${e.message}` : e.message);
        return reject(new DataValidationError('Data validation failed', errors));
      }
      resolve();
    });
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
  * @param {String} schemaName The name of the schema to validate against
  * @return {Promise}
  */
  getSchema(schemaName) {
    return new Promise(async (resolve, reject) => {
      let schema;
      try {
        schema = await this.loadSchema(schemaName);
      } catch(e) {
        return reject(e);
      }
      if(!this.schemaExtensions[schemaName]) {
        return resolve(schema);
      }
      Promise.all(this.schemaExtensions[schemaName].map(s => {
        return new Promise(async (resolve, reject) => {
          try {
            const extension = await this.loadSchema(s);
            schema.allOf = schema.allOf ? [...schema.allOf, extension] : [extension];
          } catch(e) {
            this.log('warn', e.message);
          }
          resolve();
        });
      })).then(() => resolve(schema));
    });
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
  /**
  * Retrieves the specified schema
  * @param {ClientRequest} req Client request object
  * @param {ServerResponse} res Server response object
  * @param {Function} next Callback to continue execution of the stack
  */
  serveSchemas(req, res, next) {
    this.getSchema(req.params.name)
      .then(s => res.type('application/schema+json').json(s))
      .catch(e => {
        this.log('error', e);
        res.status(e.statusCode).json({ error: e.message });
      });
  }
}

module.exports = JsonSchemaModule;
