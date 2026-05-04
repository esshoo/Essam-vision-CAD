# V24.5 SVG Entity Selection Prototype

This patch replaces:

- `addons/essam-core/v24/renderers/svg2d/SvgPageCompiler.js`
- `addons/essam-core/v24/bootstrap/V24SvgRendererBootstrap.js`

## Goal

Start selecting entities from the new SVG viewer instead of the old picking/rendered-scene path.

## Safe scope

This is preview-only. It does not modify:

- EntityRegistry
- Document Package
- edits.json
- original PDF/DXF

## New APIs

```js
window.__essamV24.getSelectedSvgEntities()
window.__essamV24.clearSvgSelection()
window.__essamV24.selectSvgEntity(id)
window.__essamV24.hideSelectedSvgEntities()
window.__essamV24.showPreviewHiddenSvgEntities()
window.__essamV24.deleteSelectedSvgEntitiesFromPreview()
window.__essamV24.zoomToSelectedSvgEntities()
```

Use Ctrl/Shift click for multi-select.
