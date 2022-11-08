import { App } from 'adapt-authoring-core';
import ms from 'ms';
/**
 * Adds some useful schema keywords
 * @extends {AbstractModule}
 */
class Keywords {
  static get all() {
    const keywords = {
      isDate: function() {
        return (value, { parentData, parentDataProperty }) => {
          try {
            parentData[parentDataProperty] = new Date(value);
            return true;
          } catch(e) {
            return false;
          }
        };
      },
      isDirectory: function() {
        const doReplace = value => {
          return [
            [ '$ROOT', App.instance.rootDir ],
            [ '$DATA', this.get(`${App.instance.name}.dataDir`) ],
            [ '$TEMP', this.get(`${App.instance.name}.tempDir`) ]
          ].reduce((m, [k,v]) => {
            return m.startsWith(k) ? path.resolve(v, m.replace(k, '').slice(1)) : m;
          }, value);
        };
        return (value, { parentData, parentDataProperty }) => {
          try {
            parentData[parentDataProperty] = doReplace(value);
          } catch(e) {}
          return true;
        };
      },
      isTimeMs: function() {
        return (value, { parentData, parentDataProperty }) => {
          try {
            parentData[parentDataProperty] = ms(value);
            return true;
          } catch(e) {
            return false;
          }
        };
      },
      isInternal: function(schema, parentSchema, context) {
        return (value, { parentData, parentDataProperty }) => {
          if(context.schemaEnv.schema.adaptOpts[k] && value) {
            delete parentData[parentDataProperty];
          }
          return true;
        };
      }
    };
    return Object.entries(keywords).map(([keyword, compile]) => {
      return {
        keyword,
        type: 'string',
        modifying: true,
        schemaType: 'boolean',
        compile
      };
    });
  }
}