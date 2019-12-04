const { AbstractModule, DataValidationError } = require('adapt-authoring-core');
const Ajv = require('ajv');
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
    this.schemaExtensions = {};
    this.schemaPaths = {};
    this.validator = new Ajv({
      allErrors: true,
      removeAdditional: true,
      strictDefaults: true,
      strictKeywords: true,
      useDefaults: true
    });
    this.overrideFormats();
    this.checkFormats();
  }
  /**
  * Overrides RegExps for built in string formats
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
    this.router = app.getModule('server').api.createChildRouter('jsonschemas');
    this.router.addRoute({
      route: '/:name?.schema.json',
      handlers: { get: this.serveSchemas.bind(this) }
    });
    this.registerSchemas().then(resolve).catch(reject);
  }
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
  * @throws {DataValidationError}
  */
  validate(schemaName, dataToValidate) {
    const schema = this.getSchema(schemaName);
    const isValid = this.validator.validate(schema, dataToValidate);
    if(!isValid) {
      const errors = validate.errors.map(e => (e.dataPath) ? `${e.dataPath} ${e.message}` : e.message);
      throw new DataValidationError('Data validation failed', errors);
    }
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
  }
  /**
  * Retrieves the specified schema
  * @param {String} schemaName The name of the schema to validate against
  * @return {Object}
  * @throws {Error}
  */
  getSchema(schemaName) {
    if(!schemaName) {
      throw new Error(`Must provide a schema name`);
    }
    let schema;
    try {
      schema = require(this.schemaPaths[schemaName]);
    } catch(e) {
      throw new Error(`Failed to load schema file '${schemaName}' at ${this.schemaPaths[schemaName]}, ${e.message}`);
    }
    const schemaExtensions = this.schemaExtensions[schemaName].map(e => {
      try {
        return require(e);
      } catch(e) {
        throw new Error(`Failed to load '${schemaName}' schema extension at ${e}, ${e.message}`);
      }
    });
    if(schemaExtensions.length) schema.allOf = schemaExtensions;
    console.log(schema);
    return schema;
  }
  /**
  * Retrieves the specified schema
  * @param {ClientRequest} req Client request object
  * @param {ServerResponse} res Server response object
  * @param {Function} next Callback to continue execution of the stack
  */
  serveSchemas(req, res, next) {
    const name = req.params.name;
    const s = this.getSchema(name);
    if(!s) {
      return res.status(404).json({ error: `No '${name}' schema found`});
    }
    res.type('application/schema+json').json(s);
  }
}

module.exports = JsonSchemaModule;
