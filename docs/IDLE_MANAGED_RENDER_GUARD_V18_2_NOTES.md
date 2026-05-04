# Idle Managed Render Guard V18.2

## المشكلة
بعد حذف عنصر:

- لا يظهر في إدارة العناصر.
- لا يظهر في 3D.
- لكنه يظهر في 2D العادي.
- عند الدخول مرة أخرى لإدارة العناصر يختفي.

السبب أن العرض العادي 2D يرجع إلى كائنات x-viewer الأصلية، بينما إدارة العناصر تستخدم EntityRenderBridge الذي يحترم حالة EntityRegistry.

## الحل
V18.2 يبقي EntityRenderBridge فعالًا تلقائيًا في وضع 2D طالما يوجد أي تعديل على مستوى Entity:

- deleted=true
- visible=false
- layer moved

وبذلك لا ترجع الكائنات الأصلية المجمعة لتغطي التعديلات.

## الاختبار
بعد التركيب:

```js
window.__essamIdleManagedRenderGuardV18_2.getSummary()
```

بعد حذف عنصر والخروج من إدارة العناصر، المفروض:

- `hasEntityEdits: true`
- `render.enabled: true`
- العنصر المحذوف لا يظهر في 2D.
