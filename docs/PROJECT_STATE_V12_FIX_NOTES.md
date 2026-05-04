# Project State V12 Fix

Fixes the bug where runtime drawing layers such as `✏️ Pen` were sent to x-viewer as if they were source model layers.

## Key changes

- `LayerRulesPanel` separates source model layers, runtime entity layers, and drawing/annotation layers.
- Refreshing the layer panel is now read-only for `EntityRegistry`.
- Checkbox visibility changes are the only place where a layer hide/show is applied to `EntityRegistry`.
- Runtime layers are no longer passed to `model.setLayerVisible`, preventing `[Viewer] Layer '✏️ Pen' not found from modelData!`.
- This prevents refresh events from undoing hide/delete/move operations.

## Install

Copy these files over V11, then hard refresh the browser:

- `addons/cad-toolkit/ui/LayerRulesPanel.js`
- `addons/cad-toolkit/core/ProjectState.js`
- `addons/cad-toolkit/ui/EntityLayerEditor.js`
