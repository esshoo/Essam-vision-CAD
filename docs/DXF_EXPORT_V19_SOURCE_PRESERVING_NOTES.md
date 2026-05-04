# DXF Export V19 - Source Preserving

This patch replaces only:

`addons/cad-toolkit/core/ProjectExporter.js`

## Goal
Do not rebuild DXF from scratch. Instead:

1. Read the currently uploaded original DXF file.
2. Keep HEADER / TABLES / BLOCKS / OBJECTS as they are.
3. Patch only ENTITIES.
4. Preserve untouched LWPOLYLINE / SOLID / LINE records.
5. Remove or change layer only for matched edited segments/entities.

## Why this is needed
The previous simple exporters converted the drawing to LINE-only output and lost the original layer/entity structure.

## Current matching
V19 matches edited registry segments against original DXF geometry using:

- original layer inferred from `originalLayer`, metadata, or entity id prefix
- segment endpoints rounded to 0.001

The deleted sample:

`PDF_DD-axis__PDF_DD-axis__obj___line-segment_182_142_531_-334_352_142_531_-321_864`

matches the original `LWPOLYLINE` handle `20F` in `chandelier.dxf`.
