# V21.6.1 Default Hide Dropdown Fix

This patch fixes V21.6 behavior.

## Fixes

- Removes the separate `3D` checkbox injected beside every layer.
- Uses the existing layer type dropdown.
- Heavy/plain layers are set to `Hide` by default.
- The user can manually change the dropdown to `Lines`, `Walls`, `Glass`, etc. to include the layer in 3D.
- Fixes `SceneBuilder.js: this.isMobileOrVR is not a function`.

## Files

- `addons/cad-toolkit/CADSceneExporter.js`
- `addons/cad-toolkit/renderers/three/SceneBuilder.js`
- `addons/cad-toolkit/core/Layer3DVisibilityPatch.js`
