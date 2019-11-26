const { AbstractModule, DataValidationError } = require('adapt-authoring-core');
const Ajv = require('ajv');
const safeRegex = require('safe-regex');
/**
* Module which add support for the JSON Schema specification
* @extends {AbstractModule}
*/
class JsonSchemaModule extends AbstractModule {
  /** @override */
  constructor(app, pkg) {
    super(app, pkg);
    this.schemas = {};
    this.schemaExtensions = {};
    this.schemasCompiled = {};
    this.validator = new Ajv({
      allErrors: true,
      useDefaults: true,
      coerceTypes: "array",
      strictDefaults: true,
      strictKeywords: true
    });
    this.overrideFormats();
    this.checkFormats();
  }
  /**
  * Overrides RegExps for built in string formats
  */
  overrideFormats() {
    Object.entries({
      "time": /^(\d{2}):(\d{2}):(\d{2})\+(\d{2}):(\d{2})$/,
      "date-time": /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/,
      "email": /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,6}$/,
      ...this.getConfig('formatOverrides')
    }).forEach(([name, v]) => this.validator.addFormat(name, v, 'string'));
  }
  checkFormats() {
    Object.entries(this.validator._formats).forEach(([name,re]) => {
      if(!safeRegex(re)) {
        this.log('warn', `unsafe RegExp for format '${name}', using default`);
        this.validator.addFormat(name, /.+/, 'string');
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
    resolve();
  }
  /** @override */
  boot(app, resolve, reject) {
    Object.keys(this.schemas).forEach(k => {
      this.schemasCompiled[k] = this.validator.compile(this.getSchema(k));
    });
    resolve();
  }
  /**
  * Checks passed data against the specified schema (if it exists)
  * @param {String} schemaName The name of the schema to validate against
  * @param {Object} dataToValidate The data to be validated
  * @throws {DataValidationError}
  */
  validate(schemaName, dataToValidate) {
    const validate = this.schemasCompiled[schemaName];
    const isValid = validate(dataToValidate);
    if(!isValid) {
      throw new DataValidationError('Data validation failed', validate.errors.map(e => {
        return (e.dataPath) ? `${e.dataPath} ${e.message}` : e.message;
      }));
    }
  }
  /**
  * Adds a schema for use by the application
  * @param {String} schemaData The schema definition
  */
  addSchema(schemaData) {
    if(this.hasBooted) {
      return this.log('warn', `Cannot add schema after module has booted (${schemaData.title})`)
    }
    if(this.schemas[schemaData.title]) {
      throw new Error(`Cannot add '${schemaData.title}', a schema with that name already exists`);
    }
    const isValid = this.validator.validateSchema(schemaData);
    if(!isValid) {
      this.log('error', `Cannot add invalid schema '${schemaData.title}'`);
      return;
    }
    this.schemas[schemaData.title] = schemaData;
  }
  /**
  * Extends an existing schema with extra properties
  * @param {String} schemaName The name of the schema to extend (must already exist)
  * @param {String} schemaData The data to extend original schema
  * @param {Object} options Options for configuring the schema extension
  */
  extendSchema(schemaName, schemaData, options = { overrideExisting: false }) {
    if(!this.schemas[schemaName]) {
      throw new Error(`Cannot extend '${schemaName}', it doesn't exist`);
    }
     if(!this.schemaExtensions[schemaName]) {
       this.schemaExtensions[schemaName] = [];
     }
     /** @todo validate schema here (must also check for overlapping attributes) */
    this.schemaExtensions[schemaName].push(schemaData);
  }
  /**
  * Retrieves the specified schema
  * @param {String} schemaName The name of the schema to validate against
  * @return {Object}
  */
  getSchema(schemaName) {
    if(!schemaName) {
      throw new Error(`Must provide a schema name`);
    }
    const schema = this.schemas[schemaName];
    const schemaExtensions = this.schemaExtensions[schemaName];
    if(schemaExtensions && schemaExtensions.length) {
      schema.allOf = schemaExtensions;
    }
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
