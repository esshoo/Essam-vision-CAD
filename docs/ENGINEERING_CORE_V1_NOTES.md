# Engineering Core V1 Notes

This build starts moving Essam Vision CAD from a scene-first workflow to a model-first workflow.

## Main goal

The viewer still opens PDF / DWG / DXF normally, but layer extraction now tries to use x-viewer's internal model data first:

- `viewer.loadedModels`
- `model.layers`
- `model.getObjectsByLayer(layerName)`
- `model.setLayerVisible(layerName, visible)`

Only if that data is not available, the project falls back to the old Three.js scene traversal.

## New files

- `addons/cad-toolkit/core/ViewerModelAdapter.js`
- `addons/cad-toolkit/core/DocumentModel.js`
- `addons/cad-toolkit/core/SemanticLayerClassifier.js`

## Changed files

- `addons/cad-toolkit/CADLayerKit.js`
- `addons/cad-toolkit/viewer/CADViewer_app.js`
- `addons/cad-toolkit/ui/LayerRulesPanel.js`
- `addons/cad-toolkit/CADSceneExporter.js`
- `addons/cad-toolkit/renderers/three/SceneBuilder.js`
- `locales/ar.json`
- `locales/en.json`

## Runtime debug

After opening a file, check the browser console:

```js
window.__essamDocumentModel
window.cadApp.currentModel
window.cadApp.currentModels
```

`CADLayerKit` logs one of these extraction sources:

- `Source=model-layers` means the new path is working.
- `Source=scene-fallback` means the file/library did not expose model layer objects, so the old extraction path was used safely.

## Important

This is not the final SelectionEngine yet.
It is the first foundation step: make the project extract engineering layers and entity metadata from the viewer model before fixing selection, delete, move, and touch/pen workflows.
