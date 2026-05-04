# V24 Manual Test Checklist

1. Open a PDF or DXF.
2. Run:

```js
window.__essamV23.convertCurrentRegistry()
```

3. Run:

```js
window.__essamV24.estimateCurrentPageSvg()
```

4. Run:

```js
window.__essamV24.showSvgPreview({ maxEntities: 25000 })
```

5. Confirm:

- SVG preview opens.
- No current viewer breakage.
- Browser does not freeze.
- Layers are grouped as `<g data-layer="...">`.

6. Download capped SVG:

```js
window.__essamV24.downloadCurrentPageSvg({ maxEntities: 50000 })
```
