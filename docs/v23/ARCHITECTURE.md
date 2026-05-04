# V23 Architecture

V23 adds the new architecture beside the current app. It must not change the current 2D/3D/PDF/DXF behavior.

Pipeline:

```text
Current parser / EntityRegistry
→ V23 Document Package bridge
→ files map / IndexedDB
→ later SVG renderer
→ later GLB compiler
```

Rules:

- Parser extracts data only.
- Document Package is the source of truth.
- SVG is a 2D cache/view.
- GLB is a 3D cache/view.
- Edits are deltas.
- Heavy data goes to IndexedDB, not localStorage.
