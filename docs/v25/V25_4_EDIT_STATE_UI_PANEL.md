# V25.4 Edit State UI Panel

Adds a small floating UI panel for the V25 delta edit system.

## New APIs

```js
window.__essamV25.showEditPanel()
window.__essamV25.hideEditPanel()
window.__essamV25.toggleEditPanel()
window.__essamV25.refreshEditPanel()
window.__essamV25.getEditPanelSummary()
```

## Panel actions

- Undo
- Redo
- Apply
- Save
- Load
- Export
- Verify moves
- Clear

## Scope

Still safe. It only controls V25 delta edits and does not modify the original file.
