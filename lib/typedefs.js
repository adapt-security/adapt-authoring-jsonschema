/**
 * @typedef {Object} ApplyPatchProperties
 * @property {Object} extendAnnotations Whether annotation properties should be overwitten by the patch
 * @property {Object} strict Restricts patches to only merge/patch schemas
 * @property {Object} overwriteProperties Whether existing properties should be overwritten by the patch schema
*/
/**
* @typedef {Object} LoadSchemaOptions
* @property {Boolean} applyExtensions Whether extension schemas are applied
* @property {function} extensionFilter Function to selectively apply schema extensions. Function should return a boolean to signify whether the extension should be applied
* @property {Boolean} useCache Whether cached should be returned
*/
/**
* @typedef {Object} RegisterSchemaOptions
* @property {Boolean} replace Will replace the existing schema if one exists
*/
/**
* @typedef {Object} SanitiseOptions
* @property {Boolean} isInternal Whether internal attributes should be filtered
* @property {Boolean} isReadOnly Whether read-only attributes should be filtered
* @property {Boolean} sanitiseHtml Whether HTML text should be filtered
* @property {Boolean} strict Whether to throw errors
*/
/**
* @typedef {Object} ValidateOptions
* @property {Boolean} useDefaults Whether to apply defaults
* @property {Boolean} ignoreRequired Whether to ignore missing required fields
*/