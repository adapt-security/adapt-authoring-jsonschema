#!/usr/bin/env node
/**
 * Checks for duplicate schema properties
*/
import { App } from 'adapt-authoring-core';

process.env.NODE_ENV = 'production';
process.env.ADAPT_AUTHORING_LOGGER__mute = 'true';

let app;

async function check() {
  console.log('Checking for duplicate schema definitions.\n');
  app = await App.instance.onReady();
  const schema = await app.waitForModule('jsonschema');

  await Promise.allSettled(Object.keys(schema.schemaPaths).map(async s => {
    const usedKeys = {};
    const hierarchy = await schema.loadSchemaHierarchy(s);
    await Promise.all(hierarchy.map(s => checkSchema(s, usedKeys)));
    const duplicates = Object.entries(usedKeys).filter(([key, uses]) => uses.length > 1);

    if(duplicates.length) {
      console.log(`Schema '${s}' contains duplicate definitions for the following properties:`);
      duplicates.forEach(([prop, schemas]) => console.log(` - ${prop}: ${schemas}`));
      console.log('');
      process.exitCode = 1;
    }
  }));
  if(process.exitCode !== 1) console.log('No duplicates found.');
  process.exit();
}

async function checkSchema(schema, usedKeys) {
  const props = schema.properties ?? schema?.$patch?.with?.properties ?? schema?.$merge?.with?.properties;
  Object.keys(props).forEach(p => {
    if(p === '_globals') return;
    if(!usedKeys[p]) usedKeys[p] = [];
    usedKeys[p].push(schema.$anchor);
  });
}

check();