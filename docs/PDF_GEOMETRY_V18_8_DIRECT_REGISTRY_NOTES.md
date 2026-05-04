# V18.8 PDF Direct Scene Registry

This patch replaces:

`addons/cad-toolkit/core/PdfGeometryRefreshBridge.js`

## Why

V18.7 worked when `CADLayerKit` could read `model-layers` directly, but some multi-page PDFs did not trigger geometry extraction after page changes and left:

`layerCount: 0, entityCount: 0`

## What changed

V18.8 reads the current PDF page geometry directly from the THREE scene and builds a lightweight EntityRegistry for that PDF page.

It does not call `CADLayerKit.extractFromViewer()` inside the direct refresh path, so it avoids the recursion that caused:

`Maximum call stack size exceeded`

## Test

After opening or changing a PDF page:

```js
window.__essamPdfGeometryRefreshBridgeV18_8.getSummary()
```

Manual extraction:

```js
window.__essamPdfGeometryRefreshBridgeV18_8.refreshNow()
```

Expected:

- `successCount > 0`
- `lastGood.entityCount > 0`
- `window.__essamEntityRegistry.getStats().entityCount > 0`
