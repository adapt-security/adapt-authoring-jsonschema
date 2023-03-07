export default class SchemasReference {
  constructor(app, config, dir, utils) {
    this.app = app;
    this.utils = utils;
  }
  async run() {
    this.schemas = await this.loadSchemas();
    this.manualFile = 'schemas-reference.md';
    this.contents = Object.keys(this.schemas);
    this.replace = { 'LIST': this.generateList() };
  }
  async loadSchemas() {
    const schema = await this.app.waitForModule('jsonschema');
    return Object.keys(schema.schemas)
      .sort((a, b) => a.localeCompare(b))
      .reduce((schemas, s) => Object.assign(schemas, { [s]: schema.schemas[s].raw }), {});
  }
  generateList() {
    return Object.entries(this.schemas).reduce((output, [dep, schema]) => {
      return `${output}<h3 id="${dep.toLowerCase()}" class="dep">${dep}</h3>
      
      ${this.schemaToMd(schema)}
      
      `;
    }, '');
  }
  schemaToMd(schema) {
    let output = '';
    if(schema.description) {
      output += `<div class="desc">${schema.description}</div>\n\n`;
    }
    let s;
    if(schema.properties) {
      s = schema;
    } else if(schema.$patch) {
      s = schema.$patch.with;
      const ref = schema.$patch.source.$ref;
      output += `<div class="extension">Patches <a href="#/schemas-reference?id=${ref}">${ref}</a></div>`;
    } else if(schema.$merge) {
      s = schema.$merge.with;
      const ref = schema.$merge?.source?.$ref;
      output += `<div class="extension">${ref ? `Merges with <a href="#/schemas-reference?id=${ref}">${ref}</a>` : 'This is a merge schema'}</div>\n\n`;
    }
    const { properties, required } = s;

    if(!properties) {
      return;
    }
    if(required) {
      output += `<div class="required">Fields in bold are required.</div>\n\n`;
    }
    const table = `<tr><th>Attribute</th><th>Type</th><th>Default</th><th>Description</th></tr>${this.tableRowsFromProps(properties, required)}`;
    return `${output}<table class="schema">${table}</table>`;
  }
  tableRowsFromProps(properties, required = [], parent) {
    return Object.entries(properties).reduce((output, [attr, config]) => {
      const attrKey = (parent ? parent + '.' : '') + attr;
      output +=  `<tr class="${config.default === undefined && required && required.includes(attr) ? 'required' : ''}">\n`;
      output += `<td>${attrKey}</td>\n`;
      output += `<td>${config.type}</td>\n`;
      output += `<td>${config.default !== undefined ? this.defaultToMd(config.default) : ''}</td>\n`;
      output += `<td>${config.description || ' '}</td>\n`;
      output +=  `</tr>\n`;
      if(config.properties) output += this.tableRowsFromProps(config.properties, config.required, attrKey);
      return output;
    }, '');
  }
  /**
   * Returns a string formatted nicely for markdown
   */
  defaultToMd(val) {
    return `<pre>${JSON.stringify(val)}</pre>`;
  }
}
