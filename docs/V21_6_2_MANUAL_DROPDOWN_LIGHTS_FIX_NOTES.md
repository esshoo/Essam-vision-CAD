# V21.6.2 Manual Dropdown + Lights Fix

This patch fixes two regressions from V21.6.1:

1. Heavy layers were auto-hidden again after the user changed the existing dropdown from Hide to Lines/Walls/Light/etc.
2. Light layers could be treated as normal geometry if a layer type was `light` instead of `lights`, causing only the global sun/one light behavior to appear.

## Behavior

- No separate 3D checkbox is used.
- The existing type dropdown controls 3D inclusion.
- Heavy/plain layers are defaulted to `Hide` once.
- If the user changes a layer from `Hide` to another type, that manual choice is respected.
- `light` and `lights` are normalized to the same 3D light behavior.

## Files

- addons/cad-toolkit/CADSceneExporter.js
- addons/cad-toolkit/renderers/three/SceneBuilder.js
- addons/cad-toolkit/core/Layer3DVisibilityPatch.js

## Useful console commands

```js
window.__essam3DLayerVisibilityV21_6_2.getSummary()
window.__essam3DLayerVisibilityV21_6_2.resetAutoHideForLayer("Layer Name")
window.__essam3DLayerVisibilityV21_6_2.resetAllAutoHide()
```
