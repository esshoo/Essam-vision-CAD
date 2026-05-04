# V24.4 Layer-aware SVG Viewer

This patch replaces:

- `addons/essam-core/v24/renderers/svg2d/SvgPageCompiler.js`
- `addons/essam-core/v24/bootstrap/V24SvgRendererBootstrap.js`

## Goal

Turn V24 SVG preview into a layer-aware SVG viewer prototype.

## Adds

- Every layer is already grouped as `<g class="essam-layer" data-layer="...">`.
- Adds a layer sidebar in the SVG preview overlay.
- Adds APIs:

```js
window.__essamV24.getSvgDomLayerStats()
window.__essamV24.hideSvgLayer("layer name")
window.__essamV24.showSvgLayer("layer name")
window.__essamV24.toggleSvgLayer("layer name")
window.__essamV24.isolateSvgLayer("layer name")
window.__essamV24.showAllSvgLayers()
window.__essamV24.hideAllSvgLayers()
window.__essamV24.refreshSvgLayerPanel()
```

## Test

```js
window.__essamV23.convertCurrentRegistry()
await window.__essamV24.showSvgProgressivePreviewFlipped({ maxEntities: 160000 })
window.__essamV24.getSvgDomLayerStats()
```

Then use the layer sidebar or console commands.

## Scope

This is still a prototype overlay. It does not replace the current PDF/CAD viewer yet.
