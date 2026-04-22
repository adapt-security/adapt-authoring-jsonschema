import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { mergeXssWhitelist } from '../lib/utils/mergeXssWhitelist.js'

describe('mergeXssWhitelist()', () => {
  const defaults = { a: ['href'], b: [], div: ['class'] }

  describe('override: false', () => {
    it('returns defaults when additions are empty', () => {
      assert.deepEqual(
        mergeXssWhitelist({ defaults, override: false, additions: {} }),
        defaults
      )
    })

    it('merges additions on top of defaults', () => {
      const result = mergeXssWhitelist({
        defaults,
        override: false,
        additions: { span: ['class'] }
      })
      assert.deepEqual(result, {
        a: ['href'],
        b: [],
        div: ['class'],
        span: ['class']
      })
    })

    it('replaces a default tag\'s attr list entirely (per-tag replacement, not merge)', () => {
      const result = mergeXssWhitelist({
        defaults,
        override: false,
        additions: { a: ['class'] }
      })
      assert.deepEqual(result.a, ['class'])
    })
  })

  describe('override: true', () => {
    it('discards defaults entirely, keeping only additions', () => {
      const result = mergeXssWhitelist({
        defaults,
        override: true,
        additions: { span: ['class'] }
      })
      assert.deepEqual(result, { span: ['class'] })
      assert.equal(result.a, undefined)
      assert.equal(result.b, undefined)
      assert.equal(result.div, undefined)
    })

    it('returns an empty whitelist when additions are empty', () => {
      assert.deepEqual(
        mergeXssWhitelist({ defaults, override: true, additions: {} }),
        {}
      )
    })
  })

  describe('immutability', () => {
    it('does not mutate defaults', () => {
      const d = { a: ['href'] }
      const snapshot = JSON.stringify(d)
      mergeXssWhitelist({ defaults: d, override: false, additions: { span: ['class'] } })
      assert.equal(JSON.stringify(d), snapshot)
    })

    it('does not mutate additions', () => {
      const a = { span: ['class'] }
      const snapshot = JSON.stringify(a)
      mergeXssWhitelist({ defaults, override: false, additions: a })
      assert.equal(JSON.stringify(a), snapshot)
    })
  })

  describe('missing arguments', () => {
    it('treats missing additions as empty', () => {
      assert.deepEqual(
        mergeXssWhitelist({ defaults, override: false }),
        defaults
      )
    })

    it('treats missing defaults as empty when override is false', () => {
      assert.deepEqual(
        mergeXssWhitelist({ override: false, additions: { a: ['href'] } }),
        { a: ['href'] }
      )
    })

    it('treats missing defaults as empty when override is true', () => {
      assert.deepEqual(
        mergeXssWhitelist({ override: true, additions: { a: ['href'] } }),
        { a: ['href'] }
      )
    })

    it('returns an empty object when called with no arguments', () => {
      assert.deepEqual(mergeXssWhitelist(), {})
    })
  })
})
