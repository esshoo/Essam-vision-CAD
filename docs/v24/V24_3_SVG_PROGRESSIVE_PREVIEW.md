# V24.3 SVG Progressive Preview

## Changes
- Default coordinate mode changed to `normalized` because the tested PDF appears correctly oriented without Y flip.
- `normalized-flip-y` remains available per file if needed.
- Adds layer stats:

```js
window.__essamV24.getCurrentPageLayerStats()
```

- Adds progressive preview:

```js
await window.__essamV24.showSvgProgressivePreview({ maxEntities: 160000 })
```

## Notes
This still uses the debug overlay. It does not replace the current viewer.
