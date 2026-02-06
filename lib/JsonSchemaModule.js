import { AbstractModule, App, Hook } from 'adapt-authoring-core'
import { glob } from 'glob'
import path from 'path'
import { Schemas, SchemaError, XSSDefaults } from 'adapt-schemas'

/**
 * Module which adds support for the JSON Schema specification.
 * This is a thin wrapper around the adapt-schemas library providing
 * Adapt framework integration (hooks, logging, config, errors).
 * @memberof jsonschema
 * @extends {AbstractModule}
 */
class JsonSchemaModule extends AbstractModule {
  /** @override */
  async init () {
    this.app.jsonschema = this
    /**
     * Invoked when schemas are registered
     * @type {Hook}
     */
    this.registerSchemasHook = new Hook()
    /**
     * Internal schema library instance
     * @type {Schemas}
     */
    this._library = new Schemas({
      enableCache: true // Will be overridden from config when ready
    })
    // Forward library events to module logging
    this._library.on('warning', msg => this.log('warn', msg))
    this._library.on('schemaRegistered', (name, filePath) => this.log('verbose', 'REGISTER_SCHEMA', name, filePath))
    this._library.on('schemaDeregistered', name => this.log('debug', 'DEREGISTER_SCHEMA', name))
    this._library.on('schemaExtended', (base, ext) => this.log('verbose', 'EXTEND_SCHEMA', base, ext))
    this._library.on('reset', () => this.log('debug', 'RESET_SCHEMAS'))

    await this._library.init()

    try {
      this._library.addKeyword({
        keyword: 'isDirectory',
        type: 'string',
        modifying: true,
        schemaType: 'boolean',
        compile: function () {
          const doReplace = value => {
            const app = App.instance
            return [
              ['$ROOT', app.rootDir],
              ['$DATA', app.getConfig('dataDir')],
              ['$TEMP', app.getConfig('tempDir')]
            ].reduce((m, [k, v]) => {
              return m.startsWith(k) ? path.resolve(v, m.replace(k, '').slice(1)) : m
            }, value)
          }
          return (value, { parentData, parentDataProperty }) => {
            try {
              parentData[parentDataProperty] = doReplace(value)
            } catch (e) {}
            return true
          }
        }
      })
    } catch (e) {
      console.log(e);
    }
    this.onReady()
      .then(() => this.app.waitForModule('config', 'errors'))
      .then(() => {
        // Update library options from config
        this._library.options.enableCache = this.getConfig('enableCache')

        // Update XSS whitelist
        Object.assign(
          this._library.xssWhitelist,
          this.getConfig('xssWhitelistOverride') ? {} : XSSDefaults,
          this.getConfig('xssWhitelist')
        )
      })
      .then(() => {
        // Add format overrides from config
        const formatOverrides = this.getConfig('formatOverrides')
        if (formatOverrides) {
          this._library.addStringFormats(formatOverrides)
        }
      })
      .then(() => this.registerSchemas({ quiet: true }))
      .catch(e => this.log('error', e))

    this.app.onReady()
      .then(() => this.logSchemas())
  }

  /**
   * Reference to all registered schemas
   * @type {Object}
   */
  get schemas () {
    return this._library.schemas
  }

  /**
   * Temporary store of extension schemas
   * @type {Object}
   */
  get schemaExtensions () {
    return this._library.schemaExtensions
  }

  /**
   * Tags and attributes to be whitelisted by the XSS filter
   * @type {Object}
   */
  get xssWhitelist () {
    return this._library.xssWhitelist
  }

  /**
   * Reference to the Ajv instance
   * @type {external:Ajv}
   */
  get validator () {
    return this._library.validator
  }

  /**
   * Empties the schema registry (with the exception of the base schema)
   */
  async resetSchemaRegistry () {
    await this._library.resetSchemaRegistry()
  }

  /**
   * Adds string formats to the Ajv validator
   * @param {Object} formats Object mapping format names to RegExp patterns
   */
  addStringFormats (formats) {
    this._library.addStringFormats(formats)
  }

  /**
   * Adds a new keyword to be used in JSON schemas
   * @param {Object} definition AJV keyword definition
   * @param {Object} options Configuration options
   * @param {Boolean} options.override Whether to override an existing definition
   */
  addKeyword (definition, options) {
    this._library.addKeyword(definition, options)
  }

  /**
   * Searches all Adapt dependencies for any local JSON schemas and registers them for use in the app.
   * Schemas must be located in a `/schema` folder, and be named appropriately: `*.schema.json`.
   * @param {Object} options
   * @param {Boolean} options.quiet Set to true to suppress logs
   * @return {Promise}
   */
  async registerSchemas (options = {}) {
    await this.resetSchemaRegistry()
    await Promise.all(Object.values(this.app.dependencies).map(async d => {
      if (d.name === this.name) return
      const files = await glob('schema/*.schema.json', { cwd: d.rootDir, absolute: true })
      const results = await Promise.allSettled(files.map(f => this.registerSchema(f)))
      results
        .filter(r => r.status === 'rejected')
        .forEach(r => this.log('warn', r.reason))
    }))
    await this.registerSchemasHook.invoke()
    if (options.quiet !== true) this.logSchemas()
  }

  /**
   * Registers a single JSON schema for use in the app
   * @param {String} filePath Path to the schema file
   * @param {Object} options Extra options
   * @param {Boolean} options.replace Replace existing schema with same name
   * @return {Promise<Schema>}
   */
  async registerSchema (filePath, options = {}) {
    try {
      return await this._library.registerSchema(filePath, options)
    } catch (e) {
      // Convert library errors to app errors
      if (e instanceof SchemaError) {
        const appError = this.app.errors[e.code]
        if (appError) {
          throw appError.setData(e.data)
        }
      }
      throw e
    }
  }

  /**
   * Deregisters a single JSON schema
   * @param {String} name Schema name to deregister
   */
  deregisterSchema (name) {
    this._library.deregisterSchema(name)
  }

  /**
   * Creates a new Schema instance
   * @param {String} filePath Path to the schema file
   * @param {Object} options Options passed to Schema constructor
   * @returns {Promise<Schema>}
   */
  createSchema (filePath, options = {}) {
    return this._library.createSchema(filePath, {
      enableCache: this.getConfig('enableCache'),
      ...options
    })
  }

  /**
   * Extends an existing schema with extra properties
   * @param {String} baseSchemaName The name of the schema to extend
   * @param {String} extSchemaName The name of the schema to extend with
   */
  extendSchema (baseSchemaName, extSchemaName) {
    this._library.extendSchema(baseSchemaName, extSchemaName)
  }

  /**
   * Retrieves the specified schema. Recursively applies any schema merge/patch schemas.
   * Will return cached data if enabled.
   * @param {String} schemaName The name of the schema to return
   * @param {Object} options
   * @param {Boolean} options.compiled If false, the raw schema will be returned
   * @return {Promise<Schema>} The schema instance
   */
  async getSchema (schemaName, options = {}) {
    try {
      return await this._library.getSchema(schemaName, options)
    } catch (e) {
      if (e instanceof SchemaError && e.code === 'MISSING_SCHEMA') {
        throw this.app.errors.MISSING_SCHEMA.setData({ schemaName })
      }
      throw e
    }
  }

  /**
   * Logs all registered schemas & schema extensions
   */
  logSchemas () {
    this.log('debug', 'SCHEMAS', Object.keys(this.schemas))
    this.log('debug', 'SCHEMA_EXTENSIONS', Object.entries(this.schemas).reduce((m, [k, v]) => {
      if (v.extensions.length) m[k] = v.extensions
      return m
    }, {}))
  }
}

export default JsonSchemaModule
