# V22.2 PDF Page Lifecycle Manager

Adds `addons/cad-toolkit/core/PdfPageLifecycleManager.js`.

## Purpose

- Stabilize PDF multi-page navigation.
- Reduce blank-page cases after page 3+.
- Re-assert the current page after ContentRecognition, which may emit stale page events.
- Hide PDF page navigation controls inside the 3D overlay.
- Do not replace `CADViewer_app.js`, so existing ContentRecognition and PDF loader logic is preserved.

## Install

Add this script after `PdfGeometryRefreshBridge.js` and before UI panels:

```html
<script type="module" src="./addons/cad-toolkit/core/PdfPageLifecycleManager.js"></script>
```

## Debug

```js
window.__essamPdfPageLifecycleV22_2.getSummary()
window.__essamPdfPageLifecycleV22_2.refreshCurrentPage()
window.__essamPdfPageLifecycleV22_2.setDebug(true)
```
