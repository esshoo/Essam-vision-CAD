# V24.5.1 SVG Entity Selection Recursion Fix

Replaces:

- `addons/essam-core/v24/bootstrap/V24SvgRendererBootstrap.js`
- `addons/essam-core/v24/renderers/svg2d/SvgPageCompiler.js`

## Fix

V24.5 had a recursion loop:

`ensureOverlay()` -> `installSvgSelectionHandlers()` -> `ensureOverlay()` -> ...

This caused:

`RangeError: Maximum call stack size exceeded`

V24.5.1 assigns `state.overlay` before installing selection handlers and makes the handler installer safer.
