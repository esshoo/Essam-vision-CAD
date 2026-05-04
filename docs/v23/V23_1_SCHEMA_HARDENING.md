# V23.1 Schema Hardening + Size Reports

This patch keeps V23 side-by-side and does not change the current viewer.

## Main changes

- `downloadDebugJson()` now downloads a lightweight manifest instead of one huge package JSON.
- `downloadFullDebugJson()` is available only when the full heavy debug file is needed.
- `getPackageSizeReport()` shows package size by virtual file.
- `saveCurrentPackageChunkedToIndexedDb()` stores large pages/entities in separate IndexedDB records.
- Converter records bridge diagnostics and source counts in package warnings.

## Recommended test

```js
window.__essamV23.convertCurrentRegistry()
window.__essamV23.getPackageSizeReport()
window.__essamV23.downloadManifest()
await window.__essamV23.saveCurrentPackageChunkedToIndexedDb()
```
