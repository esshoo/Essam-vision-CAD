# V25.5 SVG Edit Toolbar Integration

Replaces:

- `addons/essam-core/v25/core/DeltaEditStore.js`
- `addons/essam-core/v25/bootstrap/V25DeltaEditBootstrap.js`

## Goal

Move the most common V25 edit operations from console/panel into the SVG preview itself.

## Adds

A toolbar inside the V24 SVG preview with:

- selected count
- hidden/deleted/moved counters
- Hide selected
- Delete selected
- Restore selected
- Move selected to layer
- Undo
- Redo
- Save
- Load
- Panel

## APIs

```js
window.__essamV25.ensureSvgEditToolbar()
window.__essamV25.showSvgEditToolbar()
window.__essamV25.hideSvgEditToolbar()
window.__essamV25.toggleSvgEditToolbar()
window.__essamV25.refreshSvgEditToolbar()
window.__essamV25.getSvgEditToolbarSummary()
```

## Test

```js
window.__essamV23.convertCurrentRegistry()
await window.__essamV24.showSvgProgressivePreviewFlipped({ maxEntities: 160000 })
window.__essamV25.showSvgEditToolbar()
```

Then select entities and use toolbar buttons.
