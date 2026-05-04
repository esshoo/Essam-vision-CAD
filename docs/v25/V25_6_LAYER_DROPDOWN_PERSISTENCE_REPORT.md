# V25.6 Layer Dropdown Polish + Edit Persistence Report

This patch replaces:

- `addons/essam-core/v25/core/DeltaEditStore.js`
- `addons/essam-core/v25/bootstrap/V25DeltaEditBootstrap.js`

## Adds

- Better toolbar layer selector using a `<select>` for existing layers and an input for new layer names.
- Layer options report:

```js
window.__essamV25.getLayerMoveOptions()
```

- Toolbar target helper:

```js
window.__essamV25.setToolbarTargetLayer('TEST-MOVED')
```

- Persistence report:

```js
await window.__essamV25.getEditPersistenceReport()
await window.__essamV25.saveEditsAndGetReport()
await window.__essamV25.loadEditsAndGetReport()
await window.__essamV25.exportEditPersistenceReport()
```

## Goal

Make it easier to choose the layer destination and verify that edits are saved, loaded, and applied correctly.
