# V21 Performance Stabilizer

## الهدف
تقليل الثقل المستمر بدون تغيير قراءة الملفات أو بنية البيانات التي وصلنا لها.

V21 لا يغير:

- EntityRegistry
- DocumentModel
- PDF page context
- DXF source export
- الحذف / الإخفاء / النقل

هو فقط يضيف طبقة تنظيم أداء فوق المشروع.

## الملف المضاف

```text
addons/cad-toolkit/core/V21PerformanceStabilizer.js
```

## أضف في index.html

ضعه بعد CADLayerKit و EmptyExtractionGuard، وقبل ملفات الواجهة إن أمكن:

```html
<script type="module" src="./addons/cad-toolkit/core/V21PerformanceStabilizer.js"></script>
```

مثال ترتيب مناسب:

```html
<script type="module" src="./addons/cad-toolkit/CADLayerKit.js"></script>
<script type="module" src="./addons/cad-toolkit/core/EmptyExtractionGuard.js"></script>
<script type="module" src="./addons/cad-toolkit/core/PdfGeometryRefreshBridge.js"></script>
<script type="module" src="./addons/cad-toolkit/core/V21PerformanceStabilizer.js"></script>
```

## ماذا يفعل؟

- Cache قصير لنتائج CADLayerKit.extractFromViewer / extractFromScene.
- يمنع الاستبدال بنتيجة empty أثناء refresh عابر إذا كان عنده آخر نتيجة صالحة لنفس السياق.
- Throttle خفيف لـ EntityRenderBridge.rebuild.
- ModeTransitionManager لتهيئة 2D / 3D / VR على دفعات.
- Overlay تحميل عند الانتقال.
- Performance summary لمعرفة سبب الثقل بالأرقام.

## أوامر الاختبار

```js
window.__essamPerformanceMonitor.getSummary()
```

```js
await window.__essamModeTransitionManager.prepare3D()
```

```js
await window.__essamModeTransitionManager.prepareVR()
```

```js
await window.__essamModeTransitionManager.prepare2D()
```

## المرحلة الحالية

هذه نسخة آمنة Passive/Light Integration.
هي لا تغير أزرار 3D/VR تلقائيًا بعد.
بعد الاختبار، نربط أزرار 3D/VR بها مباشرة في V21.1.
