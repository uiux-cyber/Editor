# Kinora content packs (`*.kinorapack`)

A content pack adds library content to Kinora without updating the app: colour palettes, font
pairings, filters, text styles, transitions, effects, animated backgrounds and templates.

A pack is **one JSON document** with the `.kinorapack` extension. It is data only: there is no
script, no binary and nothing that runs on the CPU. Shaders are GLSL snippets restricted to
straight-line code with small, constant-bounded loops, and they are compiled in an isolated
WebGL2 context before anything is installed.

- Install: *Templates tab › ⋯ › Install content pack…*, the command *Install content pack…*, or
  *Settings › Content packs*. Installed packs live in `<userData>/packs/<id>.kinorapack` and load
  at startup; remove them from the same places.
- Build: `node scripts/build-pack.mjs <folder> [out.kinorapack]` (see [Building](#building-a-pack)).
- Sample: `resources/packs/sample/` → `resources/packs/sample.kinorapack` (also offered as
  *Install the sample pack* in the Content packs window). `npm run check` validates every pack in
  `resources/packs/` exactly like an install, then runs the regular library checks on its items.

## Document

```json
{
  "format": "kinora-pack",
  "version": 1,
  "id": "acme-summer",
  "name": "Acme Summer Pack",
  "packVersion": "1.2.0",
  "author": "Acme Studio",
  "description": "Warm palettes and beach templates.",
  "palettes": [],
  "fontPairs": [],
  "filters": [],
  "textPresets": [],
  "transitions": [],
  "effects": [],
  "generators": [],
  "templates": []
}
```

| Field | Rules |
|---|---|
| `format` / `version` | Always `"kinora-pack"` / `1`. A newer version is refused with a "needs a newer Kinora" message. |
| `id` | 2–48 characters: `a-z`, `0-9`, `-`. Installing a pack with the id of an installed pack **updates** it. |
| `name` | Required, ≤ 80 characters. `packVersion` ≤ 24, `author` ≤ 80, `description` ≤ 600. |
| item arrays | Optional, ≤ 500 items each; at least one item overall. Unknown top-level fields are ignored with a warning. |

**Item ids** are 2–64 characters (`a-z`, `0-9`, `-`), unique within their kind in the pack, and
must not collide with built-in content, another installed pack or the user's templates —
**prefix them with the pack id** (`acme-summer-sunset`). Names are ≤ 80 characters.

The whole document must be ≤ 8 MB, nest ≤ 40 levels and must not contain the keys `__proto__`,
`constructor` or `prototype` anywhere.

### Palettes

Nine `#rrggbb` colours plus `dark` (`true` when the backgrounds are dark):
`bg`, `bg2`, `surface`, `primary`, `secondary`, `accent`, `text`, `textMuted`, `onPrimary`.
Pack palettes join the rotation every built-in template uses for its endless variations.

### Font pairs

`{ "id", "name", "heading": FontRole, "body": FontRole }` with
`FontRole = { "family", "weight", "uppercase"?, "letterSpacing"? }`. `family` must be one of the
24 fonts bundled with Kinora and `weight` one of the weights that family ships (the validator lists
them on error). `letterSpacing` is in em (−0.2…1).

### Filters

`{ "id", "name", "category", "grade" }`. `category` is one of `cinematic film portrait vivid mono
retro mood nature`. `grade` is a partial colour grade; every value is range-checked:

| Field | Range | Field | Range |
|---|---|---|---|
| exposure | −2…2 | highlights, shadows | −1…1 |
| brightness, contrast, saturation, vibrance | −1…1 | fade, vignette, grain, sharpen, mono | 0…1 |
| temperature, tint, gamma | −1…1 | shadowTintAmount, highlightTintAmount | 0…1 |
| hue | −180…180 | shadowTint, highlightTint, monoTint | `#rrggbb` |

### Text styles

`{ "id", "name", "category", "sample", "style", "anim"?, "textAnim"? }`. `category` is one of
`basic title subtitle caption social neon retro elegant bold handwritten lower-third`; `sample` is
the text shown on the tile and inserted (≤ 200 characters). `style` uses the fields of a text
clip's style (see [Clips](#clips)) except `content` and `boxWidth`; `fontFamily` must be bundled.
`anim` / `textAnim` reference clip / text animations by id:
`{ "in": { "id": "pop-in", "duration": 0.5 }, "out": …, "loop": … }`.

### Transitions, effects, animated backgrounds

```json
{
  "id": "acme-summer-blinds",
  "name": "Diagonal Blinds",
  "category": "wipe",
  "duration": 0.8,
  "params": [{ "key": "count", "label": "Blinds", "type": "float", "default": 9, "min": 2, "max": 24 }],
  "glsl": "vec4 transition(vec2 uv) { … }"
}
```

| Kind | Entry point | Categories | Extra fields |
|---|---|---|---|
| `transitions` | `vec4 transition(vec2 uv)` | basic wipe slide zoom blur glitch light shape distort 3d stylized | `duration` 0.1–5 s (default 0.6) |
| `effects` | `vec4 effect(vec2 uv)` | blur stylize distort glitch retro light color motion | `passes` 1–4, `animated` |
| `generators` | `vec4 generate(vec2 uv)` | gradient abstract pattern particles light retro | — |

The GLSL contract (uniforms, helpers, coordinate conventions, premultiplied alpha) is exactly the
one of built-in content, documented at the top of `src/renderer/src/library/types.ts`.
`params` (≤ 24) are declared as uniforms automatically: `float`, `int`, `bool`, `select`
(`options: [{ "label", "value" }]`) become `float`, `color` (`#rrggbb` default) becomes `vec3`.

**Shader safety rules** (checked before compiling):

- no preprocessor directives (`#…`), no `while` / `do` loops, no `uniform` or `in` / `out`
  declarations, no `main()`; the entry point must exist; ≤ 24 000 characters;
- every `for` loop must have the form `for (int i = 0; i < 16; i++)` — a fresh counter, numeric
  literal bounds, a literal step (`++`, `--`, `+= n`, `-= n`) going the right way — run at most
  **256** iterations, and never assign its counter in the body.

Then each shader is compiled and drawn once in a throw-away WebGL2 context; compiler errors are
reported with the item path (`effects[2].glsl: does not compile: …`).

### Templates

Static templates are clip JSON laid out for a design frame. They are rebuilt for every aspect
ratio: full-frame shapes and placeholders stretch to the new frame, overlays move proportionally and
shrink only when they would no longer fit.

```json
{
  "id": "acme-summer-card",
  "name": "Beach Card",
  "category": "promo",
  "tags": ["summer", "sale"],
  "duration": 6,
  "aspects": ["16:9", "1:1"],
  "poster": 0.55,
  "music": { "soundId": "music-upbeat-pop", "volume": 0.75, "fadeIn": 0.4, "fadeOut": 1.2 },
  "design": { "width": 1920, "height": 1080 },
  "clips": []
}
```

- `category`: `intro outro title lower-third social promo quote slideshow countdown youtube business
  event vlog gaming news`. `duration` 1–120 s; every clip must end by then. `aspects` optional
  (default: all of `16:9 9:16 1:1 4:5`). `poster` 0–1 (thumbnail frame).
- `music` (optional): a built-in sound of the `music` category; added under the layers (trimmed to
  the template, faded) when the user keeps *Music* on.
- `clips`: 1–300 clips ordered **bottom → top**, `start` relative to the template start.

#### Clips

Each clip has `type`, `start`, `duration`, optional `name` and `keyframes`
(`{ "x" | "y" | "scaleX" | "scaleY" | "rotation" | "opacity": [{ "t", "v", "ease" }] }`).
Visual clips accept `transform` (`x`, `y` in design px from the frame centre with y down; the
frame's shorter side is 1080), `blendMode`, `flipH`, `flipV`, `crop`, `cornerRadius`, `mask`,
`chromaKey`, `adjust` (a grade), `filter` (`{ "id", "intensity" }`), `effects`
(`[{ "effectId", "params" }]`) and `anim`.

| `type` | Fields |
|---|---|
| `text` | `text`: `content`, `fontFamily`, `fontSize`, `fontWeight`, `italic`, `underline`, `uppercase`, `align`, `lineHeight`, `letterSpacing`, `fill` (paint), `stroke`, `shadow`, `glow`, `background`, `boxWidth`; `textAnim`; `counter` |
| `shape` | `shape`: `kind` (rect ellipse triangle diamond pentagon hexagon octagon star burst heart arrow chevron line cross bubble ring pill frame blob path), `width`, `height`, `fill`, `stroke`, `radius`, `shadow`, `slot`, `path` |
| `sticker` | `stickerId` (a built-in sticker), `size`, `colors` |
| `generator` | `generatorId` (built-in or from this pack), `params` |
| `adjustment` | visual fields only |

Paints are a colour string or `{ "type": "solid", "color" }`,
`{ "type": "linear", "angle", "stops": [{ "offset", "color" }] }`,
`{ "type": "radial", "stops" }`. Effects, filters and generators may come from the same pack.
Media clips (`video`, `image`, `audio`) are not allowed — use placeholders.

**Placeholders**: a `shape` with `"slot": true` is a drop-in placeholder; the user drops a photo or
video on it after applying the template. A placeholder **named `Logo`** is filled with the user's
brand logo when templates are rendered with their brand kit.

**Tokens** make a pack template follow the gallery's palettes and font pairings (and the brand
kit): any colour may be `$bg`, `$bg2`, `$surface`, `$primary`, `$secondary`, `$accent`, `$text`,
`$textMuted` or `$onPrimary`, optionally with an alpha percentage (`$surface/88`), and a text
`fontFamily` may be `$heading` or `$body` (the weight snaps to the nearest weight of that family).
A template without tokens is shown once in the gallery; with tokens it gets endless variations
like the built-in designs.

## Validation and installation

1. The file is read (≤ 8 MB) through the main process; nothing is executed.
2. The renderer validates it (`src/renderer/src/library/packs.ts`): JSON, forbidden keys, schema,
   ranges, fonts, ids, library references, GLSL safety, then compiles every shader in an isolated
   WebGL2 context. Problems are listed in the Content packs window; nothing is installed.
3. Only a valid pack is written to `<userData>/packs/<id>.kinorapack` and its items are registered
   with the library (`registerContent`), so every gallery, the compositor and the template engine
   see them immediately. Packs are re-validated at every start.

Removing a pack unregisters its items; projects that used them show those items as missing until
the pack is installed again. Changing the GLSL of an installed shader takes effect after a restart.

## Building a pack

```
my-pack/
  pack.json            { "id", "name", "packVersion", "author", "description" }
  palettes.json        an array of items per kind…
  filters.json
  transitions.json     shader items may use "glslFile": "blinds.glsl" instead of "glsl"
  blinds.glsl
  templates/           …or a folder per kind with one JSON file per item
    beach-card.json
```

`node scripts/build-pack.mjs my-pack dist/my-pack.kinorapack` checks the structure (ids,
duplicates, shader files) and writes the document; install it in Kinora (or copy it into
`resources/packs/` and run `npm run check`) for the full validation.

## JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://kinora.app/schemas/kinorapack-1.json",
  "title": "Kinora content pack",
  "type": "object",
  "required": ["format", "version", "id", "name"],
  "properties": {
    "format": { "const": "kinora-pack" },
    "version": { "const": 1 },
    "id": { "$ref": "#/$defs/packId" },
    "name": { "type": "string", "minLength": 1, "maxLength": 80 },
    "packVersion": { "type": "string", "maxLength": 24 },
    "author": { "type": "string", "maxLength": 80 },
    "description": { "type": "string", "maxLength": 600 },
    "palettes": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/palette" } },
    "fontPairs": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/fontPair" } },
    "filters": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/filter" } },
    "textPresets": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/textPreset" } },
    "transitions": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/transition" } },
    "effects": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/effect" } },
    "generators": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/generator" } },
    "templates": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/template" } }
  },
  "propertyNames": { "not": { "enum": ["__proto__", "constructor", "prototype"] } },
  "$defs": {
    "packId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{1,47}$" },
    "itemId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{1,63}$" },
    "name": { "type": "string", "minLength": 1, "maxLength": 80 },
    "hex6": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
    "color": { "type": "string", "pattern": "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$" },
    "tokenColor": {
      "type": "string",
      "pattern": "^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|\\$(bg|bg2|surface|primary|secondary|accent|text|textMuted|onPrimary)(/(100|[0-9]{1,2}))?)$"
    },
    "fontFamily": {
      "enum": ["Inter", "Montserrat", "Poppins", "Raleway", "Rubik", "Space Grotesk", "Syne", "Oswald", "Bebas Neue", "Anton", "Archivo Black", "Righteous", "Bangers", "Shrikhand", "Press Start 2P", "Playfair Display", "DM Serif Display", "Abril Fatface", "Lobster", "Pacifico", "Dancing Script", "Caveat", "Permanent Marker", "JetBrains Mono"]
    },
    "fontRole": {
      "type": "object",
      "required": ["family", "weight"],
      "properties": {
        "family": { "$ref": "#/$defs/fontFamily" },
        "weight": { "enum": [100, 200, 300, 400, 500, 600, 700, 800, 900] },
        "uppercase": { "type": "boolean" },
        "letterSpacing": { "type": "number", "minimum": -0.2, "maximum": 1 }
      }
    },
    "animRef": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string" }, "duration": { "type": "number", "minimum": 0.05, "maximum": 60 } } },
    "anims": { "type": "object", "properties": { "in": { "$ref": "#/$defs/animRef" }, "out": { "$ref": "#/$defs/animRef" }, "loop": { "$ref": "#/$defs/animRef" } }, "additionalProperties": false },
    "palette": {
      "type": "object",
      "required": ["id", "name", "dark", "bg", "bg2", "surface", "primary", "secondary", "accent", "text", "textMuted", "onPrimary"],
      "properties": {
        "id": { "$ref": "#/$defs/itemId" },
        "name": { "$ref": "#/$defs/name" },
        "dark": { "type": "boolean" },
        "bg": { "$ref": "#/$defs/hex6" },
        "bg2": { "$ref": "#/$defs/hex6" },
        "surface": { "$ref": "#/$defs/hex6" },
        "primary": { "$ref": "#/$defs/hex6" },
        "secondary": { "$ref": "#/$defs/hex6" },
        "accent": { "$ref": "#/$defs/hex6" },
        "text": { "$ref": "#/$defs/hex6" },
        "textMuted": { "$ref": "#/$defs/hex6" },
        "onPrimary": { "$ref": "#/$defs/hex6" }
      }
    },
    "fontPair": {
      "type": "object",
      "required": ["id", "name", "heading", "body"],
      "properties": { "id": { "$ref": "#/$defs/itemId" }, "name": { "$ref": "#/$defs/name" }, "heading": { "$ref": "#/$defs/fontRole" }, "body": { "$ref": "#/$defs/fontRole" } }
    },
    "grade": {
      "type": "object",
      "minProperties": 1,
      "additionalProperties": false,
      "properties": {
        "exposure": { "type": "number", "minimum": -2, "maximum": 2 },
        "brightness": { "type": "number", "minimum": -1, "maximum": 1 },
        "contrast": { "type": "number", "minimum": -1, "maximum": 1 },
        "saturation": { "type": "number", "minimum": -1, "maximum": 1 },
        "vibrance": { "type": "number", "minimum": -1, "maximum": 1 },
        "temperature": { "type": "number", "minimum": -1, "maximum": 1 },
        "tint": { "type": "number", "minimum": -1, "maximum": 1 },
        "hue": { "type": "number", "minimum": -180, "maximum": 180 },
        "highlights": { "type": "number", "minimum": -1, "maximum": 1 },
        "shadows": { "type": "number", "minimum": -1, "maximum": 1 },
        "fade": { "type": "number", "minimum": 0, "maximum": 1 },
        "gamma": { "type": "number", "minimum": -1, "maximum": 1 },
        "shadowTintAmount": { "type": "number", "minimum": 0, "maximum": 1 },
        "shadowTint": { "$ref": "#/$defs/hex6" },
        "highlightTintAmount": { "type": "number", "minimum": 0, "maximum": 1 },
        "highlightTint": { "$ref": "#/$defs/hex6" },
        "mono": { "type": "number", "minimum": 0, "maximum": 1 },
        "monoTint": { "$ref": "#/$defs/hex6" },
        "vignette": { "type": "number", "minimum": 0, "maximum": 1 },
        "grain": { "type": "number", "minimum": 0, "maximum": 1 },
        "sharpen": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "filter": {
      "type": "object",
      "required": ["id", "name", "category", "grade"],
      "properties": {
        "id": { "$ref": "#/$defs/itemId" },
        "name": { "$ref": "#/$defs/name" },
        "category": { "enum": ["cinematic", "film", "portrait", "vivid", "mono", "retro", "mood", "nature"] },
        "grade": { "$ref": "#/$defs/grade" }
      }
    },
    "textPreset": {
      "type": "object",
      "required": ["id", "name", "category", "sample", "style"],
      "properties": {
        "id": { "$ref": "#/$defs/itemId" },
        "name": { "$ref": "#/$defs/name" },
        "category": { "enum": ["basic", "title", "subtitle", "caption", "social", "neon", "retro", "elegant", "bold", "handwritten", "lower-third"] },
        "sample": { "type": "string", "minLength": 1, "maxLength": 200 },
        "style": { "$ref": "#/$defs/textStyle" },
        "anim": { "$ref": "#/$defs/anims" },
        "textAnim": { "$ref": "#/$defs/anims" }
      }
    },
    "param": {
      "type": "object",
      "required": ["key", "label", "type", "default"],
      "properties": {
        "key": { "type": "string", "pattern": "^(?!u_|gl_)[A-Za-z][A-Za-z0-9_]*$", "maxLength": 40 },
        "label": { "type": "string", "minLength": 1, "maxLength": 60 },
        "type": { "enum": ["float", "int", "bool", "color", "select"] },
        "default": { "type": ["number", "boolean", "string"] },
        "min": { "type": "number" },
        "max": { "type": "number" },
        "step": { "type": "number" },
        "unit": { "type": "string", "maxLength": 12 },
        "options": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "object", "required": ["label", "value"], "properties": { "label": { "type": "string" }, "value": { "type": "number" } } } }
      }
    },
    "params": { "type": "array", "maxItems": 24, "items": { "$ref": "#/$defs/param" } },
    "glsl": { "type": "string", "minLength": 1, "maxLength": 24000, "not": { "pattern": "#|\\bwhile\\b|\\buniform\\b" } },
    "transition": {
      "type": "object",
      "required": ["id", "name", "category", "glsl"],
      "properties": {
        "id": { "$ref": "#/$defs/itemId" },
        "name": { "$ref": "#/$defs/name" },
        "category": { "enum": ["basic", "wipe", "slide", "zoom", "blur", "glitch", "light", "shape", "distort", "3d", "stylized"] },
        "duration": { "type": "number", "minimum": 0.1, "maximum": 5 },
        "params": { "$ref": "#/$defs/params" },
        "glsl": { "$ref": "#/$defs/glsl" }
      }
    },
    "effect": {
      "type": "object",
      "required": ["id", "name", "category", "glsl"],
      "properties": {
        "id": { "$ref": "#/$defs/itemId" },
        "name": { "$ref": "#/$defs/name" },
        "category": { "enum": ["blur", "stylize", "distort", "glitch", "retro", "light", "color", "motion"] },
        "passes": { "type": "integer", "minimum": 1, "maximum": 4 },
        "animated": { "type": "boolean" },
        "params": { "$ref": "#/$defs/params" },
        "glsl": { "$ref": "#/$defs/glsl" }
      }
    },
    "generator": {
      "type": "object",
      "required": ["id", "name", "category", "glsl"],
      "properties": {
        "id": { "$ref": "#/$defs/itemId" },
        "name": { "$ref": "#/$defs/name" },
        "category": { "enum": ["gradient", "abstract", "pattern", "particles", "light", "retro"] },
        "params": { "$ref": "#/$defs/params" },
        "glsl": { "$ref": "#/$defs/glsl" }
      }
    },
    "paint": {
      "oneOf": [
        { "$ref": "#/$defs/tokenColor" },
        { "type": "object", "required": ["type", "color"], "properties": { "type": { "const": "solid" }, "color": { "$ref": "#/$defs/tokenColor" } } },
        {
          "type": "object",
          "required": ["type", "stops"],
          "properties": {
            "type": { "enum": ["linear", "radial"] },
            "angle": { "type": "number" },
            "stops": { "type": "array", "minItems": 2, "maxItems": 16, "items": { "type": "object", "required": ["offset", "color"], "properties": { "offset": { "type": "number", "minimum": 0, "maximum": 1 }, "color": { "$ref": "#/$defs/tokenColor" } } } }
          }
        }
      ]
    },
    "shadow": { "type": "object", "required": ["color"], "properties": { "color": { "$ref": "#/$defs/tokenColor" }, "blur": { "type": "number", "minimum": 0, "maximum": 500 }, "x": { "type": "number" }, "y": { "type": "number" } } },
    "textStyle": {
      "type": "object",
      "properties": {
        "content": { "type": "string", "maxLength": 4000 },
        "fontFamily": { "anyOf": [{ "$ref": "#/$defs/fontFamily" }, { "enum": ["$heading", "$body"] }] },
        "fontSize": { "type": "number", "minimum": 4, "maximum": 2000 },
        "fontWeight": { "type": "number", "minimum": 100, "maximum": 900 },
        "italic": { "type": "boolean" },
        "underline": { "type": "boolean" },
        "uppercase": { "type": "boolean" },
        "align": { "enum": ["left", "center", "right"] },
        "lineHeight": { "type": "number", "minimum": 0.4, "maximum": 5 },
        "letterSpacing": { "type": "number", "minimum": -1, "maximum": 3 },
        "fill": { "$ref": "#/$defs/paint" },
        "stroke": { "type": "object", "required": ["color", "width"], "properties": { "color": { "$ref": "#/$defs/tokenColor" }, "width": { "type": "number", "minimum": 0, "maximum": 500 } } },
        "shadow": { "$ref": "#/$defs/shadow" },
        "glow": { "type": "object", "required": ["color"], "properties": { "color": { "$ref": "#/$defs/tokenColor" }, "blur": { "type": "number", "minimum": 0, "maximum": 500 } } },
        "background": { "type": "object", "required": ["color"], "properties": { "color": { "$ref": "#/$defs/tokenColor" }, "opacity": { "type": "number", "minimum": 0, "maximum": 1 }, "padX": { "type": "number" }, "padY": { "type": "number" }, "radius": { "type": "number" } } },
        "boxWidth": { "type": "number", "minimum": 10, "maximum": 20000 }
      }
    },
    "transform": {
      "type": "object",
      "properties": {
        "x": { "type": "number", "minimum": -20000, "maximum": 20000 },
        "y": { "type": "number", "minimum": -20000, "maximum": 20000 },
        "scaleX": { "type": "number", "minimum": -100, "maximum": 100 },
        "scaleY": { "type": "number", "minimum": -100, "maximum": 100 },
        "rotation": { "type": "number" },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "keyframes": {
      "type": "object",
      "propertyNames": { "enum": ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "volume"] },
      "additionalProperties": { "type": "array", "maxItems": 500, "items": { "type": "object", "required": ["t", "v"], "properties": { "t": { "type": "number", "minimum": 0 }, "v": { "type": "number" }, "ease": { "type": "string" } } } }
    },
    "clip": {
      "type": "object",
      "required": ["type", "duration"],
      "properties": {
        "type": { "enum": ["text", "shape", "sticker", "generator", "adjustment"] },
        "name": { "type": "string", "maxLength": 200 },
        "start": { "type": "number", "minimum": 0, "maximum": 3600 },
        "duration": { "type": "number", "exclusiveMinimum": 0, "maximum": 3600 },
        "keyframes": { "$ref": "#/$defs/keyframes" },
        "transform": { "$ref": "#/$defs/transform" },
        "blendMode": { "enum": ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "add", "subtract"] },
        "anim": { "$ref": "#/$defs/anims" },
        "textAnim": { "$ref": "#/$defs/anims" },
        "adjust": { "$ref": "#/$defs/grade" },
        "filter": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string" }, "intensity": { "type": "number", "minimum": 0, "maximum": 1 } } },
        "effects": { "type": "array", "maxItems": 16, "items": { "type": "object", "required": ["effectId"], "properties": { "effectId": { "type": "string" }, "enabled": { "type": "boolean" }, "params": { "type": "object" } } } },
        "text": { "$ref": "#/$defs/textStyle" },
        "shape": {
          "type": "object",
          "required": ["kind", "width", "height"],
          "properties": {
            "kind": { "enum": ["rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "octagon", "star", "burst", "heart", "arrow", "chevron", "line", "cross", "bubble", "ring", "pill", "frame", "blob", "path"] },
            "width": { "type": "number", "minimum": 0.5, "maximum": 40000 },
            "height": { "type": "number", "minimum": 0.5, "maximum": 40000 },
            "fill": { "$ref": "#/$defs/paint" },
            "radius": { "type": "number", "minimum": 0 },
            "stroke": { "type": "object", "required": ["color", "width"], "properties": { "color": { "$ref": "#/$defs/tokenColor" }, "width": { "type": "number", "minimum": 0, "maximum": 500 } } },
            "shadow": { "$ref": "#/$defs/shadow" },
            "slot": { "type": "boolean" }
          }
        },
        "stickerId": { "type": "string" },
        "size": { "type": "number", "minimum": 4, "maximum": 8000 },
        "colors": { "type": "array", "maxItems": 12, "items": { "$ref": "#/$defs/tokenColor" } },
        "generatorId": { "type": "string" },
        "params": { "type": "object" }
      }
    },
    "template": {
      "type": "object",
      "required": ["id", "name", "category", "duration", "design", "clips"],
      "properties": {
        "id": { "$ref": "#/$defs/itemId" },
        "name": { "$ref": "#/$defs/name" },
        "category": { "enum": ["intro", "outro", "title", "lower-third", "social", "promo", "quote", "slideshow", "countdown", "youtube", "business", "event", "vlog", "gaming", "news"] },
        "tags": { "type": "array", "maxItems": 24, "items": { "type": "string", "maxLength": 40 } },
        "duration": { "type": "number", "minimum": 1, "maximum": 120 },
        "aspects": { "type": "array", "minItems": 1, "items": { "enum": ["16:9", "9:16", "1:1", "4:5"] } },
        "poster": { "type": "number", "minimum": 0, "maximum": 1 },
        "music": {
          "type": "object",
          "required": ["soundId"],
          "properties": {
            "soundId": { "type": "string", "pattern": "^music-" },
            "volume": { "type": "number", "minimum": 0, "maximum": 2 },
            "fadeIn": { "type": "number", "minimum": 0, "maximum": 10 },
            "fadeOut": { "type": "number", "minimum": 0, "maximum": 10 }
          }
        },
        "design": { "type": "object", "required": ["width", "height"], "properties": { "width": { "type": "number", "minimum": 16, "maximum": 8192 }, "height": { "type": "number", "minimum": 16, "maximum": 8192 } } },
        "clips": { "type": "array", "minItems": 1, "maxItems": 300, "items": { "$ref": "#/$defs/clip" } }
      }
    }
  }
}
```

The schema describes the shape; the app additionally checks what a schema cannot: id collisions
with installed content, that referenced animations / stickers / effects / filters / generators /
sounds exist (pack items included), font weights per family, loop bounds, compilation, and that
clips end within the template duration.
