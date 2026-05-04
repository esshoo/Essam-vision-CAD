# V23 Testing

Manual tests for V23.0:

1. Open a known PDF or DXF in the current app.
2. Wait until EntityRegistry is ready.
3. Run:

```js
window.__essamV23.convertCurrentRegistry()
```

4. Check:

```js
window.__essamV23.getSummary()
window.__essamV23.getVirtualPackageFiles()
```

5. Save to IndexedDB:

```js
await window.__essamV23.saveCurrentPackageToIndexedDb()
```

6. Download debug JSON:

```js
window.__essamV23.downloadDebugJson()
```

This test must not change the current viewer.
