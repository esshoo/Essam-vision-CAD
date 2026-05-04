# V25.1 Apply Edits on Load

This patch replaces:

- `addons/essam-core/v25/core/DeltaEditStore.js`
- `addons/essam-core/v25/bootstrap/V25DeltaEditBootstrap.js`

## Goal

Saved edits are automatically loaded and applied after V24 SVG previews render.

## New APIs

```js
await window.__essamV25.loadAndApplyEditsFromIndexedDb()
await window.__essamV25.autoLoadAndApplyEdits()
window.__essamV25.wrapV24PreviewFunctions()
window.__essamV25.setAutoApply(true)
window.__essamV25.setAutoLoad(true)
window.__essamV25.resetLoadedEditCache()
```

## Test

1. Save edits with V25.0 or V25.1.
2. Hard refresh.
3. Open same file.
4. Run V23 conversion.
5. Render V24 SVG preview.
6. The saved hidden/deleted entities should disappear automatically.
