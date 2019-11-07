const { AbstractModule, DataValidationError } = require('adapt-authoring-core');
const Ajv = require('ajv');
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
    this.validator = new Ajv({
      allErrors: true,
      useDefaults: true,
      coerceTypes: "array",
      strictDefaults: true,
      strictKeywords: true
    });
  }
  /** @override */
  preload(app, resolve, reject) {
    this.router = app.getModule('server').api.createChildRouter('jsonschemas');
    this.router.addRoute({
      route: '/:name?.schema.json',
      handlers: { get: this.serveSchemas.bind(this) }
    }, {
      route: '/validate',
      handlers: { post: this.validateTest.bind(this) }
    });
    resolve();
  }
  /** @override */
  boot(app, resolve, reject) {
    resolve();
  }
  /**
  * Checks passed data against the specified schema (if it exists)
  * @param {String} schemaName The name of the schema to validate against
  * @param {Object} dataToValidate The data to be validated
  * @throws {DataValidationError}
  */
  validate(schemaName, dataToValidate) {
    const schema = this.getSchema(schemaName);
    const validate = this.validator.compile(schema, dataToValidate);
    if (!validate) {
      throw new DataValidationError('Data validation failed', validate.errors);
    }
  }
  /**
  * Adds a schema for use by the application
  * @param {String} schemaData The schema definition
  */
  addSchema(schemaData) {
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

  validateTest(req, res, next) {
    const validate = this.validator.compile(this.getSchema(req.body.type));
    const data = { ...req.body };
    delete data.type;
    validate(data);
    if(validate.errors) {
      res.status(500).json({ errors: validate.errors.map(e => e.message) });
      return;
    }
    res.json({ data });
  }

  get schemaRoot() {
    return `${this.app.getModule('server').url}${this.router.path}`;
  }
}

module.exports = JsonSchemaModule;
