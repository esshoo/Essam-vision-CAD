# V21.1 Performance Cleanup

This patch focuses on the real bottlenecks shown in the latest logs.

## Fix 1 — PDF recursion source removed

`PdfGeometryRefreshBridge.js` no longer wraps `CADLayerKit.extractFromViewer()`.

The wrapper caused this loop:

```text
extractFromViewer
→ cad:entity-registry-ready
→ EntityLayerEditor.refreshLayerOptions
→ getCurrentLayerNames
→ extractFromViewer again
→ Maximum call stack size exceeded
```

V18.9 keeps direct PDF scene registry building, but makes it event-based only.

## Fix 2 — PDF direct registry rebuild coalescing

Previous V18.8 could rebuild direct PDF geometry multiple times for:

- `cad:file-loaded`
- `cad:content-recognition-ready`
- page change

V18.9 coalesces pending rebuilds to one scheduled run per event group.

## Fix 3 — Quota-safe persistence

`ProjectPersistence.js` V21.1 no longer stores huge full registries in localStorage.
For large PDFs, it saves only edit deltas:

- deleted entities
- hidden entities
- moved-layer entities
- selected/locked if needed

This prevents:

```text
QuotaExceededError: Setting the value of essam-project-state... exceeded the quota
```

## Install

Replace:

```text
addons/cad-toolkit/core/PdfGeometryRefreshBridge.js
addons/cad-toolkit/core/ProjectPersistence.js
```

Keep `V21PerformanceStabilizer.js` installed.
