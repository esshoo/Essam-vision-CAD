# V13 from stable V10 — Persist + Export

This patch intentionally returns to the stable V10 entity editing path.
It does not use the V11/V12 ProjectState approach that pushed runtime drawing layers into x-viewer modelData.

## What changed

- Added `ProjectPersistence.js`.
- Added `ProjectExporter.js`.
- Entity edits are auto-saved from `EntityLayerEditor`.
- `EntityRegistry` state is restored when a file/model is loaded again.
- `LayerRulesPanel` reads from `EntityRegistry` first, so deleted/hidden/moved entities affect:
  - layer panel
  - 3D preview
  - JSON export
  - DXF/PDF/DWG buttons
- Layer panel refresh is now read-only and does not overwrite entity edits.
- Runtime annotation layers such as `✏️ Pen` are never sent to `model.setLayerVisible`.

## Export

- DXF: exports visible, non-deleted registry entities as ASCII DXF LINE/TEXT entities.
- PDF: uses `window.PDFLib` if available. If unavailable, exports SVG fallback.
- DWG: real DWG writing is not available in-browser without a DWG SDK. The button exports DXF fallback and explains this.
