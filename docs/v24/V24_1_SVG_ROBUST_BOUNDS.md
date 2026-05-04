# V24.1 SVG Robust Bounds Fix

Replaces:

- `addons/essam-core/v24/renderers/svg2d/SvgPageCompiler.js`
- `addons/essam-core/v24/bootstrap/V24SvgRendererBootstrap.js`

## Fix

V24.0 could show only a small square with a diagonal line when a few extreme PDF/CAD points made the SVG `viewBox` too large.

V24.1 adds:

- raw bounds report
- robust percentile bounds
- outlier skipping for preview
- safer point parsing
- `diagnoseCurrentPageSvg()`

## Test

```js
window.__essamV23.convertCurrentRegistry()
window.__essamV24.diagnoseCurrentPageSvg()
window.__essamV24.estimateCurrentPageSvg()
window.__essamV24.showSvgPreview({ maxEntities: 25000 })
```

If robust bounds clips too much, compare raw:

```js
window.__essamV24.showSvgPreview({ maxEntities: 25000, boundsMode: 'raw', skipOutsideRobustBounds: false })
```
