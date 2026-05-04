# V18.7 PDF Geometry Legacy Fallback

This replaces only:

`addons/cad-toolkit/core/PdfGeometryRefreshBridge.js`

## Why
V18.4-V18.6 tried to force geometry refresh after PDF load. That caused recursion or over-suppression.

V18.7 removes forced refresh timers and event suppression. It patches `CADLayerKit.extractFromScene` only for PDF contexts and restores the old V9-style scene geometry extraction path.

## Expected console
After opening a PDF page and calling layer refresh, you should see:

`[PdfGeometryRefreshBridge V18.7] PDF legacy scene geometry extracted`

with a non-zero entity count.

## Manual check

```js
window.__essamPdfGeometryRefreshBridgeV18_7.getSummary()
window.__essamPdfGeometryRefreshBridgeV18_7.refreshNow()
```

`lastGood.entityCount` should become greater than 0 once the PDF scene is ready.
