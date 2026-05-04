# Entity Selection State V9

Goal: stabilize the first real success of V8.

V8 proved that per-entity rendering allows deleting one visible entity without deleting the whole layer.
V9 fixes the next issue: the visual selection could show one entity while `EntityRegistry.selectedIds` still kept older IDs from a previous multi/box selection.

Changes:

- `EntityRegistry.replaceSelection(ids)` added.
- `EntityRegistry.pruneSelection()` added.
- `EntityRegistry.selectMany()` now deduplicates IDs.
- Single click in `EntityLayerEditor` now means exactly one selected core entity.
- Additive selection still works with Shift/Ctrl/Meta.
- Hide/Delete now use a snapshot of selected entries and force cleanup after mutation.

Expected after a normal single click:

```js
window.__essamEntityRegistry.getStats().selectedCount
// 1
```

Expected after Delete/Hide:

```js
window.__essamEntityRegistry.getStats().selectedCount
// 0
```

If you intentionally use box select, selectedCount may be greater than 1.
