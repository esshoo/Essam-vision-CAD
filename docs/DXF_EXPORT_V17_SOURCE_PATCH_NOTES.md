# DXF Export V17 - Source-preserving patch

This patch replaces the flat DXF rebuild exporter with a source-preserving exporter.

## Why
The previous exporter rebuilt the drawing from EntityRegistry as LINE-only geometry. It opened in AutoCAD sometimes, but it lost original DXF structure: layers, LWPOLYLINE, SOLID, handles, BLOCKS, OBJECTS, and many properties.

## What V17 does
When the current opened file is DXF, ProjectExporter reads the original uploaded DXF file and patches only the ENTITIES section:

- Unedited original entities are preserved exactly as much as possible.
- LINE entities can be removed or moved to another layer.
- LWPOLYLINE entities can be preserved if untouched.
- If a segment inside an LWPOLYLINE is edited, only that edited polyline record is rewritten as LINE segments.
- SOLID/TRACE entities are preserved if untouched, and can be removed/moved when matched.
- Original HEADER/TABLES/BLOCKS/OBJECTS sections remain from the source file.
- New target layers are added to the LAYER table when needed.

If the original DXF text is not available, it falls back to the old simple rebuild exporter.

## Limits
- Full DWG export still requires external SDK/service.
- Edited polylines may be rewritten as LINE records only for the affected polyline.
- Complex bulge/arc polyline segments are preserved if untouched, but not fully reconstructed when edited.
