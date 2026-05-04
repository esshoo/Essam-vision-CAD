# Entity Screen Selection V5

## الهدف
ربط `EntityRegistry` و `SelectionEngine` بالضغط الحقيقي على الشاشة داخل الـ 2D viewer.

قبل هذه النسخة كان يمكن اختبار العناصر من الـ Console فقط.
بعد هذه النسخة أصبح `EntityLayerEditor` يحاول أولًا اختيار `coreEntity` من `EntityRegistry` قبل الرجوع للنظام القديم المبني على Three.js objects.

## الملفات الجديدة
- `addons/cad-toolkit/core/ScreenSelectionBridge.js`

## الملفات المعدلة
- `addons/cad-toolkit/ui/EntityLayerEditor.js`
- `addons/cad-toolkit/core/EntityRegistry.js`

## ماذا يفعل ScreenSelectionBridge؟
- يأخذ إحداثيات الضغط من الشاشة.
- يسقط عناصر `EntityRegistry` على screen pixels.
- يختار أقرب entity.
- يدعم box selection على مستوى entities.
- يضيف overlay أصفر فوق العناصر المحددة.
- يحاول بشكل مبدئي تطبيق hide/delete على `LineSegments` الأصلية عندما يستطيع ربط الـ entity بالـ parent object.

## أوامر اختبار
```js
window.__essamScreenSelectionBridge?.getDebugSummary()
window.__essamEntityRegistry.getStats()
window.__essamEntityRegistry.getSelected()
```

## ملاحظات مهمة
- هذه ليست نهاية نظام التحرير، لكنها أول ربط حقيقي بين الـ UI والـ EntityRegistry.
- تطبيق hide/delete على المشهد حاليًا Best-effort ويعمل أفضل مع LineSegments.
- المرحلة القادمة هي RendererBridge أقوى يعيد بناء الرسم من DocumentModel بدل تعديل geometry الأصلية فقط.
