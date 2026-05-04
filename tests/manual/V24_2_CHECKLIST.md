# V24.2 Manual Checklist

1. Open a heavy PDF.
2. Run:

```js
window.__essamV23.convertCurrentRegistry()
window.__essamV24.diagnoseCurrentPageSvg()
window.__essamV24.showSvgPreview({ maxEntities: 25000 })
```

3. Expected:
   - Preview is not tiny.
   - Preview is not upside down.
   - Multiple layers/details appear.

4. Try:

```js
window.__essamV24.showSvgFullCoveragePreview({ maxEntities: 50000 })
```

5. Check stats:

```js
window.__essamV24.getSummary().lastPreview.stats
```

Look for:

- `coordinateMode: "normalized-flip-y"`
- `limitStrategy: "balanced-by-layer"`
- `skippedAsOutliers`
- `outputEntities`
