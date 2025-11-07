import _ from 'lodash'
import { AbstractModule, Hook } from 'adapt-authoring-core'
import Ajv from 'ajv/dist/2020.js'
import { glob } from 'glob'
import JsonSchema from './JsonSchema.js'
import Keywords from './Keywords.js'
import path from 'path'
import safeRegex from 'safe-regex'
import XSSDefaults from './XSSDefaults.js'

const BASE_SCHEMA_PATH = './schema/base.schema.json'
/**
 * Module which add support for the JSON Schema specification
 * @memberof jsonschema
 * @extends {AbstractModule}
 */
class JsonSchemaModule extends AbstractModule {
  /** @override */
  async init () {
    this.app.jsonschema = this
    /**
     * Reference to all registed schemas
     * @type {Object}
     */
    this.schemas = {}
    /**
     * Temporary store of extension schemas
     * @type {Object}
     */
    this.schemaExtensions = {}
    /**
     * Invoked when schemas are registered
     * @type {Hook}
     */
    this.registerSchemasHook = new Hook
    /**
     * Tags and attributes to be whitelisted by the XSS filter
     * @type {Object}
     */
    this.xssWhitelist = {}
    /**
     * Reference to the Ajv instance
     * @type {external:Ajv}
     */
    this.validator = new Ajv({
      addUsedSchema: false,
      allErrors: true,
      allowUnionTypes: true,
      loadSchema: this.getSchema.bind(this),
      removeAdditional: 'all',
      strict: false,
      verbose: true,
      keywords: Keywords.all
    })
    this.addStringFormats({
      'date-time': /[A-za-z0-9:+\(\)]+/,
      time: /^(\d{2}):(\d{2}):(\d{2})\+(\d{2}):(\d{2})$/,
      uri: /^(.+):\/\/(www\.)?[-a-zA-Z0-9@:%_\+.~#?&//=]{1,256}/
    })
    await this.resetSchemaRegistry()

    this.onReady()
      .then(() => this.app.waitForModule('config', 'errors'))
      .then(() => {
        Object.assign(this.xssWhitelist,
          this.getConfig('xssWhitelistOverride') ? {} : XSSDefaults,
          this.getConfig('xssWhitelist'))
      })
      .then(() => this.addStringFormats(this.getConfig('formatOverrides')))
      .then(() => this.registerSchemas({ quiet: true })) // note: supress logging here as other schemas will likely be added
      .catch(e => this.log('error', e))

    this.app.onReady()
      .then(() => this.logSchemas())
  }

  /**
   * Empties the schema registry (with the exception of the base schema)
   */
  async resetSchemaRegistry () {
    this.log('debug', 'RESET_SCHEMAS')
    this.schemas = {
      base: await this.createSchema(path.resolve(this.rootDir, BASE_SCHEMA_PATH), { enableCache: true })
    }
  }

  /**
   * Adds string formats to the Ajv validator
   */
  addStringFormats (formats) {
    Object.entries(formats).forEach(([name, re]) => {
      const isUnsafe = !safeRegex(re)
      if (isUnsafe) this.log('warn', `unsafe RegExp for format '${name}' (${re}), using default`)
      this.validator.addFormat(name, isUnsafe ? /.*/ : re)
    })
  }

  /**
   * Adds a new keyword to be used in JSON schemas
   * @param {AjvKeyword} definition
   */
  addKeyword (definition) {
    try {
      this.validator.addKeyword(definition)
    } catch (e) {
      this.log('warn', `failed to define keyword '${definition.keyword}', ${e}`)
    }
  }

  /**
   * Searches all Adapt dependencies for any local JSON schemas and registers them for use in the app. Schemas must be located in in a `/schema` folder, and be named appropriately: `*.schema.json`.
   * @param options {object}
   * @param options.quiet {Boolean} Set to true to suppress logs
   * @return {Promise}
   */
  async registerSchemas (options = {}) {
    await this.resetSchemaRegistry()
    await Promise.all(Object.values(this.app.dependencies).map(async d => {
      if(d.name === this.name) return
      const files = await glob('schema/*.schema.json', { cwd: d.rootDir, absolute: true })
      ;(await Promise.allSettled(files.map(f => this.registerSchema(f))))
        .filter(r => r.status === 'rejected')
        .forEach(r => this.log('warn', r.reason))
    }))
    await this.registerSchemasHook.invoke()
    if(options.quiet !== true) this.logSchemas()
  }

  /**
   * Registers a single JSON schema for use in the app
   * @param {String} filePath Path to the schema file
   * @param {RegisterSchemaOptions} options Extra options
   * @return {Promise}
   */
  async registerSchema (filePath, options = {}) {
    if (!_.isString(filePath)) {
      throw this.app.errors.INVALID_PARAMS.setData({ params: ['filePath'] })
    }
    const schema = await this.createSchema(filePath, options)

    if (this.schemas[schema.name]) {
      if (options.replace) this.deregisterSchema(schema.name)
      else throw this.app.errors.SCHEMA_EXISTS.setData({ schemaName: schema.name, filePath })
    }
    this.schemas[schema.name] = schema
    this.schemaExtensions?.[schema.name]?.forEach(s => schema.addExtension(s))
    if (schema.raw.$patch) this.extendSchema(schema.raw.$patch?.source?.$ref, schema.name)

    this.log('verbose', 'REGISTER_SCHEMA', schema.name, filePath)
  }

  /**
   * deregisters a single JSON schema
   * @param {String} name Schem name to deregister
   * @return {Promise} Resolves with schema data
   */
  deregisterSchema (name) {
    if (this.schemas[name]) delete this.schemas[name]
    // remove schema from any extensions lists
    Object.entries(this.schemaExtensions).forEach(([base, extensions]) => {
      this.schemaExtensions[base] = extensions.filter(s => s !== name)
    })
    this.log('debug', 'DEREGISTER_SCHEMA', name)
  }

  /**
   * Creates a new JsonSchema instance
   * @param {String} filePath Path to the schema file
   * @param {Object} options Options passed to JsonSchema constructor
   * @returns {JsonSchema}
   */
  createSchema (filePath, options) {
    const schema = new JsonSchema({
      enableCache: this.getConfig('enableCache'),
      filePath,
      validator: this.validator,
      xssWhitelist: this.xssWhitelist,
      ...options
    })
    this.schemaExtensions?.[schema.name]?.forEach(s => schema.addExtension(s))
    delete this.schemaExtensions?.[schema.name]
    return schema.load()
  }

  /**
   * Extends an existing schema with extra properties
   * @param {String} baseSchemaName The name of the schema to extend
   * @param {String} extSchemaName The name of the schema to extend with
   */
  extendSchema (baseSchemaName, extSchemaName) {
    const baseSchema = this.schemas[baseSchemaName]
    if (baseSchema) {
      baseSchema.addExtension(extSchemaName)
    } else {
      if (!this.schemaExtensions[baseSchemaName]) this.schemaExtensions[baseSchemaName] = []
      this.schemaExtensions[baseSchemaName].push(extSchemaName)
    }
    this.log('verbose', 'EXTEND_SCHEMA', baseSchemaName, extSchemaName)
  }

  /**
   * Retrieves the specified schema. Recursively applies any schema merge/patch schemas. Will returned cached data if enabled.
   * @param {String} schemaName The name of the schema to return
   * @param {LoadSchemaOptions} options
   * @param {Boolean} options.compiled If false, the raw schema will be returned
   * @return {Promise} The compiled schema validation function (default) or the raw schema
   */
  async getSchema (schemaName, options = {}) {
    const schema = this.schemas[schemaName]
    if (!schema) throw this.app.errors.MISSING_SCHEMA.setData({ schemaName })
    return schema.build(options)
  }

  /**
   * Logs all registered schemas & schema extensions
   */
  logSchemas () {
    this.log('debug', 'SCHEMAS', Object.keys(this.schemas))
    this.log('debug', 'SCHEMA_EXTENSIONS', Object.entries(this.schemas).reduce((m, [k, v]) => {
      if(v.extensions.length) m[k] = v.extensions
      return m
    }, {}))
  }
}

export default JsonSchemaModule
