# Entity Render Bridge V6

## Why
Some DXF/PDF layers are exposed by the viewer as one large visual object even after EntityRegistry decomposes them into many entities. This means selection data can be correct while visual hide/delete still appears linked.

## What changed
- Added `core/EntityRenderBridge.js`.
- When entity selection mode is enabled, the editor hides the original viewer objects and draws a managed line layer from `EntityRegistry`.
- Hide/delete/move operations rebuild the managed layer from the registry.
- Original viewer objects are restored when selection mode is disabled.

## Debug
After opening a file and enabling entity selection:

```js
window.__essamEntityRenderBridge.getDebugSummary()
window.__essamScreenSelectionBridge.getDebugSummary()
```

Expected:
- `enabled: true`
- `managedChildren` equals number of drawn layers with visible entities
- `hiddenOriginals` greater than 0 for decomposed DXF/PDF geometry

## Scope
V6 focuses on geometry line entities. Text/image rendering still needs a later dedicated bridge.
