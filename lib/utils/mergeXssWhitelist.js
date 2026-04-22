/**
 * Computes the XSS whitelist to apply to the adapt-schemas library.
 * When override is true, defaults are discarded and only additions are used.
 * Otherwise additions are merged on top of defaults (an entry in additions
 * replaces the same-named entry in defaults — attr lists are not merged).
 * @param {Object} params
 * @param {Object} [params.defaults] Default tag/attr whitelist
 * @param {Boolean} [params.override] Replace defaults entirely
 * @param {Object} [params.additions] User-supplied whitelist
 * @returns {Object} The merged whitelist
 */
export function mergeXssWhitelist ({ defaults = {}, override = false, additions = {} } = {}) {
  return override
    ? { ...additions }
    : { ...defaults, ...additions }
}
