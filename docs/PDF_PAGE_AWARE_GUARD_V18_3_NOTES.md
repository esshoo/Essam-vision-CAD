# V18.3 PDF Page-Aware Guard

This patch replaces:

`addons/cad-toolkit/core/EmptyExtractionGuard.js`

## Problem fixed

V18.2 protected the last good EntityRegistry globally. That is good for DXF refresh bugs, but bad for multi-page PDF files.

When the user changes a PDF page, the old page registry/render can be kept alive and the new page may not get its own layer extraction.

## V18.3 behavior

- The guard now keys the last good registry by:
  - file name
  - file size
  - PDF page number
- On `cad:pdf-page-changed`, it temporarily allows page-specific extraction instead of restoring the previous page registry.
- Idle managed render is force-disabled during PDF page changes so the previous page managed render cannot cover the new page.
- After the new page settles, the guard can capture that page's own registry.

## Test

1. Open a multi-page PDF.
2. Wait until page 1 layers appear.
3. Move to page 2.
4. Layers should update for page 2.
5. Move back to page 1.
6. Page 1 cache may be restored if available.

Console:

```js
window.__essamEmptyExtractionGuardV18_3.getSummary()
window.__essamIdleManagedRenderGuardV18_3.getSummary()
```
