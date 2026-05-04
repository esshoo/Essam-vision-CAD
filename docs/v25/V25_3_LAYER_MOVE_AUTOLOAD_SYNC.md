# V25.3 Layer Move Auto-load + Panel Sync

Replaces:

- `addons/essam-core/v25/core/DeltaEditStore.js`
- `addons/essam-core/v25/bootstrap/V25DeltaEditBootstrap.js`

## Adds

- stronger diagnostics for `movedLayer`
- move application report
- DOM verification for moved entities
- refresh layer panel after applying edits
- `essam:v25:edits-applied` event

## New commands

```js
window.__essamV25.getMovedLayerReport()
window.__essamV25.verifyLayerMoveApplication()
```

## Test

```js
window.__essamV25.moveSelectedToLayerAsEdit("TEST-MOVED")
await window.__essamV25.saveEditsToIndexedDb()
window.__essamV25.getMovedLayerReport()
window.__essamV25.verifyLayerMoveApplication()
```

Then hard refresh and render SVG again. V25 should auto-load and reapply the moves.
