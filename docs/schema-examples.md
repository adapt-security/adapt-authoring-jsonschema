# Schema examples

This page presents some example schema definitions (along with their UI representation) which may be useful in defining your own schemas.

## Quick navigation
- [String](#string)
- [String with text area](#string-with-text-area)
- [Number](#number)
- [Boolean with checkbox](#boolean-with-checkbox)
- [Image](#image)
- [Select](#select)
- [Object](#object)
- [Array](#array)

## String 

> Simple string values do not need custom `_backboneForms` configuration.

```
"title": {
  "type": "string",
  "title": "Title",
  "default": "Default title",
  "_adapt": {
    "translatable": true
  }
}
```

<img width="815" alt="Screenshot 2023-01-16 at 17 06 30" src="https://user-images.githubusercontent.com/11569678/212891159-e73fbe91-0169-429e-86c7-3f8231617b3b.png">

## String with text area

```
"body": {
  "type": "string",
  "title": "Body",
  "default": "",
  "_adapt": {
    "translatable": true
  },
  "_backboneForms": "TextArea"
}
```

<img width="820" alt="Screenshot 2023-01-16 at 17 07 11" src="https://user-images.githubusercontent.com/11569678/212891179-f7477a54-3be5-4c39-aa60-7df67d86b7d2.png">

## Number

> Number values do not need custom `_backboneForms` configuration.

```
"_left": {
  "type": "number",
  "title": "Pin horizontal position (%)",
  "description": "",
  "default": 0
}
```

<img width="484" alt="Screenshot 2023-01-16 at 17 10 50" src="https://user-images.githubusercontent.com/11569678/212891200-f9968fe2-8882-4248-8bb2-d6b2f8151e56.png">

## Boolean with checkbox

> Boolean values do not need custom `_backboneForms` configuration.

```
"_isMobileTextBelowImage": {
  "type": "boolean",
  "title": "Move text area below image on mobile",
  "description": "If enabled, on mobile, the text area drops below the image instead of being behind the strapline button",
  "default": false
}
```

<img width="336" alt="Screenshot 2023-01-16 at 17 29 09" src="https://user-images.githubusercontent.com/11569678/212891377-4c3e130d-5f2a-4de5-b1e2-b1747ed2da0e.png">

## Image

In addition to the `type`, an asset sub-schema can define the type of the asset using the `media` property (see [this page](/schemas-introduction#custom-backbone-forms-properties) for more information).

```
"src": {
  "type": "string",
  "isObjectId": true,
  "title": "Source",
  "description": "This is the image that appears behind the pins",
  "_backboneForms": {
    "type": "Asset",
    "media": "image"
  }
}
```

<img width="331" alt="Screenshot 2023-01-16 at 17 29 41" src="https://user-images.githubusercontent.com/11569678/212891422-c240c248-1bfd-4c2d-af63-a01aa281ba45.png">

## Select

```
"_setCompletionOn": {
  "type": "string",
  "title": "Completion criteria",
  "description": "Whether completion is based on the learner having viewed all the narrative items - or just having viewed the component",
  "default": "allItems",
  "enum": [
    "inview",
    "allItems"
  ],
  "_backboneForms": "Select"
}
```

<img width="178" alt="Screenshot 2023-01-16 at 17 31 00" src="https://user-images.githubusercontent.com/11569678/212891453-5c482ea5-ef4f-425f-9756-cdb5b71d7e69.png">

## Object

```
"_graphic": {
  "type": "object",
  "title": "Graphic",
  "default": {},
  "properties": {
    ...omitted for brevity
  }
}
```

<img width="485" alt="Screenshot 2023-01-16 at 17 33 08" src="https://user-images.githubusercontent.com/11569678/212891476-fab8198d-2dca-4ce5-af0b-4f07729780f4.png">

## Array

The items value is its own schema, and can take any of the standard types.

```
"_items": {
  "type": "array",
  "title": "Items",
  "items": {
    ...
  }
}
```

<img width="79" alt="Screenshot 2023-01-16 at 17 33 43" src="https://user-images.githubusercontent.com/11569678/212891491-b6102f17-7631-4ef3-b3cc-1c0dadfd3522.png">