const { AbstractModule } = require('adapt-authoring-core');
const Ajv = require('ajv');
/**
* Module which add support for the JSON Schema specification
* @extends {AbstractModule}
*/
/**
serveSchema
addSchema
getSchema
extendSchema
validate(schema, data)
*/
class JsonSchemaModule extends AbstractModule {
  /** @override */
  constructor(app, pkg) {
    console.log('JsonSchemaModule#constructor');
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
    resolve();
  }
  /** @override */
  boot(app, resolve, reject) {
    resolve();
  }
  /**
  *
  * @param {String} schemaName The name of the schema to validate against
  * @param {String} schemaData The
  */
  addSchema(schemaName, schemaData) {
  }
  /**
  *
  * @param {String} schemaName The name of the schema to validate against
  */
  getSchema(schemaName) {
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
}

module.exports = JsonSchemaModule;
