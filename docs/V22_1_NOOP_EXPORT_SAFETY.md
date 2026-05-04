# V22.1 No-op Export Safety

This patch replaces:

`addons/cad-toolkit/core/ProjectExporter.js`

## Goal

If the user opens a PDF or DXF and makes no destructive edits, export the original uploaded file bytes unchanged.

This fixes the trust baseline:

- Open file
- Make no changes
- Export
- Output must be the same source file content, not a rebuilt approximation

## What counts as a real edit

Only EntityRegistry destructive edits:

- `deleted === true`
- `visible === false` on individual entity
- layer moved from original layer

Layer panel view rules are ignored for no-op source passthrough.

## Console checks

```js
await window.ProjectExporter.debugNoopExportSafety()
```

Expected no-edit result:

```js
{
  noEdits: true,
  hasSourceFile: true,
  willPassthroughOriginalBytes: true
}
```

For DXF:

```js
await window.ProjectExporter.debugDXFMatch()
```

Expected no-edit reason:

```js
reason: "source-passthrough-no-edits"
```
