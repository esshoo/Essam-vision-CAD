# V21.6 - 3D Default Hidden Layers + Manual/Progressive 3D Visibility

## Goal
Keep the performance gain from V21.5 without permanently removing drafting layers from 3D.

Plain drafting layers such as:

- lines
- line
- default
- annotation
- text
- image

are now hidden by default in 3D only. They remain available and can be enabled manually.

## Files
Replace:

- `addons/cad-toolkit/CADSceneExporter.js`
- `addons/cad-toolkit/renderers/three/SceneBuilder.js`

Add:

- `addons/cad-toolkit/core/Layer3DVisibilityPatch.js`

## index.html
Add this after V21PerformanceStabilizer and before LayerRulesPanel if possible:

```html
<script type="module" src="./addons/cad-toolkit/core/Layer3DVisibilityPatch.js"></script>
```

## What changed

- `visible` remains the 2D visibility flag.
- `visible3D` is the new 3D-only visibility flag.
- Plain drafting layers get `visible3D: false` by default.
- Structural layers such as walls/floor/ceiling/glass/lights stay `visible3D: true` by default.
- Layer panel rows are augmented with a small `3D` checkbox without replacing LayerRulesPanel.
- Enabling heavy layers progressively is available through:

```js
window.__essam3DLayerVisibilityV21_6.enableLayers3DProgressively(["Layer A", "Layer B"])
```

This is designed for later phone/VR integration where heavy layers should be enabled in batches.

## Verification

```js
await fetch("./addons/cad-toolkit/CADSceneExporter.js?x=" + Date.now())
  .then(r => r.text())
  .then(t => t.match(/V29|3D Default Hidden/g))
```

```js
window.__essam3DLayerVisibilityV21_6.getSummary()
```

```js
window.__essamCADSceneExporterV29.getPerformanceSummary()
```
