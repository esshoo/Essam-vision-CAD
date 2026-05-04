# V24.3.1 SVG Coordinate Toggle

Fixes inverted progressive preview by adding a persistent coordinate mode toggle.

## Default

`normalized-flip-y`

## Commands

```js
window.__essamV24.setCoordinateMode('normalized-flip-y')
window.__essamV24.setCoordinateMode('normalized')
window.__essamV24.toggleCoordinateMode()
```

## Quick preview

```js
window.__essamV24.showSvgPreviewFlipped({ maxEntities: 50000 })
window.__essamV24.showSvgPreviewNormal({ maxEntities: 50000 })
```

## Progressive

```js
await window.__essamV24.showSvgProgressivePreviewFlipped({ maxEntities: 160000 })
await window.__essamV24.showSvgProgressivePreviewNormal({ maxEntities: 160000 })
```
