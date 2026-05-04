# DXF Export Compatibility V15

This patch replaces only:

```text
addons/cad-toolkit/core/ProjectExporter.js
```

## Why

The previous DXF export could fail when opened again in the bundled x-viewer loader.
The loader expects more than a plain `ENTITIES` section. It reads:

- `dxfData.blocks`
- `tables.BLOCK_RECORD.entries`
- layout information for Model space

If those sections are missing or too thin, the loader can throw:

```text
TypeError: Cannot convert undefined or null to object
```

## What changed

V15 writes a fuller ASCII DXF skeleton:

- HEADER with `AC1032`
- TABLES
- LTYPE
- LAYER
- STYLE
- BLOCK_RECORD
- BLOCKS with `*Model_Space` and `*Paper_Space`
- ENTITIES
- OBJECTS with LAYOUT entries

The exported geometry is still simple and safe:

- LINE
- TEXT

This is intentional. It prioritizes reopening the file in the project over preserving every advanced CAD primitive.
