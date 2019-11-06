const { AbstractModule } = require('adapt-authoring-core');
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
      allErrors: true, // check all rules collecting all errors
      logger: undefined, // sets the logging method
      useDefaults: true,
      coerceTypes: "array",
      strictDefaults: false, // report ignored default keywords in schemas
      strictKeywords: false, // report unknown keywords in schemas
      ownProperties: false // by default Ajv iterates over all enumerable object properties; when this option is true only own enumerable object properties (i.e. found directly on the object rather than on its prototype) are iterated
    });
  }
  /** @override */
  preload(app, resolve, reject) {
    this.router = app.getModule('server').api.createChildRouter('jsonschemas');
    this.router.addRoute({
      route: '/:schemaName?',
      handlers: { get: this.serveSchemas.bind(this) }
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
  */
  validate(schemaName, dataToValidate) {
    this.validator.compile(schema);
    var valid = validate(data);
    if (!valid) console.log(validate.errors);
  }
  /**
  * Adds a schema for use by the application
  * @param {String} schemaData The schema definition
  */
  addSchema(schemaData) {
    /** @todo validate or check for title here */
    if(this.schemas[schemaData.title]) {
      throw new Error(`Cannot add '${schemaData.title}', a schema with that name already exists`);
    }
    /** @todo validate schema here */
    this.schemas[schemaData.title] = schemaData;
  }
  /**
  * Extends an existing schema with extra properties
  * @param {String} schemaTitle The name of the schema to extend (must already exist)
  * @param {String} schemaData The data to extend original schema
  * @param {Object} options Options for configuring the schema extension
  */
  extendSchema(schemaTitle, schemaData, options = { overrideExisting: false }) {
    if(!this.schemas[schemaTitle]) {
      throw new Error(`Cannot extend '${schemaTitle}', it doesn't exist`);
    }
     if(!this.schemaExtensions[schemaTitle]) {
       this.schemaExtensions[schemaTitle] = [];
     }
     /** @todo validate schema here (must also check for overlapping attributes) */
    this.schemaExtensions[schemaTitle].push(schemaData);
  }
  /**
  * Retrieves the specified schema
  * @param {String} schemaTitle The name of the schema to validate against
  * @return {Object}
  */
  getSchema(schemaTitle) {
    if(!schemaTitle) {
      return this.schemas;
    }
    return this.schemaExtensions[schemaTitle].reduce((m,e) => {
      m.properties = { ...m.properties, ...e.properties };
      return m;
    }, this.schemas[schemaTitle]);
  }
  /**
  * Retrieves the specified schema
  * @param {ClientRequest} req Client request object
  * @param {ServerResponse} res Server response object
  * @param {Function} next Callback to continue execution of the stack
  */
  serveSchemas(req, res, next) {
    const name = req.params.schemaName && req.params.schemaName.split('.')[0];
    const s = this.getSchema(name);
    if(!s) {
      return res.status(404).json({ error: `No '${req.params.schemaName}' schema found`});
    }
    res.type('application/schema+json').json(s);
  }

  get schemaRoot() {
    return `${this.app.getModule('server').url}${this.router.path}`;
  }
}

module.exports = JsonSchemaModule;
