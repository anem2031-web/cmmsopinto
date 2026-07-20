# ملخص الإصلاحات الثمانية الحرجة المُطبَّقة

تم التحقق من كل الملفات أدناه بمحلل TypeScript الفعلي (صفر أخطاء صياغة). لا تحل هذه الملفات محل مراجعة بشرية واختبار كامل قبل النشر، خصوصاً بند 7 الذي **يتطلب تنفيذ خطة الاحتواء على الإنتاج أولاً**.

## 1) ثغرة IDOR في `deleteItem` و`editItem`
**الملف:** `server/routers/purchase/purchase-orders.router.ts`
أُضيف تحقق `item.purchaseOrderId !== input.purchaseOrderId` في كلا الإجراءين قبل تنفيذ أي حذف/تعديل.

## 2) حماية "آخر صنف متبقٍ" في `deleteItem`
**الملف:** نفسه أعلاه
أُضيف تحقق: إن كان عدد أصناف الطلب ≤ 1، يُرفض الحذف برسالة توضيحية.

## 3) الشرط الميت في حذف الطلب الكامل (`delete`)
**الملف:** نفسه أعلاه
استُبدلت القيم غير الموجودة (`funded, partially_purchased, completed`) بقائمة `nonDeletableStatuses` تطابق فعلياً enum الحالات في `drizzle/schema.ts`.

## 4) تعطيل مسار الاستلام القديم غير الآمن (v1)
**الملف:** `server/routers/inventory/receipts.router.ts`
تم استبدال جسم `receiveFromPurchase` بالكامل بخطأ صريح يوجّه لاستخدام v2. الإجراءات الأخرى في نفس الملف (`scanBarcode`, `list`, `getById`, ...) بقيت سليمة لأنها لا تزال مستخدَمة فعلياً في صفحة نشطة (`WarehouseReturn.tsx`).
**ملاحظة:** لم يُحذف تسجيل الراوتر نفسه من `server/routers/index.ts` للسبب أعلاه — راجع التعليق داخل الملف.

## 5) غياب المعاملة الذرية عند الإنشاء
**الملفات:** `purchase-orders.router.ts` (مسارا `create` و`saveDraft`)، و`server/_core/db/purchase.ts`
- `createPurchaseOrder` و`createPOItems` أصبحتا تقبلان `tx` اختيارياً.
- `createPOItems` ترفض الآن مصفوفة فارغة بدلاً من التجاهل الصامت.
- إنشاء الرأس والبنود معاً أصبح داخل `db.withTransaction(...)` في كلا المسارين.

## 6) خلل `every()` على مصفوفة فارغة
**الملفات:** `server/routers/inventory/inventory.router.ts`، `server/routers/inventory/receipts.v2.router.ts`
أُضيف `activeItems.length > 0 &&` قبل كل استدعاء `every()` كان يفتقده.
(النسخة الثالثة في `receipts.router.ts` (v1) أُزيلت بالكامل ضمن إصلاح البند 4.)

## 7) غياب المفتاح الخارجي (Foreign Key)
**الملفات:**
- `drizzle/schema.ts` — أُضيفت `.references(...)` لثلاث علاقات:
  - `purchase_order_items.purchaseOrderId → purchase_orders.id` (ON DELETE RESTRICT)
  - `warehouse_receipt_items.purchaseOrderItemId → purchase_order_items.id` (ON DELETE SET NULL)
  - `inventory_transactions.purchaseOrderItemId → purchase_order_items.id` (ON DELETE SET NULL)
- `drizzle/migrations/critical_fix_07_step1_detect_orphans.sql` — سكربت كشف قراءة فقط، شغّله أولاً وكرره بعد أي تصحيح يدوي.
- `drizzle/migrations/critical_fix_07_purchase_fk_constraints.sql` — الفهارس والمفاتيح الخارجية فعلياً.

**⚠️ لا يجوز تنفيذ ملف الـFK مباشرة على الإنتاج.** يجب أولاً:
1. تشغيل `critical_fix_07_step1_detect_orphans.sql` والتأكد من عدد الروابط المخالفة.
2. تجميد الكتابة (نافذة صيانة قصيرة على المسارات الثلاثة المتأثرة).
3. تصحيح الروابط القابلة للإصلاح يدوياً، وتحويل الباقي إلى `NULL` بقرار موثَّق.
4. إعادة تشغيل سكربت الكشف والتأكد من نتيجة صفر.
5. عندها فقط، تنفيذ `critical_fix_07_purchase_fk_constraints.sql`.

تفاصيل كل خطوة موثقة بالكامل في قسم 12.5 من تقرير "السبب الجذري والثغرة الأمنية".

## 8) تسرّب `purchaseOrderItemId` من مسار "استلام مستقل" (بلا طلب شراء)
**الملف:** `server/routers/inventory/receipts.v2.router.ts` (مسار الاستلام المستقل)
اكتُشف أثناء تحليل بيانات فعلية من الإنتاج: مسار "استلام مستقل" (لا يوجد طلب شراء) كان يترك `item.purchaseOrderItemId` كما وصل من الواجهة (قد يكون قيمة عالقة لا معنى لها) ثم يمرّره دون قصد إلى `inventory_transactions` عبر دالة `processReceiptItem` المشتركة مع مسار الاستلام المرتبط بطلب شراء حقيقي.
**الإصلاح:** فرض `purchaseOrderItemId: undefined` صراحةً عند تمرير الصنف لـ`processReceiptItem` من هذا المسار تحديدًا، بحيث لا تُكتب أي قيمة غير ذات معنى في `inventory_transactions` لاستلام لا علاقة له بأي طلب شراء أصلًا.
**الأثر على البيانات القديمة:** هذا الخلل يفسّر غالبية حركات المخزون اليتيمة المكتشفة (111 من 115) — وهي ليست بيانات مفقودة، بل قيمة عالقة لا معنى لها من الأساس، وتُعالَج ضمن خطة الأرشفة المنفصلة (راجع تقرير الأرشفة).

## التحقق التقني
جميع الملفات فُحصت بمحلل TypeScript الفعلي (`tsc --noEmit`) دون أي خطأ صياغة (TS1xxx). لم يُجرَ فحص أنواع كامل (Type-check) لعدم توفر `node_modules` الكاملة في بيئة المراجعة — يُنصح بتشغيل `npm run typecheck` (أو ما يعادله) داخل بيئة المشروع الفعلية قبل الدمج والنشر.
