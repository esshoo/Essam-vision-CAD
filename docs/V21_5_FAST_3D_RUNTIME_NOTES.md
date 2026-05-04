# V21.5 Fast 3D Runtime Patch

This patch targets the remaining lag after V21.4.

## Files

- `addons/cad-toolkit/CADSceneExporter.js` -> V28
- `addons/cad-toolkit/renderers/three/SceneBuilder.js` -> V28

## What changed

### CADSceneExporter V28
- Skips plain 2D-only line layers in the 3D ViewModel when their rule type is `lines`, `line`, `default`, `annotation`, `text`, or `image`.
- Keeps the original EntityRegistry untouched.
- Merges massive buildable layers more aggressively before sending them to SceneBuilder.
- Keeps V27 cache and duplicate removal.

### SceneBuilder V28
- Removes expensive per-geometry `computeVertexNormals()` calls.
- Disables snap point collection for massive builds by default.
- Caps generated light candidates.
- Disables shadows for massive builds by default.
- Disposes previous 3D scene geometry/materials before rebuilding.
- Adds build timing stats:
  - `preprocessMs`
  - `entityLoopMs`
  - `flushMs`
  - `totalMs`

## Debug

After opening 3D:

```js
window.__essamCADSceneExporterV28.getPerformanceSummary()
window.__essamLastSceneBuilderStats
```

## Runtime knobs

Before opening 3D, you can override:

```js
window.__essamSceneBuilderConfig = {
  disableSnapPointsForMassive: true,
  disableShadowsForMassive: true,
  maxLightCandidates: 650,
  maxSnapPoints: 16000
};

window.__essamCADSceneExporterV28?.setPerformanceConfig?.({
  skipPlainLineLayersIn3D: true,
  mergeAllMassiveBuildableLayers: true
});
```
