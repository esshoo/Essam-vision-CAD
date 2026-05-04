# V24.3.2 SVG Coordinate Toggle Syntax Fix

Fixes this import error:

```text
Uncaught SyntaxError: Unexpected identifier 'normalized' (at SvgPageCompiler.js:163:130)
```

Cause:
A string in `SvgPageCompiler.js` used single quotes around text that also contained `setCoordinateMode('normalized')`.

Replace:
- `addons/essam-core/v24/renderers/svg2d/SvgPageCompiler.js`
- `addons/essam-core/v24/bootstrap/V24SvgRendererBootstrap.js`
