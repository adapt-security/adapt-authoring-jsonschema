import { App } from 'adapt-authoring-core';
import ms from 'ms';
import path from 'path';
/**
 * Adds some useful schema keywords
 * @extends {AbstractModule}
 */
export default class Keywords {
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
          const app = App.instance;
          return [
            [ '$ROOT', app.rootDir ],
            [ '$DATA', app.getConfig('dataDir') ],
            [ '$TEMP', app.getConfig('tempDir') ]
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
      isInternal: function(schema, parentSchema, context) {
        return (value, { parentData, parentDataProperty }) => {
          if(context.schemaEnv.schema.adaptOpts.isInternal && value) {
            delete parentData[parentDataProperty];
          }
          return true;
        };
      },
      isReadOnly: function(schema, parentSchema, context) {
        return (value, { parentData, parentDataProperty }) => {
          if(context.schemaEnv.schema.adaptOpts.isReadOnly && value) {
            delete parentData[parentDataProperty];
          }
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