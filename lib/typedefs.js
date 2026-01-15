/**
 * This file exists to define the below types for documentation purposes.
 */
/**
 * Ajv JSON Schema validator
 * @memberof jsonschema
 * @external Ajv
 * @see {@link https://ajv.js.org/api.html#ajv-constructor-and-methods}
 */
/**
 * Ajv custom keyword definition
 * @memberof jsonschema
 * @external AjvKeyword
 * @see {@link https://ajv.js.org/keywords.html}
 */
/**
 * @memberof jsonschema
 * @typedef {Object} ApplyPatchProperties
 * @property {Object} extendAnnotations Whether annotation properties should be overwitten by the patch
 * @property {Object} strict Restricts patches to only merge/patch schemas
 * @property {Object} overwriteProperties Whether existing properties should be overwritten by the patch schema
*/
/**
* @memberof jsonschema
* @typedef {Object} LoadSchemaOptions
* @property {Boolean} applyExtensions Whether extension schemas are applied
* @property {function} extensionFilter Function to selectively apply schema extensions. Function should return a boolean to signify whether the extension should be applied
* @property {Boolean} useCache Whether cached should be returned
*/
/**
* @memberof jsonschema
* @typedef {Object} RegisterSchemaOptions
* @property {Boolean} replace Will replace the existing schema if one exists
*/
/**
* @memberof jsonschema
* @typedef {Object} SanitiseOptions
* @property {Boolean} isInternal Whether internal attributes should be filtered
* @property {Boolean} isReadOnly Whether read-only attributes should be filtered
* @property {Boolean} sanitiseHtml Whether HTML text should be filtered
* @property {Boolean} strict Whether to throw errors
*/
/**
* @memberof jsonschema
* @typedef {Object} ValidateOptions
* @property {Boolean} useDefaults Whether to apply defaults
* @property {Boolean} ignoreRequired Whether to ignore missing required fields
*/
