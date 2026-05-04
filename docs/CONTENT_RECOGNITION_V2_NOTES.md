# Content Recognition V2

## الهدف

عندما يفتح PDF كطبقة واحدة داخل x-viewer، لا نكتفي بطبقة المشهد فقط.
نضيف طبقة تعرف ثانية تقرأ محتوى PDF نفسه وتخرج طبقات هندسية/دلالية إضافية:

- `PDF_TEXT` للنصوص الحقيقية الموجودة داخل PDF
- `PDF_IMAGES` للصور أو Raster image operators داخل PDF

## الملفات الجديدة

- `addons/cad-toolkit/core/ContentRecognition.js`

## الملفات المعدلة

- `addons/cad-toolkit/viewer/CADViewer_app.js`
- `addons/cad-toolkit/CADLayerKit.js`
- `addons/cad-toolkit/core/DocumentModel.js`
- `addons/cad-toolkit/core/SemanticLayerClassifier.js`
- `addons/cad-toolkit/ui/LayerRulesPanel.js`

## كيف يعمل

1. بعد فتح PDF، `CADViewer_app.js` يطلق `ContentRecognition`.
2. الوحدة تقرأ الملف بـ `pdfjsLib.getDocument`.
3. الصفحة الحالية فقط يتم تحليلها مبدئيًا لتقليل الضغط على الموبايل والآيباد.
4. يتم استخراج النصوص عبر `page.getTextContent`.
5. يتم اكتشاف الصور عبر `page.getOperatorList`.
6. النتائج تخزن في:

```js
window.__essamContentRecognition
```

7. `CADLayerKit` يدمج هذه النتائج مع بيانات الطبقات الحالية.
8. `LayerRulesPanel` يحدث نفسه عند وصول:

```js
cad:content-recognition-ready
```

## ملاحظات مهمة

- هذا ليس OCR بعد.
- لو PDF عبارة عن صورة ممسوحة ضوئيًا بدون نص حقيقي، `PDF_TEXT` قد يكون فارغًا.
- الصور يتم اكتشافها الآن كـ layer دلالية، لكن مكان الصورة قد يكون تقديريًا إذا لم يخرج PDF.js bounding box مباشر.
- OCR الحقيقي يفضل إضافته لاحقًا كوحدة اختيارية، وليس في هذه المرحلة.
