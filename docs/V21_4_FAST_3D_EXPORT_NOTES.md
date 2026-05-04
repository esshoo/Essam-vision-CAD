# V21.4 Fast 3D Export Pipeline

This patch replaces:

`addons/cad-toolkit/CADSceneExporter.js`

## Goal
Reduce the long delay when moving from 2D to 3D without changing the source data, EntityRegistry, PDF/DXF reading, deletion, hide/show, or layer management.

## What changed

- Replaces expensive O(n²) strict merge with a fast endpoint-map merge on huge layers.
- Filters layers before processing instead of after processing.
- Removes exact duplicate line segments in the 3D ViewModel only.
- Avoids building a huge `allPoints` array.
- Adds an export cache for repeated 3D previews of the same file/page/rules/edit state.
- Adds performance diagnostics:

```js
window.__essamCADSceneExporterV27.getPerformanceSummary()
```

## Important
This does not delete source data. It only optimizes the temporary 3D scene data.
