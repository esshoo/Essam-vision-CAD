# DXF Export V20 - Real No-op Passthrough

This is the real V20 patch.

It replaces only:

```text
addons/cad-toolkit/core/ProjectExporter.js
```

## Important verification

After installing, run:

```js
await fetch("./addons/cad-toolkit/core/ProjectExporter.js?x=" + Date.now())
  .then(r => r.text())
  .then(t => t.match(/V\d+|ProjectExporter V\d+/g))
```

Expected: `V20`.

## Main fix

If there are no real edits, export the original DXF unchanged.

Expected console/debug result:

```js
await window.ProjectExporter.debugDXFMatch()
// reason: "source-passthrough-no-edits"
```

## Real edits

V20 patches the source only when it detects:

- deleted geometry entity
- hidden geometry entity
- moved geometry entity to another layer
- explicit hidden layer rule

Untouched entities are no longer inserted into the edit index.
