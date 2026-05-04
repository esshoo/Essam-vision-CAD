# V24.2 SVG Coordinate Normalization + Balanced Layer Preview

Replaces:

- `addons/essam-core/v24/renderers/svg2d/SvgPageCompiler.js`
- `addons/essam-core/v24/bootstrap/V24SvgRendererBootstrap.js`

## Fixes

V24.1 fixed the tiny-square/outlier bounds issue, but the preview could still appear vertically flipped and incomplete.

V24.2 adds:

- normalized SVG coordinates
- default Y-axis flip using `coordinateMode: "normalized-flip-y"`
- robust bounds remain default
- balanced preview limiting across layers instead of first-N truncation
- additional diagnostics in SVG stats

## Main commands

```js
window.__essamV23.convertCurrentRegistry()
window.__essamV24.diagnoseCurrentPageSvg()
window.__essamV24.showSvgPreview({ maxEntities: 25000 })
window.__essamV24.showSvgFullCoveragePreview({ maxEntities: 50000 })
```

## Debug modes

Raw view, only for diagnostics:

```js
window.__essamV24.showSvgPreview({
  maxEntities: 25000,
  coordinateMode: "raw",
  boundsMode: "raw",
  skipOutsideRobustBounds: false
})
```

If the preview is upside down, compare:

```js
window.__essamV24.showSvgPreview({ coordinateMode: "normalized" })
window.__essamV24.showSvgPreview({ coordinateMode: "normalized-flip-y" })
```

## Expected result

- The page should no longer appear as a tiny square.
- The preview should no longer be vertically flipped by default.
- The 25k/50k preview should include representation from all layers, not just the first chunk of entities.
