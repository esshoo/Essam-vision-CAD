# PDF Geometry Refresh Bridge V18.4

## المشكلة
بعد إضافة ContentRecognition للنصوص والصور، صفحة PDF كانت تظهر في اللوج:

```text
[ContentRecognition] PDF page X: text=..., images=...
```

لكن لم تعد تظهر قراءة الهندسة القديمة:

```text
[CADLayerKit V9] Extracted ... segments
```

أي أن النصوص والصور أصبحت تُقرأ، لكن خطوط/طبقات الصفحة الهندسية لا يتم إعادة بنائها عند تغيير صفحة PDF.

## الحل
إضافة bridge جديد:

```text
addons/cad-toolkit/core/PdfGeometryRefreshBridge.js
```

يسمع إلى:

- `cad:pdf-page-changed`
- `cad:content-recognition-ready`
- `cad:file-loaded`

ثم يشغّل `CADLayerKit.extractFromViewer()` بعد عدة تأخيرات قصيرة حتى تكون صفحة PDF جاهزة داخل viewer.

## التركيب
أضف import في `index.html` قبل LayerRulesPanel وEntityLayerEditor:

```html
<script type="module" src="./addons/cad-toolkit/core/PdfGeometryRefreshBridge.js"></script>
```

## الفحص

```js
window.__essamPdfGeometryRefreshBridgeV18_4.getSummary()
```

ولتشغيل refresh يدوي:

```js
window.__essamPdfGeometryRefreshBridgeV18_4.refreshNow()
```
