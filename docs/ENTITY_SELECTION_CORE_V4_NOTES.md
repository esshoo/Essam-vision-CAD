# Entity Selection Core V4 Notes

## Purpose
This version confirms that the project can produce a real entity registry from model layers, then adds the first data-first selection core.

## Important test result
A DXF such as `chandelier.dxf` can produce:

- 4 layers
- 1819 entities
- Source = model-layers

This means the file is no longer treated as a few large layer objects only. It is decomposed into individual engineering entities.

## Why `getByLayer("0")` may return an empty array
The file may not contain a layer named `0`. Use these helpers instead:

```js
window.__essamEntityRegistry.printLayerSummary()
window.__essamEntityRegistry.getLayerNames()
window.__essamEntityRegistry.getFirstLayerEntities(5)
window.__essamEntityRegistry.getSampleEntities(5)
```

If you know part of a layer name:

```js
window.__essamEntityRegistry.getByLayerSmart("wall").slice(0, 5)
```

## New file

```txt
addons/cad-toolkit/core/SelectionEngine.js
```

## New globals for debugging

```js
window.__essamSelectionEngine
```

## SelectionEngine V1 API

```js
window.__essamSelectionEngine.getDebugSummary()
window.__essamSelectionEngine.selectById(entityId)
window.__essamSelectionEngine.getSelected()
window.__essamSelectionEngine.clear()
```

Model-space point selection:

```js
window.__essamSelectionEngine.queryAtPoint({ x: 10, y: 20 }, { tolerance: 8 })
window.__essamSelectionEngine.selectAtPoint({ x: 10, y: 20 }, { tolerance: 8 })
```

Box selection:

```js
window.__essamSelectionEngine.queryInBox({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
window.__essamSelectionEngine.selectInBox({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
```

## Current scope
This version does not yet redraw hidden/deleted entities in the viewer. It prepares the data layer and selection layer first.

## Next step
Build the 2D interaction bridge:

- Convert mouse/touch/pen screen coordinates to model coordinates.
- Call SelectionEngine instead of selecting raw Three.js objects.
- Then apply hide/delete/move through EntityRegistry and LayerManager.
