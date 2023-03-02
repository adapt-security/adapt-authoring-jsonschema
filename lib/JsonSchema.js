import _ from 'lodash';
import { App } from 'adapt-authoring-core';
import fs from 'fs/promises';

/** @ignore */ const BASE_SCHEMA_NAME = 'base';

class JsonSchema {
  constructor(schemaPath, validator) {
    this.schemaPath = schemaPath;
    this.validator = validator;
    this.extensions = [];
  }
  /**
   * 
   * @param {*} options 
   * @returns 
   */
  async load(options = {}) {
    const jsonschema = await app.waitForModule('jsonschema');
    const { applyExtensions, extensionFilter } = options;
    try {
      this.raw = JSON.parse((await fs.readFile(this.schemaPath)).toString());
      this.name = json.$anchor;
    } catch(e) {
      throw App.instance.errors.SCHEMA_LOAD_FAILED.setData({ schemaName: this.schemaPath });
    }
    const mergeRef = this.raw?.$merge?.source?.$ref;

    if(mergeRef) { // merge parent schema
      const parentSchema = (await jsonschema.getSchema(mergeRef, options)).raw;
      this.patch(parentSchema);
    } else if(schema?.$anchor !== BASE_SCHEMA_NAME) { // extend all schemas from the base schema
      baseSchema = (await jsonschema.getSchema(BASE_SCHEMA_NAME)).raw;
      this.patch(baseSchema, { strict: false, extendAnnotations: false });
    }
    if(this.extensions.length) {
      await Promise.all(this.extensions.map(async s => {
        const applyPatch = typeof extensionFilter === 'function' ? extensionFilter(s) : applyExtensions !== false;
        if(applyPatch) {
          const extSchema = await jsonschema.getSchema(s, { useCache: options.useCache });
          this.patch(extSchema, { extendAnnotations: false });
        }
      }));
    }
    if(this.validator.validateSchema(schema)?.errors) {
      const errors = this.validator.errors.map(e => e.instancePath ? `${e.instancePath} ${e.message}` : e.message);
      if(errors.length) {
        throw App.instance.errors.INVALID_SCHEMA
          .setData({ schemaName: this.name, errors: errors.join(', ') });
      }
    }
    this.compiled = await this.validator.compileAsync(this.raw);

    return this;
  }
  /**
   * Applies a patch schema to another schema
   * @param {Object} patchSchema The patch schema to apply to the base
   * @param {ApplyPatchOptions} options
   * @return {Promise} Resolves with the schema
   */
  async patch(patchSchema, options = {}) {
    const opts = _.defaults(options, { extendAnnotations: true, overwriteProperties: false, strict: true });
    const patchData = patchSchema?.$patch?.with || patchSchema?.$merge?.with || !opts.strict && patchSchema;
    if(!patchData) {
      this.log('warn', `cannot apply '${patchSchema.$anchor}' patch schema to ${this.name}, invalid schema format`);
      return this.raw;
    }
    if(opts.extendAnnotations) {
      ['$anchor', 'title', 'description'].forEach(p => {
        if(patchSchema[p]) this.raw[p] = patchSchema[p];
      });
    }
    if(patchData.properties) {
      const mergeFunc = opts.overwriteProperties ? _.merge : _.defaultsDeep;
      mergeFunc(this.raw.properties, patchData.properties);
    }
    ['allOf','anyOf','oneOf'].forEach(p => {
      if(patchData[p]?.length) this.raw[p] = (this.raw[p] ?? []).concat(_.cloneDeep(patchData[p]));
    });
    if(patchData.required) {
      this.raw.required = _.uniq([...(this.raw.required ?? []), ...patchData.required]);
    }
    return this.raw;
  }
  /**
   * Checks passed data against the specified schema (if it exists)
   * @param {Object} dataToValidate The data to be validated
   * @param {ValidateOptions} options
   * @return {Promise} Resolves with the validated data
   */
  async validate(data, options) {
    const opts = _.defaults(options, { useDefaults: true, ignoreRequired: false });

    const data = _.defaultsDeep(_.cloneDeep(dataToValidate), 
      opts.useDefaults ? this.getObjectDefaults(validateFunc.schema) : {});
    
    this.compiled(data);

    const isLocalUser = this.name === "localauthuser";
    if(isLocalUser) console.log('BEFORE ----->', data);
    
    const errors = validateFunc.errors && validateFunc.errors
      .filter(e => !opts.ignoreRequired || e.message.includes('required'))
      .map(e => e.instancePath ? `${e.instancePath} ${e.message}` : e.message)
      .reduce((s, e) => s+= `${e}, `, '');
    
    if(errors?.length) 
      throw App.instance.errors.VALIDATION_FAILED.setData({ schemaName: this.name, errors, data })
    
    if(isLocalUser) console.log('AFTER ----->', data);
    return data;
  }
  /**
   * Sanitises data by removing attributes according to the context (provided by options)
   * @param {Object} dataToValidate The data to be sanitised
   * @param {SanitiseOptions} options
   * @return {Promise} Resolves with the sanitised data
   */
  async sanitise(dataToSanitise, options = {}) {
    const opts = _.defaults(options, { isInternal: false, isReadOnly: false, sanitiseHtml: true, strict: true });
    
    return _.mapValues((this.raw).properties, (config, prop) => {
      const value = dataToSanitise[prop];
      const ignore = (opts.isInternal && config.isInternal) || (opts.isReadOnly && config.isReadOnly);
      if(value === undefined) {
        return;
      }
      if(ignore && opts.strict) {
        throw App.instance.errors.MODIFY_PROTECTED_ATTR.setData({ attribute: prop, value: value });
      }
      return config.type === 'object' && config.properties ? this.sanitise(config, value, opts) : 
        config.type === 'string' && opts.sanitiseHtml ? xss(value, this.getConfig('xssWhitelist')) :
        value;
    });
  }
  addExtension(extSchemaName) {
    if(!this.extensions.includes(extSchemaName)) {
      this.extensions.push(extSchemaName);
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
}

export default JsonSchema;