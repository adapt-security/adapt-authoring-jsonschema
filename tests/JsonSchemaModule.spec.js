import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import JsonSchemaModule from '../lib/JsonSchemaModule.js'

/**
 * JsonSchemaModule extends AbstractModule and requires App.instance + adapt-schemas.
 * We test the thin wrapper methods and logSchemas logic.
 */

function createInstance () {
  const mockSchemas = {
    schemas: {},
    schemaExtensions: {},
    xssWhitelist: {},
    validator: {},
    options: { enableCache: true },
    on: mock.fn(),
    init: mock.fn(async () => {}),
    addKeyword: mock.fn(),
    addStringFormats: mock.fn(),
    registerSchema: mock.fn(async () => ({ name: 'test' })),
    deregisterSchema: mock.fn(),
    extendSchema: mock.fn(),
    getSchema: mock.fn(async () => ({ name: 'test' })),
    resetSchemaRegistry: mock.fn(async () => {}),
    createSchema: mock.fn(async () => ({ name: 'test' }))
  }

  const mockApp = {
    waitForModule: mock.fn(async () => {}),
    errors: {
      MISSING_SCHEMA: { setData: mock.fn(function () { return this }) }
    },
    jsonschema: null,
    dependencies: {},
    dependencyloader: {
      moduleLoadedHook: { tap: () => {}, untap: () => {} }
    },
    onReady: mock.fn(async () => {})
  }

  const originalInit = JsonSchemaModule.prototype.init
  JsonSchemaModule.prototype.init = async function () {}

  const instance = new JsonSchemaModule(mockApp, { name: 'adapt-authoring-jsonschema' })

  JsonSchemaModule.prototype.init = originalInit

  instance._library = mockSchemas

  return { instance, mockApp, mockSchemas }
}

describe('JsonSchemaModule', () => {
  describe('#schemas', () => {
    it('should return the library schemas', () => {
      const { instance, mockSchemas } = createInstance()
      mockSchemas.schemas = { test: { name: 'test' } }
      assert.deepEqual(instance.schemas, { test: { name: 'test' } })
    })
  })

  describe('#schemaExtensions', () => {
    it('should return the library schemaExtensions', () => {
      const { instance, mockSchemas } = createInstance()
      mockSchemas.schemaExtensions = { ext: {} }
      assert.deepEqual(instance.schemaExtensions, { ext: {} })
    })
  })

  describe('#xssWhitelist', () => {
    it('should return the library xssWhitelist', () => {
      const { instance, mockSchemas } = createInstance()
      mockSchemas.xssWhitelist = { a: ['href'] }
      assert.deepEqual(instance.xssWhitelist, { a: ['href'] })
    })
  })

  describe('#validator', () => {
    it('should return the library validator', () => {
      const { instance, mockSchemas } = createInstance()
      mockSchemas.validator = { validate: () => {} }
      assert.equal(instance.validator, mockSchemas.validator)
    })
  })

  describe('#resetSchemaRegistry()', () => {
    it('should call the library resetSchemaRegistry', async () => {
      const { instance, mockSchemas } = createInstance()
      await instance.resetSchemaRegistry()
      assert.equal(mockSchemas.resetSchemaRegistry.mock.calls.length, 1)
    })
  })

  describe('#addStringFormats()', () => {
    it('should call the library addStringFormats', () => {
      const { instance, mockSchemas } = createInstance()
      instance.addStringFormats({ email: /.*/ })
      assert.equal(mockSchemas.addStringFormats.mock.calls.length, 1)
    })
  })

  describe('#addKeyword()', () => {
    it('should call the library addKeyword', () => {
      const { instance, mockSchemas } = createInstance()
      instance.addKeyword({ keyword: 'test' })
      assert.equal(mockSchemas.addKeyword.mock.calls.length, 1)
    })
  })

  describe('#deregisterSchema()', () => {
    it('should call the library deregisterSchema', () => {
      const { instance, mockSchemas } = createInstance()
      instance.deregisterSchema('test')
      assert.equal(mockSchemas.deregisterSchema.mock.calls.length, 1)
      assert.equal(mockSchemas.deregisterSchema.mock.calls[0].arguments[0], 'test')
    })
  })

  describe('#extendSchema()', () => {
    it('should call the library extendSchema with correct args', () => {
      const { instance, mockSchemas } = createInstance()
      instance.extendSchema('base', 'ext')
      assert.equal(mockSchemas.extendSchema.mock.calls.length, 1)
      assert.equal(mockSchemas.extendSchema.mock.calls[0].arguments[0], 'base')
      assert.equal(mockSchemas.extendSchema.mock.calls[0].arguments[1], 'ext')
    })
  })

  describe('#logSchemas()', () => {
    it('should call log with schema names', () => {
      const { instance, mockSchemas } = createInstance()
      mockSchemas.schemas = {
        schema1: { extensions: ['ext1'] },
        schema2: { extensions: [] }
      }
      instance.log = mock.fn()
      instance.logSchemas()
      assert.equal(instance.log.mock.calls.length, 2)
      assert.equal(instance.log.mock.calls[0].arguments[0], 'debug')
    })
  })
})
