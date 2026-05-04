# Entity Render Bridge V8

## المشكلة التي ظهرت في V7

`EntityRegistry` كان يخرج عناصر مستقلة، لكن `EntityRenderBridge` كان يرسم كل طبقة كـ `LineSegments` واحد.

لذلك بعض الطبقات كانت لا تزال تتصرف بصريًا وكأنها عنصر واحد، حتى لو كانت البيانات الداخلية مفصولة.

## حل V8

V8 ترسم كل Entity كـ object مستقل داخل managed render group.

- كل عنصر مرسوم يحمل `userData.__essamCoreEntityId`
- `ScreenSelectionBridge` يبدأ التحديد من managed render أولًا
- `EntityLayerEditor` يربط ScreenSelectionBridge بـ EntityRenderBridge
- `CADLayerKit` لم يعد يحترم `visible=false` كافتراضي عند استخراج model-layers، حتى لا يتم إعادة بناء registry ناقصًا بعد إخفاء الرسم الأصلي

## أوامر اختبار

```js
window.__essamEntityRenderBridge.getDebugSummary()
window.__essamScreenSelectionBridge.getDebugSummary()
window.__essamEntityRegistry.getStats()
window.__essamEntityRegistry.getSelected()
```

القيم المتوقعة:

- `lastBuild.renderMode = "per-entity"`
- `managedChildren` قريب من عدد العناصر القابلة للرسم
- `entityObjectMapSize` قريب من عدد العناصر القابلة للرسم
- `managedRenderEnabled = true`

## الهدف

عند الضغط على عنصر داخل طبقة كبيرة، يتم اختيار Entity واحد وليس الطبقة بالكامل.
