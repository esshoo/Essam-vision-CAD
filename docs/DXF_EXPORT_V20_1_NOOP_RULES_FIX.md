# DXF Export V20.1 - No-op rules fix

This patch replaces only:

`addons/cad-toolkit/core/ProjectExporter.js`

## Problem found in V20

`debugDXFMatch()` returned:

`reason: source-passthrough-no-edits`

but the toolbar export still wrote a source-patched file, because `LayerRulesPanel` passed display/3D rules into DXF export.
Those rules were treated as destructive edits, so the exporter modified the original file even when the user made no entity edits.

## Fix

For source-preserving DXF export:

- Ignore LayerRulesPanel rules.
- Only these EntityRegistry states count as destructive DXF edits:
  - `deleted === true`
  - `visible === false`
  - `layer !== originalLayer`

No-op export now downloads the original DXF text unchanged even when LayerRulesPanel has rules.

## Test

After replacing `ProjectExporter.js`, hard refresh and run:

```js
await fetch("./addons/cad-toolkit/core/ProjectExporter.js?x=" + Date.now())
  .then(r => r.text())
  .then(t => t.match(/V20\.1|ProjectExporter V20\.1/g))
```

Then open `chandelier.dxf`, make no edits, and export. Console should show:

`[ProjectExporter V20.1] Original DXF passthrough exported`
