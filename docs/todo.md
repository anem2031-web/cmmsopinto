# Project TODO - CMMS نظام إدارة الصيانة المتكامل

## Phase 1: Database & Schema
- [x] Design complete database schema (users, tickets, purchase orders, items, inventory, audit logs, notifications)
- [x] Push database migrations
- [x] Create db helper functions

## Phase 2: Backend API & Security
- [x] Multi-role authentication system (9 roles)
- [x] Role-based access control middleware
- [x] Maintenance tickets CRUD procedures
- [x] Purchase orders CRUD with multi-item support
- [x] Approval workflow (accounting + senior management)
- [x] Partial purchase tracking per item
- [x] Warehouse receiving with per-item cost/supplier
- [x] Inventory management (stock in/out)
- [x] File upload to S3 (photos, invoices, documents)
- [x] Notification system (in-app + owner alerts)
- [x] AI/LLM integration for analytics and suggestions
- [x] Reports generation procedures
- [x] Security: rate limiting, input validation, audit logging
- [x] Security: row-level permissions, SQL injection prevention

## Phase 3: Core UI Design & Layout
- [x] Global theme and design system (elegant professional)
- [x] RTL Arabic support
- [x] Dashboard layout with sidebar navigation
- [x] Role-based navigation and routing
- [x] Login/auth flow UI

## Phase 4: Tickets & Purchase Orders UI
- [x] Create ticket form with photo capture
- [x] Ticket list with filters and search
- [x] Ticket detail view with status timeline
- [x] Ticket assignment to technicians
- [x] Post-repair photo upload and closure
- [x] Create purchase order with multiple items
- [x] Delegate selection per item
- [x] Estimated cost entry by delegate
- [x] Accounting approval UI
- [x] Senior management approval UI
- [x] Partial purchase confirmation per item
- [x] Invoice/photo upload per purchased item

## Phase 5: Warehouse, Owner Dashboard, Reports & Notifications
- [x] Warehouse receiving UI (per-item cost + supplier)
- [ ] Material dispatch to technicians
- [x] Inventory tracking view
- [x] Owner dashboard with interactive cards
- [x] Monthly/weekly/custom reports with charts
- [ ] Export reports to PDF/Excel
- [x] Actual vs estimated cost comparison
- [ ] Technician performance reports
- [x] In-app notification center
- [x] Auto-notifications for critical events
- [x] AI insights panel

## Phase 6: Testing & Delivery
- [x] Vitest unit tests for critical procedures (20/20 passed)
- [x] Final UI review and polish
- [x] Checkpoint and delivery

## Phase 7: Seed Data
- [x] إنشاء بيانات تجريبية شاملة (مواقع، مستخدمين، بلاغات، طلبات شراء، مخزون، إشعارات، سجل تدقيق)
- [x] إصلاح خطأ card-hover في CSS

## Phase 8: Technician Performance Report
- [x] إضافة API تقرير أداء الفنيين (عدد البلاغات، متوسط وقت الحل، معدل الأداء)
- [x] بناء واجهة تقرير أداء الفنيين مع رسوم بيانية تفاعلية
- [x] اختبارات vitest لتقرير أداء الفنيين (23/23 passed)

## Phase 9: Time Filters for Technician Report
- [x] إضافة معاملات فلترة زمنية لـ API تقرير أداء الفنيين (أسبوع/شهر/ربع سنة/سنة/مخصص)
- [x] تحديث واجهة تقرير الفنيين بشريط فلاتر زمنية تفاعلي
- [x] اختبارات vitest للفلاتر الزمنية (28/28 passed)

## Phase 10: Workflow Overhaul - إصلاح دورة العمل الكاملة
- [x] ربط طلب الشراء بالبلاغ (زر "طلب مواد" داخل شاشة البلاغ)
- [x] إضافة حقل assignedDelegateId لكل صنف في طلب الشراء (اختيار مندوب لكل صنف)
- [x] واجهة المندوب المخصصة: يرى فقط الأصناف المسندة إليه
- [x] حقل التكلفة التقديرية الذي يملأه المندوب + المجموع رقماً وكتابة
- [x] تدفق الاعتمادات الثنائية (حسابات ← إدارة عليا) بأزرار واضحة
- [x] الشراء الجزئي: المندوب يحدد كل صنف تم شراؤه على حدة مع رفع صور
- [x] واجهة المستودع: استلام وتسجيل القيمة الفعلية واسم المورد لكل صنف
- [x] تحديث حالة البلاغ تلقائياً عند تغير حالة طلب الشراء
- [x] تدفق سلس ومتكامل بين جميع الأدوار
- [x] صفحة "أصنافي" المخصصة للمندوب
- [x] تحسين صفحة المستودع مع تبويب "بانتظار الاستلام"
- [x] جميع الاختبارات ناجحة (28/28)

## Phase 11: Enterprise Multilingual Engine
### Database & Migration
- [x] إنشاء جدول entity_translations العام الموحد مع حقول translation_job_id, translation_status, last_attempt_at, error_message
- [x] إنشاء جدول translation_jobs للـ Queue (حالات: pending/processing/completed/failed)
- [x] إضافة حقل original_language لجميع الكيانات (tickets, purchase_orders, etc)
- [x] إضافة حقل preferred_language لجدول users (ar/en/ur)
- [x] تنفيذ Migration شامل

### Backend - Translation Engine
- [x] بناء محرك ترجمة مركزي (translationEngine.ts) مع LLM
- [x] Translation Job Queue غير متزامن (Async) مع Retry Mechanism
- [x] Smart Re-Translation Logic (ترجمة الحقول المتغيرة فقط)
- [x] Manual Override (تعديل يدوي مع حالة APPROVED لا تُستبدل آلياً)
- [x] Fallback Logic (عرض النص الأصلي عند فشل الترجمة)
- [x] بناء نظام Cache للترجمات
- [x] بناء API ترجمة عام يدعم جميع الكيانات (CRUD)
- [x] نظام الإصدارات (Versioning) عند تعديل النصوص
- [x] تسجيل عمليات الترجمة في Audit Log
- [x] حماية النص الأصلي من التعديل إلا بصلاحية خاصة

### Frontend - UI i18n
- [x] إنشاء ملفات ترجمة (ar.ts, en.ts, ur.ts) لجميع عناصر الواجهة
- [x] بناء LanguageContext مع useTranslation hook
- [x] دعم RTL/LTR ديناميكي حسب اللغة
- [x] مبدّل اللغة في الشريط الجانبي
- [x] تحديث جميع الصفحات لاستخدام نظام i18n

### Dynamic Content Translation
- [ ] ربط ترجمة المحتوى الديناميكي بالواجهات
- [ ] خيار "عرض النص الأصلي" في كل حقل مترجم
- [ ] ترجمة التقارير والطباعة حسب لغة المستخدم

### Monitoring & Admin Panel
- [x] شاشة إدارية للترجمات (معلقة/فاشلة/إعادة ترجمة/فلترة)

### Testing
- [x] اختبارات vitest لمحرك الترجمة (37 اختبار ناجح)
- [x] جميع الاختبارات ناجحة (65/65 شاملة الترجمة)

## Phase 12: إعادة بناء دورة الشراء المتسلسلة (3 مراحل)
### Backend
- [x] تحديث حالات الأصناف لتشمل: funded → purchased → delivered_to_warehouse → delivered_to_requester
- [x] إضافة حقول جديدة: purchasePhoto, invoicePhoto, supplierName, supplierItemName, supplierCost, warehousePhoto, deliveredAt, deliveredBy
- [x] API: تأكيد الشراء مع رفع صورة الصنف + صورة الفاتورة (للمندوب)
- [x] API: تأكيد التوريد مع اسم المورد + اسم الصنف بالفاتورة + التكلفة + صورة (للمستودع)
- [x] API: تأكيد التسليم للفني/المسؤول (للمستودع)
- [x] ربط إغلاق البلاغ تلقائياً عند تسليم جميع الأصناف
- [x] Migration شامل

### Frontend - واجهة المندوب
- [x] قائمة أصناف مرتبة بالتاريخ مع زر تأكيد لكل صنف
- [x] نافذة منبثقة عند الشراء: صورة الصنف + صورة الفاتورة + حفظ
- [x] تحديث حالة الصنف فوراً بعد الشراء

### Frontend - واجهة المستودع
- [x] تبويب "بانتظار التوريد" للأصناف المشتراة
- [x] نافذة التوريد: اسم المورد + اسم الصنف بالفاتورة + التكلفة + صورة + حفظ
- [x] تبويب "بانتظار التسليم" للأصناف الموردة
- [x] زر "تم التسليم" لتسليم الصنف للفني/المسؤول

### Testing
- [x] اختبارات vitest لدورة الشراء الكاملة (21 اختبار ناجح)
- [x] جميع الاختبارات ناجحة (86/86)

## Phase 13: مميزات الحذف والتعديل وسجل التدقيق

### Backend - إجراءات الحذف والتعديل
- [x] تعديل البلاغات (العنوان، الوصف، الأولوية، الموقع، الفئة)
- [x] حذف البلاغات (حذف كامل مع التحقق من الصلاحيات)
- [x] تعديل طلبات الشراء (المبررات)
- [x] حذف طلبات الشراء (فقط قبل التمويل)
- [x] حذف أصناف طلب الشراء (قبل الاعتماد)
- [x] تعديل أصناف المخزون
- [x] حذف أصناف المخزون
- [x] تعديل المواقع
- [x] حذف المواقع
- [x] تعديل المستخدمين (الاسم، الدور، البريد)
- [x] حذف المستخدمين (مع حماية المالك)
- [x] تسجيل كل عملية حذف/تعديل في سجل التدقيق مع القيم القديمة والجديدة

### Frontend - أزرار الحذف والتعديل
- [x] أزرار تعديل/حذف في صفحة البلاغات مع نوافذ تأكيد
- [x] نافذة تعديل البلاغ مع حفظ التغييرات
- [x] نافذة تأكيد الحذف لجميع الكيانات
- [x] أزرار حذف في صفحة طلبات الشراء
- [x] أزرار تعديل/حذف في صفحة المخزون
- [x] أزرار تعديل/حذف في صفحة المواقع
- [x] أزرار تعديل/حذف في صفحة المستخدمين

### سجل التدقيق المحسّن
- [x] فلاتر متقدمة (حسب النوع، المستخدم، التاريخ، الإجراء)
- [x] عرض القيم القديمة والجديدة بشكل واضح (diff table)
- [x] تصفية حسب الكيان (بلاغ، طلب شراء، مخزون، إلخ)

### Testing
- [x] اختبارات vitest لعمليات الحذف والتعديل (32 اختبار ناجح)
- [x] جميع الاختبارات ناجحة (118/118)

## Phase 14: تصدير التقارير + تعديل أصناف الشراء + إشعارات الحذف/التعديل

### تصدير التقارير إلى PDF/Excel
- [x] API تصدير تقارير الأداء إلى Excel
- [x] API تصدير سجل التدقيق إلى Excel
- [x] API تصدير قائمة البلاغات إلى Excel
- [x] API تصدير طلبات الشراء إلى Excel
- [x] أزرار تصدير في صفحة التقارير + المخزون
- [x] أزرار تصدير في صفحة سجل التدقيق
- [x] أزرار تصدير في صفحة البلاغات
- [x] أزرار تصدير في صفحة طلبات الشراء

### تعديل أصناف طلب الشراء
- [x] API تعديل صنف طلب الشراء (الكمية، الوصف، السعر المقدر) قبل الاعتماد
- [x] نافذة تعديل الصنف في واجهة تفاصيل طلب الشراء
- [x] تسجيل التعديل في سجل التدقيق

### إشعارات فورية عند الحذف/التعديل
- [x] إشعار لمدير الصيانة عند حذف بلاغ
- [x] إشعار لمدير الصيانة عند تعديل بلاغ
- [x] إشعار لمدير الصيانة عند حذف طلب شراء
- [x] إشعار لمدير الصيانة عند تعديل طلب شراء

### Testing
- [x] اختبارات vitest للمميزات الجديدة (32 اختبار ناجح)
- [x] جميع الاختبارات ناجحة (150/150)

## Phase 14.5: تطوير المساعد الذكي الحقيقي

### Backend - المساعد الذكي
- [x] إعادة بناء AI API ليستعلم من قاعدة البيانات مباشرة (بلاغات، طلبات شراء، مخزون، مستخدمين، مواقع، تدقيق)
- [x] دعم اللهجة العربية السعودية العامية
- [x] دعم اللهجة المصرية العامية
- [x] دعم اللغة الإنجليزية
- [x] دعم اللغة الأردية
- [x] System Prompt متقدم يشمل سياق قاعدة البيانات الكامل
- [x] إمكانية السؤال عن أي بيانات في النظام

### Frontend - المساعد الذكي
- [x] تحسين واجهة المحادثة لتكون أكثر تفاعلية (chat-style)
- [x] دعم سجل المحادثات (آخر 10 رسائل)
- [x] عرض البيانات المنظمة في الردود (Markdown)

## Phase 15: رفع الصور والملفات مع البلاغات

### Backend
- [x] إنشاء جدول ticket_attachments في schema (id, ticketId, fileUrl, fileKey, fileName, mimeType, fileSize, uploadedBy, createdAt)
- [x] تشغيل migration
- [x] إنشاء API رفع الملفات إلى S3 (POST /api/upload)
- [x] إضافة إجراء attachments.add لربط الملف بالبلاغ
- [x] إضافة إجراء attachments.list لجلب مرفقات البلاغ
- [x] إضافة إجراء attachments.delete لحذف مرفق

### Frontend - إنشاء البلاغ
- [x] مكون رفع الملفات مع معاينة الصور
- [ ] دعم السحب والإفلات (Drag & Drop)
- [x] تحديد أنواع الملفات المسموحة (صور + PDF + مستندات)
- [ ] عرض شريط تقدم الرفع
- [x] ربط المرفقات بالبلاغ بعد الإنشاء

### Frontend - تفاصيل البلاغ
- [x] عرض المرفقات في صفحة تفاصيل البلاغ
- [ ] معاينة الصور بالحجم الكامل (Lightbox)
- [x] إمكانية تحميل الملفات (via link)
- [ ] إمكانية حذف المرفقات (للمسؤولين)

### Testing
- [x] اختبارات vitest للمرفقات (6/6 passed)

## Phase 16: النسخ الاحتياطي لقاعدة البيانات

### Backend
- [x] إنشاء API لإنشاء نسخة احتياطية (تصدير جميع جداول قاعدة البيانات إلى JSON)
- [x] إنشاء API لاستعادة نسخة احتياطية (استيراد البيانات من ملف JSON)
- [x] إنشاء API لقائمة النسخ الاحتياطية السابقة
- [ ] إنشاء API لحذف نسخة احتياطية
- [x] تسجيل عمليات النسخ الاحتياطي في سجل التدقيق

### Frontend
- [x] صفحة النسخ الاحتياطي بتصميم بسيط (بطاقتين: إنشاء + استعادة)
- [x] عرض قائمة النسخ الاحتياطية السابقة مع تاريخ ووقت الإنشاء
- [ ] زر تحميل النسخة الاحتياطية
- [ ] زر حذف النسخة الاحتياطية
- [x] إضافة رابط في القائمة الجانبية
- [x] تسجيل المسار في App.tsx

### Testing
- [x] اختبارات vitest للنسخ الاحتياطي (6/6 passed)

## Phase 17: نظام تسجيل دخول مستقل (اسم مستخدم + كلمة مرور)

- [x] إضافة حقول username و passwordHash في جدول users
- [x] إنشاء API لتسجيل الدخول بـ username/password
- [x] إنشاء API لإنشاء مستخدمين جدد (بواسطة admin)
- [x] seed مستخدم admin بكلمة مرور ADMIN1
- [x] صفحة تسجيل دخول جديدة (بدون Manus OAuth)
- [x] تعديل تدفق المصادقة ليتجاوز Manus OAuth
- [x] إضافة إدارة المستخدمين (إنشاء/تعديل/حذف) في واجهة المستخدم

## Phase 18: Drag & Drop وشريط التقدم للمرفقات

- [x] إضافة منطقة السحب والإفلات (Drag & Drop) في صفحة إنشاء البلاغ
- [x] إضافة شريط تقدم مرئي لكل ملف يُرفع
- [x] إضافة حالات بصرية: hover/dragging/uploading/done/error
- [x] تحديث الترجمات للنصوص الجديدة

## Phase 19: التطوير التراكمي - Drag & Drop + إدارة الأصول + الصيانة الوقائية + AI

### Drag & Drop - توسعة في الواجهات
- [ ] دمج Drag & Drop في تفاصيل البلاغ (TicketDetail) لإضافة مرفقات جديدة
- [ ] دمج Drag & Drop في إنشاء أمر الشراء (CreatePurchaseOrder) للمستندات
- [ ] دمج Drag & Drop في تفاصيل أمر الشراء (PurchaseOrderDetail) للفواتير

### وحدة إدارة الأصول (Asset Management)
- [ ] إضافة جدول assets في schema.ts
- [ ] تشغيل migration
- [ ] إضافة دوال الأصول في db.ts
- [ ] إضافة assets router في routers.ts
- [ ] بناء صفحة Assets.tsx (قائمة + بحث + فلترة)
- [ ] بناء صفحة AssetDetail.tsx (تفاصيل + تاريخ الصيانة + الضمانات)
- [ ] بناء نموذج إضافة/تعديل أصل مع Drag & Drop للصور
- [ ] وحدة إدارة الضمانات مع تنبيهات الانتهاء
- [ ] ربط الأصول بالبلاغات
- [ ] إضافة ترجمات الأصول (ar/en/ur)
- [ ] إضافة رابط الأصول في القائمة الجانبية

### وحدة الصيانة الوقائية (Preventive Maintenance)
- [ ] إضافة جداول maintenance_plans و maintenance_schedules في schema.ts
- [ ] تشغيل migration
- [ ] إضافة دوال الصيانة الوقائية في db.ts
- [ ] إضافة preventive router في routers.ts
- [ ] Cron job لتوليد أوامر العمل تلقائياً
- [ ] بناء صفحة PreventiveMaintenance.tsx
- [ ] بناء نموذج إنشاء خطة صيانة دورية
- [ ] قوائم التحقق (Checklists) لكل خطة
- [ ] إضافة ترجمات الصيانة الوقائية (ar/en/ur)
- [ ] إضافة رابط الصيانة الوقائية في القائمة الجانبية

### تجهيز بيئة الذكاء الاصطناعي التنبؤي
- [ ] تحليل صور الأعطال بالذكاء الاصطناعي في المساعد
- [ ] نموذج تحليل أنماط الأعطال من البيانات التاريخية
- [ ] تنبيهات التنبؤ بالأعطال القادمة
- [ ] توصيات الفني وقطع الغيار عند إنشاء البلاغ

## Phase 20: إصلاح خطأ إضافة الأصول
- [ ] إصلاح خطأ "An unexpected error occurred" عند إضافة أصل جديد


## Phase 21: دعم RFID

### Backend
- [ ] إضافة حقل rfidTag في جدول assets
- [ ] تشغيل migration
- [ ] إضافة دوال في db.ts: getAssetByRfidTag, updateAssetRfidTag
- [ ] إضافة API endpoints في routers.ts: assets.getByRfid, assets.updateRfid

### Frontend
- [ ] إضافة حقل RFID في نموذج إنشاء/تعديل الأصل
- [ ] بناء واجهة البحث السريع بـ RFID (صفحة جديدة)
- [ ] إضافة رابط في القائمة الجانبية للبحث بـ RFID
- [ ] إضافة ترجمات RFID (عربي/إنجليزي/أردي)

### Testing
- [ ] اختبارات vitest للـ RFID APIs

## Phase 19: Workflow العميل الكامل (Triage + Gate/Security)
- [x] إضافة دور supervisor و gate_security في Schema
- [x] إضافة حالات جديدة: pending_triage, under_inspection, work_approved, ready_for_closure, out_for_repair
- [x] إضافة حقول: maintenancePath, supervisorId, gateSecurityId, nfcTagId, batchGroupId في tickets
- [x] إضافة procedures جديدة في Backend: triageTicket, inspectTicket, approveWork, sendOutForRepair, markReadyForClosure
- [x] إنشاء صفحة TriageDashboard للمشرف (Eng. Khaled)
- [x] إنشاء صفحة GateSecurity لحارس البوابة
- [x] تحديث nav في DashboardLayout للأدوار الجديدة
- [x] تحديث الترجمات الثلاث (ar, en, ur) للحالات والأدوار والـ nav الجديدة
- [x] تحديث routes في App.tsx
- [ ] تحديث TicketDetail لدعم المسارات A/B/C وإظهار أزرار Workflow الجديدة
- [ ] تحديث Dashboard لإظهار بطاقات pending_triage و under_inspection


## Phase 20: Gap Analysis Fixes - Critical Fixes (Phase 1) ✅ COMPLETED
### Task 1: Batching Limit (15 items)
- [x] إضافة validation في create purchase order
- [x] التحقق من عدد الأصناف ≤ 15
- [x] رسالة خطأ واضحة عند تجاوز الحد
- [x] اختبار vitest (3 اختبارات)

### Task 2: Path C Status Fix
- [x] تصحيح approveGateEntry ليستخدم ready_for_closure بدلاً من repaired
- [x] تحديث التاريخ والمستخدم
- [x] اختبار vitest (2 اختبارات)

### Task 3: Triage & Inspection Procedures
- [x] إضافة triageTicket procedure (pending_triage → under_inspection)
- [x] إضافة inspectTicket procedure (under_inspection → inspection complete)
- [x] تحديث الإشعارات
- [x] اختبارات vitest (6 اختبارات)

### Task 4: Auto-Transition to pending_triage
- [x] تعديل create ticket ليبدأ بـ pending_triage مباشرة
- [x] التحقق من seed data
- [x] اختبار vitest (1 اختبار)

## Phase 21: NFC/RFID Integration - Scan Asset Page ✅ COMPLETED
- [x] إضافة scanNFCTag procedure في routers.ts
- [x] البحث عن الأصل بـ RFID Tag (getAssetByRfidTag موجود في db.ts)
- [x] جلب الموقع المرتبط بالأصل
- [x] إنشاء صفحة ScanAsset.tsx
- [x] UI: Ready to Scan status + وضع المسح
- [x] تحويل إلى Create Ticket مع pre-filled fields
- [x] معالجة الأخطاء: Asset Not Found
- [x] تحسين Mobile View
- [x] إضافة nav item في DashboardLayout
- [x] تحديث الترجمات (ar/en/ur)
- [x] اختبارات vitest (1 اختبار)

## Phase 22: Warehouse Visibility Enforcement
- [ ] إضافة filter في getInventoryItems
- [ ] المستودع يرى فقط الأصناف المشتراة
- [ ] تحديث routers.ts
- [ ] اختبارات vitest

## Phase 21: NFC/RFID Integration - Scan Asset Page
- [ ] إضافة getAssetByRFIDTag في db.ts
- [ ] إضافة getSiteById في db.ts
- [ ] إضافة scanNFCTag procedure في routers.ts
- [ ] إنشاء صفحة ScanAsset.tsx
- [ ] UI: Ready to Scan status مع animation
- [ ] منطق البحث التلقائي بالـ RFID Tag
- [ ] تحويل إلى Create Ticket مع pre-filled fields مقفلة
- [ ] معالجة الأخطاء: Asset Not Found
- [ ] تحسين Mobile View
- [ ] إضافة route في App.tsx
- [ ] إضافة nav item في DashboardLayout

## Phase 22: Warehouse Visibility Enforcement
- [ ] تحديث getPOItemsForWarehouse في db.ts
- [ ] المستودع يرى فقط الأصناف بحالة purchased أو بعدها
- [ ] تحديث pendingWarehouseItems في routers.ts
- [ ] اختبارات vitest

## Phase 23: Vitest Tests
- [ ] اختبار Batching Limit (15 items)
- [ ] اختبار Path C Status Fix
- [ ] اختبار triageTicket procedure
- [ ] اختبار inspectTicket procedure

## Phase 22: Management Cycle Completion
### Task 1: Smart Action Buttons in TicketDetail
- [ ] أزرار Supervisor (Khaled): Start Triage + Final Closure (Path A)
- [ ] أزرار Maintenance Manager (Abdel Fattah): Approve Work Start + Close Ticket (Path B & C)
- [ ] أزرار Technician: Upload After Photo / Complete Repair
- [ ] الأزرار تظهر فقط حسب الدور والحالة الحالية

### Task 2: Dynamic Dashboard Cards
- [ ] بطاقة "بانتظار الفرز" (pending_triage) للمشرف ومدير الصيانة
- [ ] بطاقة "قيد الفحص" (under_inspection) للمشرف ومدير الصيانة

### Task 3: NFC/RFID Registration in Assets
- [ ] إضافة حقل rfidTag في نموذج إنشاء الأصل
- [ ] إضافة حقل rfidTag في نموذج تعديل الأصل
- [ ] API: تحديث rfidTag للأصل

### Task 4: Gate Security Dashboard Enhancement
- [ ] عرض الأصول المعتمدة للصيانة الخارجية (Path C)
- [ ] زر "اعتماد الخروج" (Gate Exit Approval)
- [ ] زر "اعتماد الدخول" (Gate Entry Approval)
- [ ] عرض حالة كل أصل (خارج / داخل)

## Phase 22: Management Cycle Completion ✅ COMPLETED
- [x] Task 1: Smart Action Buttons في TicketDetail (حسب الدور والحالة - Khaled/AbdelFattah/Technician)
- [x] Task 2: Dynamic Dashboard Cards (pendingTriage + underInspection ببطاقات تنبيه عاجلة)
- [x] Task 3: NFC/RFID Registration في Assets (موجود بالفعل - حقل rfidTag في نموذج الأصل)
- [x] Task 4: Gate Security Dashboard Enhancement (تبويب ثالث السجل + مؤشر وقت + حوار تفاصيل)

## Phase 23: Final Enhancements ✅ COMPLETED
- [x] Task 1: Full-Cycle Automated Tests (35/35 passed - Path A/B/C + Closure Rights)
- [x] Task 2: Workflow Notifications (موجودة بالفعل في Backend - خالد/عبدالفتاح/حارس البوابة)
- [x] Task 3: Triage Dashboard Quick Action Buttons (فرز سريع + فرز مفصّل + تبويب قيد الفحص + حوار إكمال الفحص)
- [x] Task 4: Status Transitions Documentation (وثيقة شاملة للفريق)

## Phase 24: Operational Excellence - Final Pre-Delivery ✅ COMPLETED
- [x] Task 1: SLA Tracking (SLATimer component + Orange 24h/Red 48h + TriageDashboard integration)
- [x] Task 2: PDF Export (workflowPdfService.ts + /api/export/workflow-guide + زر تصدير في Reports)
- [x] Task 3: Quick Start Guide (دليل شامل للفني/خالد/عبدالفتاح/حارس البوابة)
- [x] Task 4: Code Cleanup (0 console.logs غير مشروعة - كود نظيف)

## Phase 25: Smart Dashboard & Sidebar Refactor ✅ COMPLETED
### Part 1: Sidebar Restructuring
- [x] تجميع الروابط في 4 أقسام قابلة للطي (Core Ops / Logistics / Management / Admin Tools)
- [x] Role-Based Visibility: Gate Security يرى Gate+NFC فقط، Technician يرى Tickets+NFC فقط
- [x] إضافة Search Menu بار في أعلى الـ Sidebar
- [x] تحسين التباعد والأيقونات

### Part 2: Smart Dashboard
- [x] Contextual Cards حسب الدور (Admin/Manager: SLA+Budget، Supervisor: Triage+Inspection، Staff: My Tasks)
- [x] Slide-over Panel عند النقر على البطاقة مع Quick Actions (Approve/Assign/Update)
- [x] Dynamic Border Colors (Red SLA breach / Amber urgent)
- [x] Sparkline Charts لكل بطاقة (7-day trend من getDashboardStats)
- [x] Monitor Mode (full-screen high-contrast مع زر تفعيل)

## Phase 20: نظام تسجيل الدخول المحلي وإدارة المستخدمين
- [x] إلغاء OAuth وتوجيه getLoginUrl إلى صفحة /login المحلية
- [x] إضافة route /login منفصل خارج DashboardLayout في App.tsx
- [x] إنشاء/تحديث حساب admin الافتراضي (username: admin, password: ADMIN2025, role: owner)
- [x] إعادة بناء صفحة Users.tsx مع زر "إضافة مستخدم جديد" (اسم + username + password + دور + هاتف + قسم + بريد)
- [x] إضافة زر تغيير كلمة المرور لكل مستخدم
- [x] إضافة حقل بحث في صفحة المستخدمين
- [x] التحقق من صحة دورة التسعير والاعتماد في PurchaseOrderDetail

## Phase 23: تحسينات الإشعارات والفرز ✅ COMPLETED
- [x] إصلاح: إشعارات مدير الصيانة لم تصل للأدمن - استبدال getUsersByRole("maintenance_manager") بـ getManagerUsers() لتشمل owner+admin+maintenance_manager
- [x] تعيين فني من قائمة منسدلة عند الفرز السريع في TriageDashboard (dialog اختيار الفني + triageTicket يقبل assignedToId)
- [x] تصنيف الإشعارات بألوان (أحمر=حرجة، برتقالي=موافقات، أزرق=معلومات) في popup وصفحة الإشعارات
- [x] صوت تنبيه خفيف (Web Audio API ding) عند ظهور popup الإشعار + زر تحكم بالصوت
- [x] تفعيل Web Push Notifications (Service Worker + VAPID + push router + إرسال تلقائي عند createNotification)

## Phase 24: صلاحيات الأدمن الشاملة - Full Admin Access
- [x] Backend: توسيع accountantProcedure و managementProcedure و delegateProcedure و warehouseProcedure و supervisorProcedure و gateSecurityProcedure لتشمل owner+admin
- [x] Frontend PurchaseOrderDetail: إظهار أزرار موافقة الحسابات والإدارة للأدمن/المالك
- [x] Frontend MyItems: إظهار الصفحة للأدمن/المالك (تسعير + شراء الأصناف) + backend myItems يُرجع كل الأصناف للأدمن
- [x] Frontend DashboardLayout: إضافة MyItems لقائمة الأدمن/المالك
- [x] Frontend TicketDetail: إظهار جميع أزرار دورة البلاغ للأدمن/المالك (isTechnician يشمل admin)
- [x] Frontend PurchaseCycle: إزالة disabled من التبويبات + تفعيل جميع الاستعلامات للأدمن
- [x] Backend: getAllPOItems() دالة جديدة لإرجاع كل الأصناف للأدمن
- [x] اختبار TypeScript - لا أخطاء

## Phase 25: إشعار المندوب عند اعتماد الإدارة
- [x] تحسين إشعار المندوب عند approveManagement ليتضمن رقم طلب الشراء وأسماء الأصناف المطلوبة منه
- [x] إضافة إشعار للمدير إذا لم يكن هناك مندوب مُعيَّن للأصناف

## Phase 26: مراحل قيد التنفيذ وتم الإصلاح مع صورة
- [x] Backend: startRepair يقبل من حالات repaired/assigned/purchase_approved/purchased
- [x] Backend: completeRepair جعل afterPhotoUrl إلزامياً + التحقق من in_progress
- [x] Frontend TicketDetail: canStartRepair يشمل حالة repaired/purchase_approved/purchased
- [x] Frontend TicketDetail: زر تم الإصلاح معطّل حتى رفع الصورة
- [x] إشعار للمدير عند بدء التنفيذ وعند إتمام الإصلاح

## Phase 27: حقل مبلغ العهدة في طلبات الشراء
- [x] Schema: إضافة custodyAmount (decimal) لجدول purchaseOrders + migration
- [x] Backend: approveAccounting يقبل custodyAmount اختيارياً ويحفظه + يتضمنه في إشعار الإدارة
- [x] Backend: إشعار المندوب عند approveManagement يتضمن مبلغ العهدة المُصرف له
- [x] Frontend PurchaseOrderDetail: حقل مبلغ العهدة (اختياري) في قسم موافقة الحسابات
- [x] Frontend PurchaseOrderDetail: بطاقة عرض مبلغ العهدة باللون العنبري في تفاصيل الطلب

## Phase 28: سد فجوات الإشعارات الكاملة
- [x] confirmDeliveryToWarehouse: إشعار للفني المُعيَّن + المدير بوصول المواد للمستودع
- [x] reject (طلب الشراء): إشعار لمنشئ الطلب + المدير بالرفض مع السبب
- [x] close (إغلاق البلاغ): إشعار للمُبلِغ + الفني بإغلاق البلاغ
- [x] closeBySupervisor: إشعار للمدير + المُبلِغ + الفني بإغلاق البلاغ
- [x] approve (موافقة المدير على البلاغ): إشعار للمشرف بالموافقة
- [x] approveWork مسار B: إشعار للفني بالموافقة وبدء طلب الشراء

## Phase 29: واجهة بطاقات فلتر الإشعارات العصرية
- [ ] Schema: إضافة "critical" إلى enum نوع الإشعار + migration
- [ ] Frontend: إعادة بناء صفحة الإشعارات بواجهة بطاقات فلتر تفاعلية (الكل / حرجة / تنبيهات / إنجازات / معلومات / غير مقروءة)
- [ ] Frontend: كل بطاقة تعرض أيقونة + اسم + عداد + تأثير نشاط عند الضغط
- [ ] Frontend: الفلترة فورية بدون تحميل جديد

## Phase 30: تقرير دورة الشراء ودورة الصيانة
- [x] Backend: procedure purchaseCycleReport - وقت كل مرحلة على مستوى كل صنف (تسعير → اعتماد → شراء → مستودع → تسليم)
- [x] Backend: procedure maintenanceCycleReport - وقت كل مرحلة لكل بلاغ من المهد للحد
- [x] Frontend: صفحة PurchaseCycleReport مع ملخص المراحل + جدول الطلبات + تفاصيل الأصناف
- [x] Frontend: صفحة MaintenanceCycleReport مع ملخص المراحل + جدول البلاغات + تفاصيل المراحل
- [x] Navigation: ربط التقريرين بالـ sidebar + routes في App.tsx
- [x] i18n: إضافة مفاتيح الترجمة للتقريرين (ar, en, ur)
- [x] Tests: اختبارات vitest لكلا الـ procedures (4 اختبارات تمر بنجاح)

## Phase 31: نظام الأقسام (Sections)
- [x] إضافة جدول sections في schema مرتبط بـ sites
- [x] إضافة sectionId في جداول assets وtickets وpurchaseOrders
- [x] تشغيل db:push لتطبيق التغييرات
- [x] إضافة db helpers: getSections, createSection, updateSection, deleteSection
- [x] إضافة sections router في routers.ts (list, create, update, delete)
- [x] بناء صفحة Sections.tsx لإدارة الأقسام
- [x] تحديث Assets.tsx لدعم اختيار القسم
- [x] تحديث CreateTicket.tsx لدعم اختيار القسم
- [x] إضافة route /sections في App.tsx
- [x] إضافة Sections في DashboardLayout sidebar
- [x] إضافة مفاتيح الترجمة في ar/en/ur
- [x] 5 اختبارات vitest ناجحة

## Phase 32: نظام الفنيين
- [ ] إضافة جدول technicians في schema (اسم، تخصص، حالة)
- [ ] إضافة حقل assignedTechnicianId وassignedAt في جدول tickets
- [ ] db helpers وprocedures لإدارة الفنيين
- [ ] صفحة إدارة الفنيين في sidebar
- [ ] تحديث نموذج إسناد البلاغ لاختيار الفني
- [ ] تحديث تقرير أداء الفنيين ليعرض البيانات حسب الفني المُسند
- [x] إضافة جدول technicians في قاعدة البيانات
- [x] إضافة حقول assignedTechnicianId وassignedAt في جدول tickets
- [x] بناء صفحة إدارة الفنيين (إضافة/تعديل/حذف)
- [x] ربط البلاغ بفني خارجي محدد عند الإسناد
- [x] إضافة تبويب الفنيين الخارجيين في تقرير الأداء

## Phase 33: تحويل الصور تلقائياً إلى WebP
- [x] تثبيت مكتبة sharp
- [x] تعديل /api/upload لتحويل الصور إلى WebP قبل الرفع إلى S3
- [x] اختبار التحويل (PNG→WebP ✓, JPEG→WebP ✓, PDF يبقى PDF ✓, WebP يبقى WebP ✓)

## Phase 34: صفحة تقارير التكاليف البصرية
- [x] Backend: procedure getCostReport (تكاليف حسب القسم والموقع مع فلاتر زمنية)
- [x] Frontend: صفحة CostReport بتصميم بصري (رسوم بيانية + جدول تفصيلي + فلاتر)
- [x] ربط بطاقة "إجمالي تكلفة الصيانة" في لوحة التحكم بالصفحة الجديدة

## Phase 35: إصلاح نواقص تقرير التكاليف
- [x] Backend: توحيد مصدر الحساب من purchaseOrderItems (المستلمة فعلياً) بدلاً من purchaseOrders
- [x] Backend: إضافة مجموعة "غير محدد" للتكاليف غير المرتبطة بموقع/قسم
- [x] Frontend: إضافة عمود "بلاغات بدون تكلفة" في الجدول
- [x] Frontend: رسالة توضيحية عند فراغ البيانات تشرح السبب
- [x] Frontend: صف الإجمالي يشمل التكاليف غير المصنفة

## Phase 36: فلاتر أداء الفنيين
- [x] Backend: إضافة فلاتر siteId, sectionId, technicianName في procedure أداء الفنيين
- [x] Frontend: إضافة شريط فلاتر (اسم الفني، الموقع، القسم) في صفحة أداء الفنيين

## Phase 37: تفعيل PWA
- [x] إنشاء Web App Manifest (manifest.json) مع shortcuts للبلاغات ولوحة التحكم
- [x] توليد أيقونات التطبيق بجميع الأحجام (72، 96، 128، 144، 152، 192، 384، 512)
- [x] تحديث Service Worker ليشمل التخزين المؤقت + العمل بدون إنترنت جزئياً
- [x] ربط manifest ومعلومات PWA بـ index.html
- [x] إضافة Install Banner في DashboardLayout مع زر تثبيت وزر إغلاق
- [x] تسجيل Service Worker في main.tsx

## Phase 38: رسالة توجيهية لمستخدمي iPhone
- [x] إضافة iOS Install Guide في DashboardLayout يظهر فقط على iPhone/iPad
- [x] يشرح خطوات التثبيت اليدوي عبر Safari بأربع خطوات واضحة
- [x] يختفي بعد الضغط على "فهمت، شكراً" ويحفظ الخيار في localStorage

## Phase 39: بانر التثبيت الدائم
- [x] تعديل بانر Android/Windows/Mac: يظهر دائماً عند كل دخول (إغلاق مؤقت للجلسة عبر sessionStorage)
- [x] تعديل iOS Guide: يظهر دائماً عند كل دخول (إغلاق مؤقت للجلسة عبر sessionStorage)
- [x] كلاهما يختفي نهائياً فقط عند التثبيت الفعلي (localStorage)

## Phase 40: زر التثبيت الثابت
- [x] إضافة زر تثبيت صغير ثابت بجانب زر تغيير اللغة في أسفل الشريط الجانبي
- [x] يظهر فقط إذا لم يكن البرنامج مثبتاً (نفس منطق البانر)
- [x] على iOS يفتح نافذة التوجيه بدلاً من prompt التثبيت — مع نقطة خضراء متحركة للفت الانتباه

## Phase 41: إصلاح PWA - أيقونات maskable وتحسين منطق التثبيت
- [x] إعادة توليد جميع أيقونات PWA بخلفية بنفسجية كاملة (بدون شفافية) لضمان maskable
- [x] فصل أيقونات "any" و"maskable" في manifest.json (كل حجم يظهر مرتين)
- [x] تحديث manifest.json: اسم "تولان - نظام الصيانة"، إضافة حقل id، تحسين background_color
- [x] تحديث sw.js إلى v2 مع أيقونات صحيحة في إشعارات Push
- [x] تحسين منطق handleInstallPWA: await صحيح + try/catch + حدث appinstalled
- [x] إضافة listener لحدث appinstalled لإخفاء الزر بعد التثبيت الناجح
- [x] تحسين showInstallButton ليعتمد على isInstalled state بدلاً من window.matchMedia فقط

## Phase 42: تحسينات قسم الصيانة الوقائية (بدون ربط بالبلاغات)

### أولوية عالية
- [ ] إضافة بحث وفلترة في قائمة الخطط (بالأصل / الموقع / التكرار)
- [ ] إضافة فلترة في أوامر العمل (بالحالة / الفني / التاريخ)
- [ ] إضافة رفع صورة إتمام العمل في dialog أمر العمل
- [ ] إضافة حقل ملاحظات لكل بند من بنود Checklist في dialog أمر العمل

### أولوية متوسطة
- [ ] تفعيل Cron Job للتشغيل التلقائي لـ pm-automation (إنشاء أوامر عمل تلقائياً)
- [ ] إضافة زر تعطيل/تفعيل الخطة (isActive) في الواجهة

### أولوية منخفضة
- [ ] إضافة صفحة تقرير مستقلة للصيانة الوقائية
- [ ] إضافة تصدير Excel لقائمة الخطط وأوامر العمل
- [ ] إضافة زر طباعة أمر العمل
- [ ] إدراج بيانات الصيانة الوقائية في تقرير الأقسام وتقرير التكاليف

## Phase 43: إشعار push للفني عند إنشاء أمر عمل وقائي
- [x] إرسال push notification للفني المعيّن عند إنشاء أمر عمل تلقائياً من Cron

## Phase 44: إصلاح جذري لأوامر العمل الوقائية
- [x] إصلاح checklistResults يرسل null عند الحفظ (حل جذري يمنع التكرار)
- [x] تسريع رفع صورة إتمام العمل

## Phase 45: إصلاح الترجمة التلقائية عند التعديل
- [x] إضافة translateFields في tickets.update عند تغيير العنوان أو الوصف
- [x] إضافة translateFields في assets.update عند تغيير الوصف أو الملاحظات
- [x] فحص باقي procedures التعديل التي تحتوي على حقول نصية قابلة للترجمة

## Phase 46: ترجمة ملاحظات الصيانة الوقائية
- [x] إضافة translateFields لحقل technicianNotes في updateWorkOrder

## Phase 47: خطة الإصلاح الأمني الشاملة
- [ ] C-01: تأمين Export endpoints بإضافة requireAuthMiddleware
- [ ] C-02: تأمين Upload endpoint بإضافة requireAuthMiddleware
- [ ] H-01: رفع الحد الأدنى لكلمة المرور إلى 8 أحرف مع Regex
- [ ] H-02: تفعيل CSP في Helmet
- [ ] H-03: تقليل Body Parser limit إلى 1MB
- [ ] M-02: ضبط sameSite=strict وdomain في cookies.ts
- [ ] M-03: تنظيف id في chart.tsx لمنع XSS
- [ ] M-04: عزل Cache keys بـ userId/role
- [ ] L-01: إضافة purchase_manager لقائمة 2FA الإلزامية
- [ ] L-02: إضافة file-type validation للرفع
- [ ] M-01: تحسين Rate Limiter لتشمل /api/trpc

## Phase 48: الميزات التشغيلية الثلاث
- [x] توليد PDF لأمر العمل الوقائي (Checklist + حالة الأصل قبل وبعد) + زر PDF في الواجهة
- [x] إشعار تذكيري تلقائي بعد 24 ساعة بدون تحديث من الفني (pm-reminder.ts)
- [x] تقرير مقارنة الصيانة الوقائية vs الطارئة لكل قسم (رسوم بيانية مقارنة + نسب مئوية)
- [x] إصلاح أخطاء TypeScript (ipKeyGenerator + pm-reminder import)

## Phase 49: تحسينات إدارة المستخدمين
- [x] إضافة حقل isActive في جدول users (موجود مسبقاً)
- [x] procedure تعطيل/تفعيل المستخدم (users.toggleActive)
- [x] التحقق من كلمة مرور المدير عند حذف المستخدم (users.delete)
- [x] منع تسجيل دخول المستخدمين المعطّلين (موجود مسبقاً)
- [x] تحديث واجهة Users.tsx: نافذة تأكيد الحذف بكلمة المرور
- [x] تحديث واجهة Users.tsx: زر تعطيل/تفعيل مع badge الحالة
- [x] تحديث واجهة Users.tsx: فلتر سريع حسب الدور

## Phase 50: تحسين رسائل خطأ كلمة المرور
- [x] إنشاء component PasswordStrengthIndicator (مؤشر بصري للمتطلبات)
- [x] تطبيقه في نافذة إنشاء مستخدم جديد
- [x] تطبيقه في نافذة تغيير كلمة المرور (resetPassword)
- [x] إضافة زر "تغيير كلمة المرور" في قائمة المستخدم (DashboardLayout) مع مؤشر بصري
- [x] إصلاح رسائل الخطأ الخام (JSON) - الزر معطّل حتى تكتمل المتطلبات

## Phase 51: إعادة تصميم الصيانة الوقائية المتكاملة
- [x] حفظ Checkpoint قبل التطوير (ec17fea2)
- [x] تحديث Schema: جداول pm_execution_sessions و pm_execution_results و pm_templates و pm_template_items
- [x] Backend: procedures للجلسات والنتائج وتقرير معدل الاكتشاف
- [x] واجهة الفني: PMExecution.tsx (بند واحد بالوقت + عداد + شريط تقدم + 3 خيارات)
- [x] زر "ابدأ الفحص" في بطاقة أمر العمل الوقائي
- [x] تقرير معدل اكتشاف الأعطال في SectionReport.tsx (4 بطاقات + شريط تصنيف)

## Phase 52: إشعارات ملونة + سجل الفحوصات
- [x] إشعارات ملونة داخل التطبيق لجميع المديرين بعد اكتمال الفحص (critical/warning/success)
- [x] تبويب "سجل الفحوصات" في AssetHistory.tsx (آخر 10 جلسات + بطاقات ملونة + مدة الفحص)

## Phase 53: إشعار Push للفني + رسم بياني تطور الفحوصات
- [x] إشعار push للفني عند إنشاء أمر عمل وقائي جديد (generateWorkOrder + webPush)
- [x] رسم بياني AreaChart لتطور نتائج الفحوصات عبر الزمن في AssetHistory.tsx (سليم/إصلاح/خلل)

## Phase 54: الرقابة الوقتية + SLA Push + تقرير الفني
- [ ] Backend: procedure getKpiTimeline للبلاغات وطلبات الشراء + تحليل الاختناقات بالذكاء الاصطناعي
- [ ] Frontend: واجهة الرقابة الوقتية البصرية في مركز الإشعارات (Timeline cards + ألوان)
- [ ] إشعار Push تلقائي عند تجاوز SLA 48 ساعة (job دوري)
- [ ] تقرير أداء الفني الشهري (فحوصات + معدل اكتشاف الأعطال)

## Phase 55: بطاقة ملخص الصيانة الوقائية الشهرية في Dashboard
- [x] Backend: procedure pmMonthlySummary في dashboard router (خطط نشطة + مكتمل + معلق + متأخر + نسبة إنجاز)
- [x] Frontend: PMSummaryCard component مع شريط تقدم ملون + 4 إحصائيات + تنقل لصفحة الصيانة الوقائية
- [x] تظهر للأدوار: admin, owner, senior_management, maintenance_manager, supervisor

## Phase 56-57: إصلاح نظام الترجمة (المرحلة 1 و2)
- [ ] Phase 56: إضافة مفاتيح ترجمة جديدة واستبدال 490 نصاً مضمّناً في 27 صفحة
- [ ] Phase 57: تفعيل useTranslatedField في الصفحات التي تعرض بيانات المستخدمين
