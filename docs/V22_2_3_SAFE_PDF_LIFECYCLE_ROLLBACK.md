# V22.2.3 Safe PDF Lifecycle Rollback

V22.2.2 made PDF page navigation slower and could change the viewer background because it tried to repair blank pages by touching scene objects, camera helpers, culling, materials, renderer, and layer indexes.

V22.2.3 removes that aggressive visual repair pipeline.

It keeps only:

- observing PDF page changes
- hiding PDF page controls while 3D is active
- a native-only `refreshCurrentPage()` helper
- summary/debug helpers

It does not patch `_loadPdfPage`, does not emit extra `cad:pdf-page-changed` events, and does not touch camera/background/materials.
