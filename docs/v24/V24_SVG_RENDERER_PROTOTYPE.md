# V24 SVG 2D Renderer Prototype

This patch starts the new 2D rendering path beside the current viewer.

## It replaces

- `addons/essam-core/v23/bootstrap/V23DocumentPackageBootstrap.js`

The replacement only adds safe accessors:

- `getCurrentPackage()`
- `getCurrentModel()`
- `getCurrentPackageStats()`

## It adds

- `addons/essam-core/v24/renderers/svg2d/SvgPageCompiler.js`
- `addons/essam-core/v24/bootstrap/V24SvgRendererBootstrap.js`

## index.html

Load V24 after V23:

```html
<script type="module" src="./addons/essam-core/v23/bootstrap/V23DocumentPackageBootstrap.js"></script>
<script type="module" src="./addons/essam-core/v24/bootstrap/V24SvgRendererBootstrap.js"></script>
```

## Important

V24 does not replace the current PDF/CAD 2D viewer.
It creates a debug SVG preview from the V23 Document Package.

## Console checks

```js
window.__essamV24.getSummary()
window.__essamV24.estimateCurrentPageSvg()
window.__essamV24.showSvgPreview({ maxEntities: 25000 })
window.__essamV24.downloadCurrentPageSvg({ maxEntities: 50000 })
```

For full SVG export:

```js
window.__essamV24.downloadCurrentPageSvg({ full: true })
```

Use full carefully on huge files.
