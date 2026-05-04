# Project State V11

## الهدف
جعل تعديلات EntityRegistry تظهر في كامل المشروع:

- لوحة الطبقات
- عرض 3D
- تصدير JSON/ DXF
- الحفظ التلقائي بعد الخروج والعودة
- Undo / Restore All

## الملفات المضافة

- `addons/cad-toolkit/core/ProjectState.js`
- `addons/cad-toolkit/core/ProjectExporter.js`

## الملفات المعدلة

- `addons/cad-toolkit/CADLayerKit.js`
- `addons/cad-toolkit/ui/EntityLayerEditor.js`
- `addons/cad-toolkit/ui/LayerRulesPanel.js`

## ما الذي تغير؟

### 1. Autosave
أي عملية على العناصر تحفظ تلقائيًا في localStorage حسب اسم الملف.

العمليات المدعومة:

- hide entity
- delete entity
- move entity to layer
- hide/delete/move full layer
- undo
- restore all
- layer visibility from LayerRulesPanel

### 2. Restore عند فتح الملف
بعد استخراج `EntityRegistry` من الملف، يتم تطبيق آخر حالة محفوظة تلقائيًا قبل أن تقرأها لوحة الطبقات أو 3D.

### 3. LayerRulesPanel يقرأ من ProjectState
لو فتحت الطبقات أو 3D، لا يتم إعادة استخراج الملف من الصفر طالما `EntityRegistry` موجود.

يتم الاعتماد على:

```js
ProjectState.getRuntimeRawData()
```

### 4. 3D Preview
عرض 3D يعتمد الآن على العناصر الظاهرة وغير المحذوفة من `EntityRegistry`.

### 5. Export buttons
أضيفت أزرار داخل لوحة الطبقات:

- PDF: يستخدم `cadDrawingOverlay.exportPdf()` للـ PDF markup الحالي
- DXF: يصدر DXF ASCII من العناصر الحالية الظاهرة
- DWG: لا يوجد DWG native في المتصفح حاليًا، لذلك يعطي تنبيه ويصدر DXF كبديل عملي

## أوامر Console مفيدة

```js
window.ProjectState.load()
window.ProjectState.saveRuntime({ reason: 'manual-test' })
window.ProjectState.getRuntimeRawData()
window.__essamEntityRegistry.getStats()
```

## ملاحظة مهمة عن DWG
تصدير DWG الحقيقي يحتاج SDK أو خدمة تحويل CAD. المتصفح الحالي لا يملك كاتب DWG أصلي. DXF هو مسار التبادل العملي الآن.
