# V21.2 Persistence Delta-only Fix

This patch replaces only:

```text
addons/cad-toolkit/core/ProjectPersistence.js
```

## Why
V21.1 still attempted to save very large payloads for heavy PDFs. Logs showed payload sizes around 9MB to 11MB and repeated localStorage quota warnings.

## What changed
- Do not spread old saved state into the new payload.
- Save PDF and large drawings as registry deltas only.
- Do not treat every entity as moved when `originalLayer` is missing.
- Compact layer rules before saving.
- Throttle quota warnings.
- Add `clearHeavyLegacy()` to remove old oversized localStorage entries.

## Test
After installing:

```js
window.__essamProjectPersistence.getSummary()
```

For heavy PDF files, expected:

```js
registryMode: "delta"
registryDeltaCount: 0 // if no real edits
```

If old huge state exists:

```js
window.__essamProjectPersistence.clearHeavyLegacy()
```
