# PdfGeometryRefreshBridge V18.5

Fixes the V18.4 recursive extraction issue.

## Problem

V18.4 called `CADLayerKit.extractFromViewer()` directly. That extraction dispatches `cad:entity-registry-ready` synchronously. Then `EntityLayerEditor.onEntityRegistryReady()` called `refreshLayerOptions()`, which called `CADLayerKit.extractFromViewer()` again before the first extraction finished.

Result:

```text
RangeError: Maximum call stack size exceeded
```

## Fix

V18.5 installs a re-entry guard around `CADLayerKit.extractFromViewer()`.

If extraction is already running and another extraction is requested, it returns the current registry snapshot instead of starting a second extraction.

## Replace

```text
addons/cad-toolkit/core/PdfGeometryRefreshBridge.js
```

## Test

```js
window.__essamPdfGeometryRefreshBridgeV18_5.getSummary()
window.__essamPdfGeometryRefreshBridgeV18_5.refreshNow()
```

Expected: no `Maximum call stack size exceeded`.
