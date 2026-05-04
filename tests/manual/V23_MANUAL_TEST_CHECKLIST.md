# V23 Manual Test Checklist

- [ ] Open PDF page 1.
- [ ] Wait for EntityRegistry ready.
- [ ] `window.__essamV23.getSummary()` returns installed true.
- [ ] `window.__essamV23.convertCurrentRegistry()` returns pages/layers/entities.
- [ ] `window.__essamV23.getVirtualPackageFiles()` lists project/data files.
- [ ] `await window.__essamV23.saveCurrentPackageToIndexedDb()` returns ok true.
- [ ] Current 2D viewer remains unchanged.
- [ ] Current 3D button behavior remains unchanged.
