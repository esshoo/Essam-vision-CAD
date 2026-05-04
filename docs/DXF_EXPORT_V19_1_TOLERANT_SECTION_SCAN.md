# DXF Export V19.1

Fixes `debugDXFMatch()` returning:

```text
reason: no-entities-section
```

## Cause

The original `chandelier.dxf` starts with DXF `999` comment pairs before the first `SECTION`.
V19 scanned sections using fixed even-pair stepping. Any line-offset/BOM/comment alignment issue could make it miss `ENTITIES`.

## Fix

`ProjectExporter.js` now scans DXF sections line-by-line instead of assuming fixed even alignment:

- `findSections()` is tolerant
- `readLayerNames()` is tolerant
- `ensureLayerTable()` is tolerant
- `debugDXFMatch()` returns `sourceInfo` with detected sections and entity record count

Replace only:

```text
addons/cad-toolkit/core/ProjectExporter.js
```
