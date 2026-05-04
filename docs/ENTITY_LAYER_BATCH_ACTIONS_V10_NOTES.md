# Entity Layer Batch Actions V10

## Main fixes

- Single entity selection remains data-driven through EntityRegistry.
- Added full-layer actions from the selected entity/entities:
  - Select full layer/layers.
  - Move selected full layer/layers to the chosen target layer.
  - Hide selected full layer/layers.
  - Delete selected full layer/layers.
- Multi-selection from different layers can now be moved/hidden/deleted as one operation.
- Undo snapshots now include both legacy edits and EntityRegistry state.
- Restore All no longer creates a confusing new undo entry.
- Restore All no longer touches viewer/helper/background objects outside editable CAD source objects.
- When EntityRenderBridge is active, original x-viewer objects remain hidden after restore/apply edits to avoid double rendering or visual background changes.

## Test checklist

1. Open `chandelier.dxf`.
2. Enable entity selection.
3. Click one entity and confirm `selectedCount: 1`.
4. Use "تحديد كامل طبقة المحدد" and confirm selected count increases to all visible entities in that layer.
5. Select entities from two different layers and move them to a target layer.
6. Select entities from two different layers and hide/delete them.
7. Use Restore All and confirm it clears hidden/deleted without changing background/helper visuals and without enabling Undo as a new operation.
