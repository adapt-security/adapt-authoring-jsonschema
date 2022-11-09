# Introduction to schemas

The Adapt authoring tool uses the JSON Schema specification (draft 2020-12) to define its data schemas. This page will give you a brief explanation of why we use JSON schema.

## What is a schema?

At its most basic level, a schema is a 'blueprint' which is applied to information coming into the application.

As with architectural blueprints, a database schema defines how data should be structured and named, as well as other expectations such as the specific 'type' of the data (e.g. strings, numbers) as well as other restrictions (e.g. a fixed length for strings).
 
## Why use a schema?

Schemas are **MASSIVELY** useful because they set the expectations for data moving into and out of an application. This benefits third-parties because it makes it easier to design interactions with the application, and it benefits the application itself because it can assume that data entering from external sources is in an expected and valid format.

> **Note**: schemas only become useful when a 'validation' process is used, which compares data to the schema which defines that data. Without validation, we have no idea whether the data is safe to use or not.

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
  "$anchor": "example-schema",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["myRequiredAttribute"],
  "properties": {
    "myRequiredAttribute": {
      "type": "string",
    },
    "aStringAttribute": {
      "type": "number",
      "default": 12345
    },
    "aStringAttributeWithRestrictedValues": {
      "type": "string",
      "default": "false",
      "enum": ["false", "soft", "hard"],
    },
    "nestedObjectAttribute": {
      "type": "object",
      "default": {},
      "properties": {
        "nestedProperty": {
          "type": "boolean",
          "default": true
        }
      }
    }
  }
}
```

> For more in-depth information on JSON schemas, the [Understanding JSON Schema](https://json-schema.org/understanding-json-schema/) ebook is a great place to start.

### Custom schema keywords

In addition to the standard keywords defined in the JSON schema specification, the Adapt authoring tool jsonschema module defines a number of extra custom keywords which add extra convenient functionality when validating incoming data.

The following custom keywords are available:

#### `isDate`
This keyword will parse any string value into a valid JavaScript Date.

#### `isDirectory`
This keyword will resolve any path values using a number of default directory values. This is very useful when making use of the existing app directories (e.g. you want to store data in the app's temp folder). The following are supported values:
- `$ROOT` will resolve to the main app root folder
- `$DATA` will resolve to the app's data folder
- `$TEMP` will resolve to the app's temp folder

#### `isInternal`
This keyword will ensure that the attribute is **not** returned when a web API request is made. This is useful for restricting sensitive information like passwords. Note that this keyword only applies to the web APIs, and not when accessing data programatically.

#### `isReadOnly`
This keyword will ensures that the attribute is **not** modified when a web API request is made. Note that this keyword only applies to the web APIs, and not when accessing data programatically.

#### `isTimeMs`
This keyword is very useful when defining time values, as it allows a human-readable input value to be automatically converted into milliseconds.



```
"$anchor": "example-schema",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["myRequiredAttribute"],
  "properties": {
    "myDateAttribute": {
      "type": "string",
      "isDate": true,
      "default": "1970-01-01T00:00:00.000Z"
    },
    "myDirectoryAttribute": {
      "type": "string",
      "isDirectory": true,
      "default": "$TEMP/myfolder" // will be replace $TEMP with the correct path to the temp folder
    },
    "myInternalAttribute": {
      "type": "string",
      "isInternal": true
    },
    "myReadOnlyAttribute": {
      "type": "string",
      "isReadOnly": true
    },
    "myTimeAttribute": {
      "type": "string",
      "isTimeMs": true,
      "default": "7d" // will be converted to the equivalent of 7 days in milliseconds (604800000)
    }
  }
}
```