import _ from 'lodash'
import { App, Hook } from 'adapt-authoring-core'
import fs from 'fs/promises'
import xss from 'xss'

/** @ignore */ const BASE_SCHEMA_NAME = 'base'

/**
 * Functionality related to JSON schema
 * @memberof jsonschema
 */
class JsonSchema {
  constructor ({ enableCache, filePath, validator, xssWhitelist }) {
    /**
     * The raw built JSON schema
     * @type {Object}
     */
    this.built = undefined
    /**
     * The compiled schema validation function
     * @type {function}
     */
    this.compiled = undefined
    /**
     * Whether caching is enabled for this schema
     * @type {Boolean}
     */
    this.enableCache = enableCache
    /**
     * List of extensions for this schema
     * @type {Array<String>}
     */
    this.extensions = []
    /**
     * File path to the schema
     * @type {String}
     */
    this.filePath = filePath
    /**
     * Whether the schema is currently building
     * @type {Boolean}
     */
    this.isBuilding = false
    /**
     * The last build time (in milliseconds)
     * @type {Number}
     */
    this.lastBuildTime = undefined
    /**
     * The raw schema data for this schema (with no inheritance/extensions)
     * @type {Object}
     */
    this.raw = undefined
    /**
     * Reference to the Ajv validator instance
     * @type {external:Ajv}
     */
    this.validator = validator
    /**
     * Reference to the local XSS sanitiser instance
     * @type {Object}
     */
    this.xss = new xss.FilterXSS({ whiteList: xssWhitelist })
    /**
     * Hook which invokes every time the schema is built
     * @type {Hook}
     */
    this.buildHook = new Hook()
  }

  /**
   * Determines whether the current schema build is valid using last modification timestamp
   * @returns {Boolean}
   */
  async isBuildValid () {
    if (!this.built) return false
    let schema = this
    while (schema) {
      const { mtimeMs } = await fs.stat(schema.filePath)
      if (mtimeMs > this.lastBuildTime) return false
      schema = await schema.getParent()
    }
    return true
  }

  /**
   * Returs the parent schema if $merge is defined (or the base schema if a root schema)
   * @returns {JsonSchema}
   */
  async getParent () {
    if (this.name === BASE_SCHEMA_NAME) return // base schema always the root
    const jsonschema = await App.instance.waitForModule('jsonschema')
    return await jsonschema.getSchema(this.raw?.$merge?.source?.$ref ?? BASE_SCHEMA_NAME)
  }

  /**
   * Loads the schema file
   * @returns {JsonSchema} This instance
   */
  async load () {
    try {
      this.raw = JSON.parse((await fs.readFile(this.filePath)).toString())
      this.name = this.raw.$anchor
    } catch (e) {
      throw App.instance.errors?.SCHEMA_LOAD_FAILED?.setData({ schemaName: this.filePath }) ?? e
    }
    if (this.validator.validateSchema(this.raw)?.errors) {
      const errors = this.validator.errors.map(e => e.instancePath ? `${e.instancePath} ${e.message}` : e.message)
      if (errors.length) {
        throw App.instance.errors.INVALID_SCHEMA
          .setData({ schemaName: this.name, errors: errors.join(', ') })
      }
    }
    return this
  }

  /**
   * Builds and compiles the schema from the $merge and $patch schemas
   * @param {LoadSchemaOptions}
   * @return {JsonSchema}
   */
  async build (options = {}) {
    if (options.useCache !== false && this.enableCache && await this.isBuildValid()) {
      return this
    }
    if (this.isBuilding) {
      return new Promise(resolve => this.buildHook.tap(() => resolve(this)))
    }
    this.isBuilding = true

    const jsonschema = await App.instance.waitForModule('jsonschema')
    const { applyExtensions, extensionFilter } = options

    let built = _.cloneDeep(this.raw)
    let parent = await this.getParent()

    while (parent) {
      const parentBuilt = _.cloneDeep((await parent.build({ ...options, compile: false })).built)
      built = await this.patch(parentBuilt, built, { strict: !parent.name === BASE_SCHEMA_NAME })
      parent = await parent.getParent()
    }
    if (this.extensions.length) {
      await Promise.all(this.extensions.map(async s => {
        const applyPatch = typeof extensionFilter === 'function' ? extensionFilter(s) : applyExtensions !== false
        if (applyPatch) {
          const extSchema = await jsonschema.getSchema(s)
          this.patch(built, extSchema.raw, { extendAnnotations: false })
        }
      }))
    }
    this.built = built
    if (options.compile !== false) { // don't compile when option present (e.g. when running build recursively)
      this.compiled = await this.validator.compileAsync(built)
    }
    this.isBuilding = false
    this.lastBuildTime = Date.now()

    this.buildHook.invoke(this)
    return this
  }

  /**
   * Applies a patch schema to another schema
   * @param {Object} baseSchema The base schema to apply the patch
   * @param {Object} patchSchema The patch schema to apply to the base
   * @param {ApplyPatchOptions} options
   * @return {Object} The base schema
   */
  patch (baseSchema, patchSchema, options = {}) {
    const opts = _.defaults(options, {
      extendAnnotations: patchSchema.$anchor !== BASE_SCHEMA_NAME,
      overwriteProperties: true,
      strict: true
    })
    const patchData = patchSchema.$patch?.with ?? patchSchema.$merge?.with ?? (!opts.strict && patchSchema)
    if (!patchData) {
      throw App.instance.errors.INVALID_SCHEMA.setData({ schemaName: patchSchema.$anchor })
    }
    if (opts.extendAnnotations) {
      ['$anchor', 'title', 'description'].forEach(p => {
        if (patchSchema[p]) baseSchema[p] = patchSchema[p]
      })
    }
    if (patchData.properties) {
      const mergeFunc = opts.overwriteProperties ? _.merge : _.defaultsDeep
      mergeFunc(baseSchema.properties, patchData.properties)
    }
    ['allOf', 'anyOf', 'oneOf'].forEach(p => {
      if (patchData[p]?.length) baseSchema[p] = (baseSchema[p] ?? []).concat(_.cloneDeep(patchData[p]))
    })
    if (patchData.required) {
      baseSchema.required = _.uniq([...(baseSchema.required ?? []), ...patchData.required])
    }
    return baseSchema
  }

  /**
   * Checks passed data against the specified schema (if it exists)
   * @param {Object} dataToValidate The data to be validated
   * @param {SchemaValidateOptions} options
   * @return {Object} The validated data
   */
  validate (dataToValidate, options) {
    const opts = _.defaults(options, { useDefaults: true, ignoreRequired: false })
    const data = _.defaults(_.cloneDeep(dataToValidate), opts.useDefaults ? this.getObjectDefaults() : {})
    if (!this.compiled) { // fallback in the case that the compiled function is missing
      this.log('warn', 'NO_COMPILED_FUNC', this.name)
      this.validator.compile(this.built)
    }
    this.compiled(data)

    const errors = this.compiled.errors && this.compiled.errors
      .filter(e => e.keyword === 'required' ? !opts.ignoreRequired : true)
      .map(e => e.instancePath ? `${e.instancePath} ${e.message}` : e.message)
      .reduce((s, e) => `${s}${e}, `, '')

    if (errors?.length) { throw App.instance.errors.VALIDATION_FAILED.setData({ schemaName: this.name, errors, data }) }

    return data
  }

  /**
   * Sanitises data by removing attributes according to the context (provided by options)
   * @param {Object} dataToValidate The data to be sanitised
   * @param {SchemaSanitiseOptions} options
   * @return {Object} The sanitised data
   */
  sanitise (dataToSanitise, options = {}, schema) {
    const opts = _.defaults(options, { isInternal: false, isReadOnly: false, sanitiseHtml: true, strict: true })
    schema = schema ?? this.built
    const sanitised = {}
    for (const prop in schema.properties) {
      const schemaData = schema.properties[prop]
      const value = dataToSanitise[prop]
      const ignore = (opts.isInternal && schemaData.isInternal) || (opts.isReadOnly && schemaData.isReadOnly)
      if (value === undefined || (ignore && !opts.strict)) {
        continue
      }
      if (ignore && opts.strict) {
        throw App.instance.errors.MODIFY_PROTECTED_ATTR.setData({ attribute: prop, value })
      }
      sanitised[prop] =
        schemaData.type === 'object' && schemaData.properties
          ? this.sanitise(value, opts, schemaData)
          : schemaData.type === 'string' && opts.sanitiseHtml
            ? this.xss.process(value)
            : value
    }
    return sanitised
  }

  /**
   * Adds an extension schema
   * @param {String} extSchemaName
   */
  addExtension (extSchemaName) {
    !this.extensions.includes(extSchemaName) && this.extensions.push(extSchemaName)
  }

  /**
   * Returns all schema defaults as a correctly structured object
   * @param {Object} schema
   * @param {Object} memo For recursion
   * @returns {Object} The defaults object
   */
  getObjectDefaults (schema) {
    schema = schema ?? this.built
    const props = schema.properties ?? schema.$merge?.with?.properties ?? schema.$patch?.with?.properties
    return _.mapValues(props, s => s.type === 'object' && s.properties ? this.getObjectDefaults(s) : s.default)
  }
}

export default JsonSchema
