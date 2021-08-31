const fs = require('fs-extra');
const path = require('path');

class SchemasReference {
  constructor(app, config, outputDir) {
    this.app = app;
    this.outputDir = outputDir;
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
    const table = Object.entries(properties).reduce((output, [attr, config]) => {
      let row = '';
      row +=  `<tr class="${config.default === undefined && required && required.includes(attr) ? 'required' : ''}">\n`;
      row += `<td>${attr}</td>\n`;
      row += `<td>${config.type}</td>\n`;
      row += `<td>${config.default !== undefined ? this.defaultToMd(config.default) : ''}</td>\n`;
      row += `<td>${config.description || ''}</td>\n`;
      row +=  `</tr>\n`;
      return `${output}${row}`;
    }, `<tr><th>Attribute</th><th>Type</th><th>Default</th><th>Description</th></tr>`);

    return `${output}<table class="schema">${table}</table>`;
  }
  /**
   * Returns a string formatted nicely for markdown
   */
  defaultToMd(val) {
    return `<pre>${JSON.stringify(val)}</pre>`;
  }
  writeFile(data) {
    let file = fs.readFileSync(path.join(__dirname, 'schemas-reference.md')).toString();
    const outputPath = path.join(this.outputDir, 'schemas-reference.md');
    Object.entries(data).forEach(([key,value]) => file = file.replace(`{{{${key}}}}`, value));
    fs.writeFileSync(outputPath, file);
    this.customFiles.push(outputPath);
  }
}

module.exports = SchemasReference;
