# Introduction to schemas

The Adapt authoring tool uses the JSON Schema specification (draft 2020-12) to define its data schemas. This page will give you a brief explanation of why we use JSON schema.

## What is a schema?

At its most basic level, a schema is a 'blueprint' which is applied to information coming into the application.

As with architectural blueprints, a database schema defines how data should be structured and named, as well as other expectations such as the specific 'type' of the data (e.g. strings, numbers) as well as other restrictions (e.g. a fixed length for strings).
 
## Why use a schema?

Schemas are **MASSIVELY** useful because they set the expectations for data moving into and out of an application. This benefits third-parties because it makes it easier to design interactions with the application, and it benefits the application itself because it can assume that data entering from external sources is in an expected and valid format.

_**Note**: schemas only become useful when a 'validation' process is used, which compares data to the schema which defines that data. Without validation, we have no idea whether the data is safe to use or not._

## Why JSON Schemas?
_**TLDR;** JSON just 'works' with Javascript._

The JSON Schema specification is a schema spec based on Javascript Object Notation (JSON) and was designed specifically for annotating and validating JSON documents, which are the standard for data representation in Javascript code (and therefore Node.js). We also currently use MongoDB as our database which uses JSON-like documents.

Additionally, the JSON Schema specification has matured to a point where it is incredibly well supported by a host of third-party libraries from data validators to UI form renderers.

## Defining a schema

When defining a schema, you need to think about the kind of data you need, and how that data is best structured to make it easy to work with.

### Data types

JSON uses the following types:
- **object**: `{ "a": 1, "b": 2 }`
- **array**: `[1,2,3]`
- **number**: `369`
- **string**: `"Hello world"`
- **boolean**: `true`/`false`
- **null**: `null`

Combined, these types allow a huge amount of flexibility in the way that you want to define your data.

e.g.
```
{
  "$anchor": "component",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["_component"],
  "properties": {
    "_component": {
      "type": "string",
    },
    "_layout": {
      "type": "string",
      "default": ""
    },
    "_isResetOnRevisit": {
      "type": "string",
      "default": "false",
      "enum": ["false", "soft", "hard"],
    },
    "_disableAccessibilityState": {
      "type": "boolean",
      "default": false,
    },
    "_accessibility": {
      "type": "object",
      "default": {},
      "properties": {
        "_isEnabled": {
          "type": "boolean",
          "default": true
        },
        "_isSkipNavigationEnabled": {
          "type": "boolean",
          "default": true
        },
        "_ariaLevels": {
          "type": "object",
          "default": {},
          "properties": {
            "_menu": {
              "type": "number",
              "title": "Menu",
              "default": 1
            },
            "_page": {
              "type": "number",
              "default": 1
            },
            "_article": {
              "type": "number",
              "title": "Article",
              "default": 2
            },
            "_block": {
              "type": "number",
              "title": "Block",
              "default": 3
            },
            "_component": {
              "type": "number",
              "title": "Component",
              "default": 4
            }
          }
        }
      }
    }
  }
}

```

##### For more in-depth information on JSON schemas, the [Understanding JSON Schema](https://json-schema.org/understanding-json-schema/) is a great place to start.