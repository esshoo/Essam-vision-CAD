# PDF Geometry Refresh V18.6

This replaces only:

`addons/cad-toolkit/core/PdfGeometryRefreshBridge.js`

## Why V18.5 still failed

V18.5 blocked direct re-entry into `CADLayerKit.extractFromViewer`, but the remaining recursion was event-based:

`extractFromViewer -> cad:entity-registry-ready -> EntityLayerEditor/LayerRulesPanel -> extractFromViewer again`

This caused:

`RangeError: Maximum call stack size exceeded`

## What V18.6 changes

- Suppresses `cad:entity-registry-ready` and `cad:document-model-ready` while the forced PDF geometry extraction is running.
- Replays only one safe registry event asynchronously after extraction completes.
- Adds a short cooldown where follow-up panel/editor refresh calls receive the last good snapshot instead of starting a new extraction.
- Tracks PDF page from event details so page changes do not keep using page-1 context.

## Test

After hard refresh:

```js
window.__essamPdfGeometryRefreshBridgeV18_6.getSummary()
window.__essamPdfGeometryRefreshBridgeV18_6.refreshNow()
```

Expected: no `Maximum call stack size exceeded`.

If extraction still returns empty data, the recursion is fixed and the next step is to patch the PDF model extraction path itself.
