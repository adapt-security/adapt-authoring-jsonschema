import _ from 'lodash';
import { App } from 'adapt-authoring-core';
import fs from 'fs/promises';

/** @ignore */ const BASE_SCHEMA_NAME = 'base';

class JsonSchema {
  constructor({ filePath, validator, enableCache, cacheLifespan }) {
    this.built;
    this.cacheLifespan = cacheLifespan;
    this.compiled;
    this.enableCache = enableCache;
    this.extensions = [];
    this.filePath = filePath;
    this.lastBuildTime;
    this.raw;
    this.raw;
    this.validator = validator;
  }
  /**
   * 
   * @param {*} options 
   * @returns 
   */
  async load() {
    try {
      this.raw = JSON.parse((await fs.readFile(this.filePath)).toString());
      this.name = this.raw.$anchor;
    } catch(e) {
      throw App.instance.errors?.SCHEMA_LOAD_FAILED?.setData({ schemaName: this.filePath }) ?? e;
    }
    if(this.validator.validateSchema(this.raw)?.errors) {
      const errors = this.validator.errors.map(e => e.instancePath ? `${e.instancePath} ${e.message}` : e.message);
      if(errors.length) {
        throw App.instance.errors.INVALID_SCHEMA
          .setData({ schemaName: this.name, errors: errors.join(', ') });
      }
    }
    this.compiled = await this.validator.compileAsync(this.raw);

    return this;
  }
  async build(options = {}) {
    this.built = _.cloneDeep(this.raw);
    const { applyExtensions, extensionFilter } = options;
    const jsonschema = await App.instance.waitForModule('jsonschema');
    const mergeRef = this.raw?.$merge?.source?.$ref;
    
    if(mergeRef) { // merge parent schema
      const parentSchema = (await jsonschema.getSchema(mergeRef, options)).raw;
      this.patch(this.built, parentSchema);
    } else if(this.name !== BASE_SCHEMA_NAME) { // extend all schemas from the base schema
      const baseSchema = JSON.parse((await fs.readFile(new URL('../schema/base.schema.json', import.meta.url))).toString());
      this.patch(this.built, baseSchema, { strict: false, extendAnnotations: false });
    }
    if(this.extensions.length) {
      await Promise.all(this.extensions.map(async s => {
        const applyPatch = typeof extensionFilter === 'function' ? extensionFilter(s) : applyExtensions !== false;
        if(applyPatch) {
          const extSchema = await jsonschema.getSchema(s, { useCache: options.useCache });
          this.patch(this.built, extSchema, { extendAnnotations: false });
        }
      }));
    }
    this.lastBuildTime = Date.now();
  }
  /**
   * Applies a patch schema to another schema
   * @param {Object} baseSchema The base schema to apply the patch
   * @param {Object} patchSchema The patch schema to apply to the base
   * @param {ApplyPatchOptions} options
   * @return {Promise} Resolves with the schema
   */
  async patch(baseSchema, patchSchema, options = {}) {
    const opts = _.defaults(options, { extendAnnotations: true, overwriteProperties: false, strict: true });
    const patchData = patchSchema?.$patch?.with || patchSchema?.$merge?.with || !opts.strict && patchSchema;
    if(!patchData) {
      return this.log('warn', `cannot apply '${patchSchema.$anchor}' patch schema to ${this.name}, invalid schema format`);
    }
    if(opts.extendAnnotations) {
      ['$anchor', 'title', 'description'].forEach(p => {
        if(patchSchema[p]) baseSchema[p] = patchSchema[p];
      });
    }
    if(patchData.properties) {
      const mergeFunc = opts.overwriteProperties ? _.merge : _.defaultsDeep;
      mergeFunc(baseSchema.properties, patchData.properties);
    }
    ['allOf','anyOf','oneOf'].forEach(p => {
      if(patchData[p]?.length) baseSchema[p] = (baseSchema[p] ?? []).concat(_.cloneDeep(patchData[p]));
    });
    if(patchData.required) {
      baseSchema.required = _.uniq([...(baseSchema.required ?? []), ...patchData.required]);
    }
  }
  /**
   * Checks passed data against the specified schema (if it exists)
   * @param {Object} dataToValidate The data to be validated
   * @param {ValidateOptions} options
   * @return {Promise} Resolves with the validated data
   */
  async validate(dataToValidate, options) {
    const opts = _.defaults(options, { useDefaults: true, ignoreRequired: false });

    const data = _.defaultsDeep(_.cloneDeep(dataToValidate), 
      opts.useDefaults ? this.getObjectDefaults(this.raw) : {});
    
    this.compiled(data);

    const isLocalUser = this.name === "localauthuser";
    if(isLocalUser) console.log('BEFORE ----->', data);
    
    const errors = this.compiled.errors && this.compiled.errors
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
  /**
   * Adds an extension schema
   * @param {String} extSchemaName 
   */
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