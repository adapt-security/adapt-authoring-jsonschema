import fs from 'fs';
import path from 'path';

export default class SchemasReference {
  constructor(app, config) {
    this.app = app;
    this.outputDir = config.outputDir;
    this.customFiles = [];
    this.schemas = {};
  }
  async run() {
    await this.loadSchemas();
    this.writeFile({
      'TABLE_OF_CONTENTS': this.generateTOC(),
      'LIST': this.generateList()
    });
  }
  async loadSchemas() {
    const schema = await this.app.waitForModule('jsonschema');
    const schemaNames = Object.keys(schema.schemaPaths).sort((a,b) => a.localeCompare(b));
    for (let s of schemaNames) this.schemas[s] = await schema.getSchema(s, false)
  }
  generateTOC() {
    let output = '';
    Object.keys(this.schemas).forEach((dep) => output += `- [${dep}](#${dep.toLowerCase()})\n`);
    output += '\n';
    return output;
  }
  generateList() {
    let output = '';

    Object.entries(this.schemas).forEach(([dep, schema]) => {
      output += `<h3 id="${dep.toLowerCase()}" class="dep">${dep}</h3>\n\n`;
      output += `${this.schemaToMd(schema)}\n\n`;
    });

   return output;
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
  writeFile(data) {
    let file = fs.readFileSync(new URL('schemas-reference.md', import.meta.url)).toString();
    const outputPath = path.join(this.outputDir, 'schemas-reference.md');
    Object.entries(data).forEach(([key,value]) => file = file.replace(`{{{${key}}}}`, value));
    fs.writeFileSync(outputPath, file);
    this.customFiles.push(outputPath);
  }
}
