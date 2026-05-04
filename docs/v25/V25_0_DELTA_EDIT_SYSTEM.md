# V25.0 Delta Edit System

This patch adds:

- `addons/essam-core/v25/core/DeltaEditStore.js`
- `addons/essam-core/v25/bootstrap/V25DeltaEditBootstrap.js`

## Load order

Add after V24:

```html
<script type="module" src="./addons/essam-core/v25/bootstrap/V25DeltaEditBootstrap.js"></script>
```

## Safe scope

V25 stores edits by entity ID only.

It does not mutate:

- original PDF/DXF
- old EntityRegistry
- V23 base entities

## Test

```js
window.__essamV23.convertCurrentRegistry()
await window.__essamV24.showSvgProgressivePreviewFlipped({ maxEntities: 160000 })
// select entities in SVG
window.__essamV25.hideSelectedAsEdit()
window.__essamV25.getEdits()
window.__essamV25.undo()
window.__essamV25.redo()
await window.__essamV25.saveEditsToIndexedDb()
```
