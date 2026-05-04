# V21.3 - 2D Layer Visibility Stabilizer

This patch focuses on 2D layer hide/show lag and visual instability.

## Files

- `addons/cad-toolkit/core/LayerVisibilityPerformancePatch.js`
- `addons/cad-toolkit/core/ProjectPersistence.js`

## Install

Load the new script after `V21PerformanceStabilizer.js` and before UI modules if possible:

```html
<script type="module" src="./addons/cad-toolkit/core/V21PerformanceStabilizer.js"></script>
<script type="module" src="./addons/cad-toolkit/core/LayerVisibilityPerformancePatch.js"></script>
```

## Why

Layer visibility in the layer panel should be view-only. Older patches could treat a layer hide as `entity.visible=false` for thousands of entities, causing:

- lag in 2D
- managed render toggling on/off
- visual confusion after hide/show
- huge persistence payloads

V21.3 separates layer panel visibility from real EntityRegistry edits.

## Console checks

```js
window.__essamLayerVisibilityPerformanceV21_3.getSummary()
window.__essamProjectPersistence.getSummary()
```

Repair flags created by older builds:

```js
window.__essamLayerVisibilityPerformanceV21_3.cleanLayerRuleVisibilityFlags()
```
