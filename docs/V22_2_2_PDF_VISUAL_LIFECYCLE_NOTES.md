# V22.2.2 PDF Visual Lifecycle Fix

Replaces:

`addons/cad-toolkit/core/PdfPageLifecycleManager.js`

## Fixes

- Avoids sending a second `cad:pdf-page-changed` event after the native PDF loader.
- Repairs blank PDF pages by forcing current page scene objects visible and re-fitting the viewport after page swap.
- Clears/rebuilds the 2D layer visibility index on page changes, then reapplies currently hidden view layers.
- Keeps PDF page controls hidden in 3D.

## Test

```js
window.__essamPdfPageLifecycleV22_2_2.getSummary()
window.__essamPdfPageLifecycleV22_2_2.refreshCurrentPage()
```
