# V25.2 Move Entity To Layer as Delta

Replaces:
- `addons/essam-core/v25/core/DeltaEditStore.js`
- `addons/essam-core/v25/bootstrap/V25DeltaEditBootstrap.js`

## Adds

Move selected SVG entities to a different layer as a delta edit, without mutating original data.

## Commands

```js
window.__essamV25.getAvailableSvgLayers()
window.__essamV25.moveSelectedToLayerAsEdit('TARGET_LAYER_NAME')
window.__essamV25.moveIdsToLayerAsEdit(['entity-id'], 'TARGET_LAYER_NAME')
window.__essamV25.undo()
window.__essamV25.redo()
window.__essamV25.saveEditsToIndexedDb()
```

## Edits shape

```json
{
  "movedLayer": [
    { "id": "entity-id", "from": "old-layer", "to": "new-layer" }
  ]
}
```
