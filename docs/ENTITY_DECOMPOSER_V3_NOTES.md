# Entity Decomposer V3 Notes

## Goal

This version starts the real transition from layer-level control to entity-level control.

Before this step, a file could be detected as `Source=model-layers`, but one layer could still behave like one large object.
This version introduces a decomposition stage that turns large viewer objects into small selectable engineering entities.

## New core files

- `addons/cad-toolkit/core/EntityDecomposer.js`
- `addons/cad-toolkit/core/EntityRegistry.js`
- `addons/cad-toolkit/core/LayerManager.js`

## What changed

### ViewerModelAdapter

`ViewerModelAdapter.collectLayerObjects()` now flattens drawable children.

This matters because some viewers expose a layer as one parent object or group, while the real lines/meshes are inside its children.

### EntityDecomposer

The decomposer turns viewer geometry into selectable entities:

- `LineSegments` -> one `LINE` entity per segment.
- `Line` / `LineLoop` -> one `LINE` entity per edge.
- `Mesh` -> `MESH_EDGE` entities, with duplicate mesh edge filtering.
- Recognized PDF text/image entities are normalized as selectable semantic entities.

### EntityRegistry

The registry is the runtime index for selection/editing.

It supports early APIs for:

- `select(id)`
- `selectMany(ids)`
- `clearSelection()`
- `hide(id)`
- `delete(id)`
- `moveToLayer(id, layerId)`
- `getByLayer(layerId)`
- `getStats()`

### LayerManager

A thin data-layer manager was added for future UI work.

It is not yet the main UI source, but it gives the next step a clean layer API.

## Runtime debug globals

After opening a file and extracting layers, check:

```js
window.__essamDocumentModel
window.__essamEntityRegistry
window.__essamLayerManager
```

Useful tests:

```js
window.__essamEntityRegistry.getStats()
window.__essamEntityRegistry.getByLayer("0").slice(0, 5)
window.__essamDocumentModel.getStats()
```

## Important note

This version does not yet rebuild `EntityLayerEditor.js` UI.

The goal of this step is to make the data layer correct first.
The next safe step is to connect entity selection UI to `EntityRegistry` and later `SelectionEngine`.

## Expected result

A layer that used to behave like one big element should now produce many entities if its geometry contains many segments or mesh edges.
