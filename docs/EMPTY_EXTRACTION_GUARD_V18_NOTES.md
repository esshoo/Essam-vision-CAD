# V18 Empty Extraction Guard

## المشكلة
أثناء autosave أو refresh من DrawingOverlay/EntityLayerEditor، قد يستدعي المشروع:

```js
CADLayerKit.extractFromViewer(...)
```

وفي بعض الحالات يرجع:

```text
Source=scene-fallback | layers=0 | entities=0
EntityRegistry ready | layers=0 | entities=0
```

هذا يعني أن استخراجًا فارغًا قد يستبدل Registry صحيحًا كان يحتوي مثلًا على 1819 عنصرًا.

## حل V18

يضيف ملفًا جديدًا:

```text
addons/cad-toolkit/core/EmptyExtractionGuard.js
```

ويضيف import له داخل `index.html` قبل LayerRulesPanel وEntityLayerEditor.

الـ guard يفعل الآتي:

- يلتقط آخر Registry صحيح فيه layers/entities.
- يراقب CADLayerKit.extractFromViewer/extractFromScene.
- إذا رجع استخراج فاضي، لا يسمح له باستبدال الحالة الصحيحة.
- يسترجع آخر Registry صحيح.
- يطبع:

```text
[EmptyExtractionGuard V18] Restored last good registry after empty extraction
```

## ماذا لا يحل؟

V18 لا يصلح DXF export نفسه.

هو فقط يمنع ضياع الحالة الصحيحة أثناء refresh/autosave، حتى يكون اختبار التصدير موثوقًا.

## الاختبار

بعد فتح الملف الأصلي:

```js
window.__essamEntityRegistry?.getStats?.()
```

لو ظهر لاحقًا تحذير `layers=0/entities=0`، لا يجب أن يصبح Registry الحالي فاضيًا.

افحص:

```js
window.__essamEntityRegistry?.getStats?.()
window.__essamEmptyExtractionGuardV18
```
