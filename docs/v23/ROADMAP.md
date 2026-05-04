# V23 Roadmap

## V23.0 Skeleton
- Add file structure.
- Add DocumentModel draft.
- Add Registry → DocumentPackage converter.
- Add IndexedDB store wrapper.
- No current app behavior changes.

Exit criteria:

```js
window.__essamV23.getSummary()
window.__essamV23.convertCurrentRegistry()
window.__essamV23.getVirtualPackageFiles()
```

## V23.1 Schema hardening
- Add strict validators.
- Add test fixtures.
- Add page bounds and units.

## V23.2 Package persistence
- Store package chunks in IndexedDB.
- Add package export/import.

## V24 SVG renderer
- Generate SVG page from package.
