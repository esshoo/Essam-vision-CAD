# DXF Export V16

This patch replaces only:

`addons/cad-toolkit/core/ProjectExporter.js`

V16 is based on the V14 exporter because V14 opened in AutoCAD, while V15 was too complex and broke compatibility.

## Fix

The V14 DXF had an empty BLOCKS section:

```dxf
0
SECTION
2
BLOCKS
0
ENDSEC
```

The bundled x-viewer loader can parse that as `dxfData.blocks === undefined`, then crash when it calls:

```js
Object.keys(dxfData.blocks)
```

V16 keeps the simple R12/AC1009 format, but writes standard `*MODEL_SPACE` and `*PAPER_SPACE` blocks.

## Expected result

- Better chance to reopen the exported DXF inside the project.
- Should remain closer to the V14 AutoCAD-compatible file.
- Avoids the AC1032/BLOCK_RECORD/OBJECTS complexity that broke V15.
