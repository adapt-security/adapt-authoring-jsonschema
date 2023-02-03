# Writing a schema

This page outlines the various elements of an Adapt data schema, and gives tips on how to start writing your own schemas. If you're new to schemas, head over to [this page](/introduction-to-schemas), which goes over the basics.

> For some specific schema examples, see [this page](/schema-examples).

## Quick links
- [Defining a schema](#defining-a-schema)
- [Defining schema inheritance](#defining-schema-inheritance)
- [Custom schema keywords](#custom-schema-keywords)
- [Custom Adapt properties](#custom-adapt-properties)
- [Custom Backbone Forms properties](#custom-backbone-forms-properties)

## Defining schema inheritance

You may find when defining your schemas that you want to extend or modify existing schemas, or split up your schemas in such a way as you can share properties across multiple schemas. For this purpose, you can use the `$merge` and `$patch` keywords.

The main difference between merge and patch schemas is how they're accessed:
- `$merge` schemas are considered 'complete' schemas, and are accessed directly (e.g. the UI will request the MCQ schema by name when rendering the MCQ form page)
- `$patch` schemas are not considered 'complete' schemas, but rather are 'attached' to another schema when that schema is requested (e.g. the UI will request the `course` schema which will include the relevant extension `$patch` schemas).

### `$merge` schemas

Merge schemas are useful when you have a schema which needs to directly inherit from another existing schema. As an example, all Adapt framework content schemas extend from a base `content` schema, which defines the basic attributes such as `title` and `body`. 

Every `$merge` schema must define the base schema it inherits from (as a `source` attribute), and any additional properties (nested under a `with` attribute). For example:

```
{
  "$anchor": "example-schema",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "$merge": {
    "source": {
      "$ref": "base-schema"
    }
    "with": {
      "properties": {
        "myAttribute": {
          "type": "string"
        }
      }
    }
  }
}
```

### `$patch` schemas

`$patch` schemas are useful when looking to augment an existing schema with extra attributes or override existing schema properties (as an example, many Adapt framework extensions will define their own `$patch`schema for the `course` schema which will define extra `_globals` properties specific to that extension).

`$patch` schemas are almost identical to `$merge` schemas, with the only difference being that the `$merge` is replaced with the `$patch` keyword:

```
{
  "$anchor": "example-schema",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "$patch": {
    "source": {
      "$ref": "base-schema"
    }
    "with": {
      "properties": {
        "myAttribute": {
          "type": "string"
        }
      }
    }
  }
}
```

## Custom schema keywords

In addition to the standard keywords defined in the JSON schema specification, the Adapt authoring tool jsonschema module defines a number of extra custom keywords which add extra convenient functionality when validating incoming data.

The following custom keywords are available:

### `isDate`
This keyword will parse any string value into a valid JavaScript Date.

#### Example
```
"myDateAttribute": {
  "type": "string",
  "isDate": true
}
```

### `isDirectory`
This keyword will resolve any path values using a number of default directory values. This is very useful when making use of the existing app directories (e.g. you want to store data in the app's temp folder). The following are supported values:
- `$ROOT` will resolve to the main app root folder
- `$DATA` will resolve to the app's data folder
- `$TEMP` will resolve to the app's temp folder

#### Example
```
"myDirectoryAttribute": {
  "type": "string",
  "isDirectory": true,
  "default": "$TEMP/myfolder" // will be replace $TEMP with the correct path to the temp folder
}
```

### `isInternal`
This keyword will ensure that the attribute is **not** returned when a web API request is made. This is useful for restricting sensitive information like passwords. Note that this keyword only applies to the web APIs, and not when accessing data programatically.

#### Example
```
"myInternalAttribute": {
  "type": "string",
  "isInternal": true
}
```

### `isReadOnly`
This keyword will ensures that the attribute is **not** modified when a web API request is made. Note that this keyword only applies to the web APIs, and not when accessing data programatically.

#### Example
```
"myReadOnlyAttribute": {
  "type": "string",
  "isReadOnly": true
}
```

### `isTimeMs`
This keyword is very useful when defining time values, as it allows a human-readable input value to be automatically converted into milliseconds.

#### Example
```
"myTimeAttribute": {
  "type": "string",
  "isTimeMs": true,
  "default": "7d" // will be converted to the equivalent of 7 days in milliseconds (604800000)
}
```

## Custom Adapt properties

The `_adapt` keyword is used to group schema properties which are non-standard to the JSON schema specification and related to various Adapt-specific features.

Property | Type | Description
--- | --- | ---
`editorOnly` | `Boolean` |  Determines whether the attribute should be included in output JSON
`isSetting` | `Boolean` | Attribute will appear in the ‘Settings’ section of the form
`translatable` | `Boolean` | Whether the attribute is a language-specific string for translation

### Example
```
"myAttribute": {
  "type": "string",
  "_adapt": {
    "editorOnly": true,
    "translatable": true
  }
}
```

## Custom Backbone forms properties

The Adapt authoring tool uses the [Backbone Forms](https://github.com/powmedia/backbone-forms) library to render forms from the data schemas into a user-friendly HTML form. The `_backboneForms` keyword is used to group schema properties which apply to Backbone Forms.

Property | Type | Description
--- | --- | ---
`type` | `String` | Override the type of Backbone Forms input to be used (by default, the type will be inferred from the schema property's type value). Accepted types: `Asset`, `Text`, `Number`, `Password`, `TextArea`, `Checkbox`, `Checkboxes`, `Select`, `Radio`, `Object`, `Date`, `DateTime`, `List`. See the [Backbone Forms docs](https://github.com/powmedia/backbone-forms#schema-definition) for more information.
`showInUi` | `Boolean` |  Determines whether the attribute will be rendered in forms
`media` | `String` |  When using a `type` of `Asset`, you can also restrict the AAT UI to only show assets of a specific type. The AAT stores the asset type based in its [MIME type](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types) (e.g. files with a MIME type of `image/png` and `image/jpeg` would both have a type of `image`).
`editorAttrs` | `Object` |  Extra options passed to the Backbone Forms input. See the [Backbone Forms docs](https://github.com/powmedia/backbone-forms#schema-definition) for more information.

> The Adapt authoring tool will attempt to infer the type of a form input using the `type` value in the schema. In most cases this will suffice, so check that you definitely need to override the default behaviour before defining additional `_backboneForms` properties.

### Example

```
"myAttribute": {
  "type": "string",
  "_backboneForms": {
    "type": "Asset",
    "showInUi": false,
    "media": "image"
  }
}
```

In many cases, you'll only want to customise the type of an input. If this is the case, the `_backboneForms` property can also be a string value, e.g.

```
"myAttribute": {
  "type": "string",
  "_backboneForms": "Number"
}
```