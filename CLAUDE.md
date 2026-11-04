# ⚠️ اقرأ هذا الملف أولًا قبل أي تحليل أو تطوير في هذا المشروع

هذا الملف يُقرأ تلقائيًا بواسطة أدوات الذكاء الاصطناعي البرمجية (مثل Claude Code) عند فتح هذا المشروع.
إن كنت مطوّرًا بشريًا، اقرأه أنت أيضًا أولًا — يوثّق قرارات وإصلاحات مهمة قد لا تكون واضحة من الكود وحده.

---

## 📌 القاعدة  الذهبية لهذا المشروع

**قبل أي تعديل على مسارات طلبات الشراء (`purchase orders`) أو الاستلام (`warehouse receipts`) أو المخزون (`inventory`)،
اقرأ `docs/CHANGELOG_TECHNICAL.md` كاملًا.** هذه المسارات خضعت لتحقيق أمني وتقني كبير (يوليو 2026)، وتحتوي على
إصلاحات حرجة يسهل نقضها بالخطأ عند أي إعادة هيكلة أو ميزة جديدة.

**في بداية كل جلسة عمل جديدة، افتح أيضًا `docs/PENDING_TASKS.md`.** يحتوي أي مشكلة أو تطوير طلب صاحب المشروع
تأجيله عمدًا. إن وُجد أي بند معلَّق فيه، ذكِّره به استباقيًا في ردك الأول دون انتظار أن يسأل.

---

## 🔒 القواعد الحرجة — لا تنقضها أبدًا دون فهم كامل للسبب

1. **أي عملية `.every()` أو ما شابهها على قائمة قد تكون فارغة (بنود طلب شراء، حركات مخزون) يجب أن تُسبَق بالتحقق
   من `array.length > 0` صراحة.** غيابه تسبب سابقًا في تصنيف طلبات فارغة تمامًا كـ"مُستلمة بنجاح" — راجع
   `docs/CHANGELOG_TECHNICAL.md` (الإصلاح #6).

2. **أي إجراء يستقبل `itemId` (أو ما شابه) و`parentId`/`purchaseOrderId` معًا من العميل يجب أن يتحقق أن الأول
   ينتمي فعلًا للثاني قبل أي حذف أو تعديل.** هذا كان ثغرة IDOR فعلية — راجع الإصلاح #1.

3. **إنشاء طلب شراء (رأس + بنود) يجب أن يبقى داخل معاملة ذرية واحدة (`db.withTransaction`).** لا تفصل بين
   `createPurchaseOrder` و`createPOItems` مرة أخرى — راجع الإصلاح #5.

4. **لا تُنشئ نسخة ثالثة/رابعة من "إجراء الاستلام" دون التحقق من ملكية الصنف لطلب الشراء.** هذا حدث مرتين
   سابقًا (v1 القديم، ثم مسار الاستلام المستقل) وكلاهما أُصلح — راجع الإصلاحات #4 و#8.

5. **الجداول التالية محمية الآن بمفاتيح خارجية فعلية على مستوى قاعدة البيانات نفسها** (وليس فقط الكود):
   - `purchase_order_items.purchaseOrderId → purchase_orders.id`
   - `warehouse_receipt_items.purchaseOrderItemId → purchase_order_items.id`
   - `inventory_transactions.purchaseOrderItemId → purchase_order_items.id`

   **لا تُعطِّل `foreign_key_checks` ولا تحذف هذه القيود** إلا إذا كنت تعرف بالضبط ما تفعل ولديك خطة احتواء
   مطابقة لما هو موثَّق في القسم 12.5 من التقرير الأصلي (راجع الأرشيف إن احتجته).

6. **جداول الأرشيف التالية موجودة وتحتوي بيانات تاريخية حقيقية — لا تحذفها ولا تتجاهلها:**
   - `purchase_orders_legacy_orphans`
   - `warehouse_receipts_legacy_orphans`
   - `warehouse_receipt_items_legacy_orphans`
   - `inventory_transactions_legacy_orphans`

   هذه تحتوي 9 طلبات شراء + 8 سندات استلام + 12 صنف + 3 حركات مخزون كانت "أشباحًا" (بيانات مفقودة الربط)
   من فترة ما قبل بناء دورة المخزون الحقيقية (قبل 6-7-2026). محفوظة للأثر التاريخي والمراجعة المحاسبية.

---

6. **لا تُنشئ ملفَي راوتر بأسماء متشابهة لنفس نطاق العمل** (مثال حقيقي وقع فعليًا في هذا المشروع:
   `reports.router.ts` و`purchase-reports.router.ts` كان لكل منهما إجراءات بنفس الاسم تمامًا
   `purchaseCycleReport`/`costReport`، أحدهما مُستخدَم فعليًا والآخر كود ميت 100% — أدى هذا لساعات
   من التشخيص الخاطئ لأن التعديلات كانت تُطبَّق على الملف غير المُستخدَم). **قبل تعديل أي إجراء في
   راوتر تقارير، تحقق أولًا من اسم مساحة الاسم الفعلي الذي تستدعيه الواجهة** (`trpc.X.Y`) في الصفحة
   المعنية، ولا تفترض أن اسم الملف يطابق ما تستدعيه الواجهة. منطق حساب مراحل طلب الشراء موحَّد الآن في
   `server/services/reports/purchaseCyclePhases.ts` — أي تعديل عليه يجب أن يمر من هناك حصرًا.

7. **صلاحية مدير الإنشاءات على البلاغات ليست صلاحية دور عامة.** يجب في كل قراءة أو إجراء أو مرفق التحقق معًا من
   أن `maintenanceResponsibleDepartment = maintenance_report_department_construction` وأن
   `maintenanceResponsibleManagerId = user.id`. الاستثناء الوحيد هو بلاغ مرتبط بطلب شراء يستطيع رؤيته، وهذا
   الاستثناء **للقراءة فقط**. لا تعتمد على إخفاء القوائم أو الأزرار في الواجهة، ولا توسّع الوصول لكل من يحمل دور
   `construction_procurement_manager`.

8. **كل مخزن فرعي (`warehouses.type = 'branch'`) يجب أن يكون مرتبطًا بتصنيف واحد فقط من المستوى الأول
   (`catalog_nodes.level = 1`) بالكتالوج، ولا يجوز لتصنيف واحد أن يُربط بأكثر من مخزن فرعي.** هذا مفروض
   بفهرس فريد (`idx_warehouses_catalog_node_unique`) على مستوى قاعدة البيانات نفسها بجانب التحقق البرمجي في
   `createSubWarehouse` — لا تُزل أيًا منهما. أي تحويل مخزون بين مخزنين (`server/_core/db/warehouses.ts::
   createWarehouseTransfer`) يجب أن يبقى داخل معاملة ذرية واحدة (`withTransaction`) بالضبط كإنشاء طلب الشراء
   الموثّق بالإصلاح #5 أعلاه — لا تفصل حركتَي الخصم والإضافة عن بعضهما. عدم تطابق تصنيف الصنف مع تصنيف المخزن
   الهدف **تنبيه فقط وليس منعًا** (قرار صريح من صاحب المشروع بتاريخ 2026-08-05) — لا تحوّله إلى حظر دون طلب
   صريح جديد. راجع `docs/CHANGELOG_TECHNICAL.md` (بند 2026-08-05) للتفاصيل الكاملة.

9. **جدول `warehouse_transfers` يحتوي عمود `batchId` اختياريًا (NULL مسموح) يربطه بجدول رأسي
   `warehouse_transfer_batches` يجمع أصناف عملية تحويل واحدة (حتى 20 صنفاً) تحت رقم عملية واحد.** لا تفترض
   أبدًا أن كل صف بـ`warehouse_transfers` منتمٍ لعملية مجمَّعة — الصفوف الأقدم من 2026-08-05 لها
   `batchId = NULL` وتُعامَل كعمليات أحادية الصنف مستقلة بذاتها (راجع منطق المفتاح المركّب `batch:<id>` مقابل
   `legacy:<id>` في `getWarehouseTransferBatchCards`/`getWarehouseTransferBatchDetail`). كل صنف داخل العملية
   المجمَّعة (`createWarehouseTransferBatch`) يبقى معاملة ذرية مستقلة بذاتها عبر `createWarehouseTransfer` —
   **لا تُحوِّل العملية كاملة لمعاملة واحدة**؛ فشل صنف واحد يجب ألا يُسقِط بقية الأصناف الناجحة بنفس العملية.
   راجع `docs/CHANGELOG_TECHNICAL.md` (بند 2026-08-05 "متابعة") للتفاصيل الكاملة.

10. **`adminOwnerProcedure` (بـ`server/routers/_shared/procedures.ts`) يُستخدَم لأي عملية حسّاسة يجب أن
    تقتصر على أدمن ومالك فقط، حتى دون دور صاحب العلاقة المعتاد (مثال فعلي: تعديل اسم مخزن فرعي — لا يصل له
    حتى دور `warehouse` العادي رغم أنه المسؤول المعتاد عن المخازن).** تُبنى هذه الصلاحية بتمرير مصفوفة فارغة
    لـ`roleMiddleware([])` — هذا يعمل فقط لأن فحص `roleMiddleware` الداخلي يسمح دائمًا لـ`ADMIN`/`OWNER` بغض
    النظر عن محتوى القائمة الممرَّرة (راجع أعلى نفس الملف). **لا تُضِف صراحة `APP_ROLE.ADMIN`/`APP_ROLE.OWNER`
    لهذه القائمة الفارغة** — لا يُغيّر السلوك، لكنه يُلغي الغرض التوضيحي من الفراغ المقصود. راجع
    `docs/CHANGELOG_TECHNICAL.md` (بند 2026-08-05 "متابعة 2") للتفاصيل الكاملة.

11. **البلاغ لم يعد كيانًا أحادي المسار — أصبح "رأس + بنود" (`ticket_items`، أُنشئ 2026-08-08).** كل بلاغ
    — قديمًا كان أم جديدًا — له بند واحد على الأقل، وكل بند يحمل جهته المسؤولة ومساره (A/B/C) وحالته
    المستقلة. لا تكتب أي منطق يفترض "مسار واحد لكل بلاغ" بعد الآن.

    - **أعمدة `tickets` القديمة (`status`, `maintenancePath`, `repairNotes`, `assignedToId`, ...) لم
      تُحذف عمدًا** — أصبحت "ملخصًا" للبلاغ لتبقى كل الشاشات والتقارير والمستندات القائمة عاملة دون كسر.
      **لا تحذفها ولا تعتمد عليها كمصدر حقيقة** لأي منطق جديد؛ مصدر الحقيقة للتنفيذ هو `ticket_items`.
    - **قاعدة مزامنة ثنائية الاتجاه (2026-08-12):** إجراءات مستوى البند تعكس البند الأول على `tickets`
      للتوافق، وبالمقابل أي إجراء Workflow قديم يعمل على رأس بلاغ أحادي/فرعي يجب أن يزامن **البند الوحيد**
      عبر `server/_core/db/tickets.ts::syncSingleTicketItem`. لا تستخدم هذه الدالة في البلاغ متعدد البنود
      ولا تستبدلها بـ"حدّث البند الأول"؛ شرطها المتعمد أن يكون عدد البنود === 1. هذا يمنع حالة يكون فيها
      `tickets` على A/B/C بينما `ticket_items` ما زال `under_inspection`، وهي ثغرة بيانات مؤكدة أثناء اختبار
      البلاغات الفرعية بتاريخ 2026-08-12.
    - **`ticket_items.status` يستخدم قائمة حالات `tickets.status` الـ21 حرفيًا**، و
      `ticket_items.responsibleDepartment` يستخدم قيم `tickets.maintenanceResponsibleDepartment` حرفيًا.
      هذا مقصود ليعمل منطق `tickets.access.ts` و`shared/pathBPurchaseWorkflow.ts` على البند مباشرة بلا
      طبقة تحويل قيم — **لا تُغيّر أيًا من القائمتين لتنحرف عن الأخرى.**
    - `ticket_items.ticketId` مفتاح خارجي فعلي بـ`ON DELETE RESTRICT`. **أي دالة حذف بلاغ يجب أن تحذف
      البنود أولًا** (مطبَّق في `server/_core/db/deletes.ts::deleteTicket`) وإلا فشل الحذف بالكامل.
    - `createTicketItems` ترفض المصفوفة الفارغة صراحةً — نفس حارس `createPOItems` بالإصلاح #5 أعلاه.
      **لا تُنشئ بلاغًا بلا بند واحد على الأقل إطلاقًا.**
    - أي `ticketItemId` يصل من العميل مصحوبًا بـ`ticketId` يجب أن يمر على
      `assertTicketItemBelongsToTicket` قبل أي تعديل أو حذف — نفس ثغرة IDOR بالقاعدة #2 أعلاه.
    - **الميزة تُنفَّذ على خطوات متتابعة بقرار صاحب المشروع.** قبل أي عمل عليها راجع
      `docs/PENDING_TASKS.md` لمعرفة أي خطوة أُنجزت وأيها لم تبدأ بعد، و
      `docs/CHANGELOG_TECHNICAL.md` (بند 2026-08-08) للتفاصيل الكاملة.

12. **بنود البلاغ (`ticket_items`) مصدر حقيقة إضافي للرؤية والقوائم، لا عمود البلاغ وحده (2026-08-08).**
    عمود `tickets.maintenanceResponsibleDepartment`/`maintenanceResponsibleManagerId`/`assignedToId`/
    `assignedTechnicianId` يمثّل **الجهة/الفني الرئيسي فقط**. بالفرز المتعدد، أي جهة أو فني **ثانوي** لا
    تعكسه أعمدة البلاغ إطلاقًا — يظهر فقط في `ticket_items`. **أي قاعدة صلاحية أو فلتر قائمة جديد يفحص
    "هل هذا المستخدم مسؤول عن هذا البلاغ؟" يجب أن يفحص `ticket_items` أيضًا، لا عمود البلاغ فقط**، وإلا
    ستُمنع الجهات الثانوية من رؤية بلاغاتها (ثغرة حقيقية وقعت واكتُشفت بتاريخ 2026-08-08).
    - النمط المعتمد (راجع `tickets.access.ts::assertTicketReadable` و`server/_core/db/tickets.ts::buildTicketsWhere`
      كمرجع تنفيذي): **مسار سريع أولًا** يفحص عمود البلاغ فقط (بلا استعلام إضافي — يكفي لأي بلاغ أحادي
      البند، وهي الأغلبية الساحقة)، و**مسار كامل فقط عند فشل المسار السريع** يفحص `ticket_items` (استعلام
      إضافي واحد، أو شرط `OR EXISTS(...)` بالـSQL). **لا تستبدل عمود البلاغ بالبنود بالكامل** — كلاهما
      يُفحص معًا (OR)، لأن عمود البلاغ يبقى الأسرع للحالة الشائعة.
    - قرار صريح من صاحب المشروع (رفض حل مؤقت): هذا مبدأ **دائم لكل صلاحية/قائمة جديدة تُبنى مستقبلًا**
      تخص البلاغات، لا رقعة لمرة واحدة. راجع `docs/CHANGELOG_TECHNICAL.md` (بند 2026-08-08 "ثغرة صلاحيات
      مكتشَفة بالفرز المتعدد") للتفاصيل الكاملة.
    - إجراءات سير العمل متعددة البنود أصبحت تستخدم حراس/إجراءات مستوى البند (`assertTicketItemWorkflowManageable`
      وإجراءات `*ForItem`). إجراءات رأس البلاغ القديمة تبقى للبلاغ الأحادي والبلاغ الفرعي للتوافق، ومع قاعدة
      2026-08-12 أعلاه يجب أن تزامن البند الوحيد عند أي انتقال حالة/مسار. لا توسّع إجراء رأس البلاغ ليحرّك
      عدة بنود؛ استقلال البنود في البلاغ المتعدد مبدأ دائم.

13. **قيود TiDB بالترحيلات — مؤكَّدة عمليًا على الإنتاج (2026-08-08/09).** قاعدة المشروع TiDB لا MySQL
    قياسي، وثلاث صيغ شائعة **لا تعمل كما هو متوقَّع**. تجنّبها بأي ترحيل مستقبلي:
    - ❌ `CREATE TABLE x AS SELECT ...` → يفشل صراحةً (`not implemented yet`).
      ✅ البديل: `CREATE TABLE x LIKE y;` ثم `INSERT INTO x SELECT * FROM y;` (عبارتان منفصلتان).
    - ❌ `ALTER TABLE x AUTO_INCREMENT = n` → يعيد `Query OK` **لكنه لا يُطبَّق فعليًا** على جدول فارغ،
      و`SHOW TABLE STATUS` يُظهر `Auto_increment = 0`. ✅ البديل لجداول العدّادات: إدراج صفوف فعلية بعدد
      الرقم المطلوب (`INSERT INTO counter (year) SELECT <y> FROM <table> t1, <table> t2 LIMIT n;`)
      والاعتماد على `MAX(id)` كمرجع. تحقّق دائمًا بـ`SELECT COUNT(*), MAX(id)` لا بـ`SHOW TABLE STATUS`.
    - ✅ `TRUNCATE TABLE` **يصفّر العدّاد فعليًا** (بعكس `DELETE`) — الطريقة المعتمدة لإعادة ضبط عدّاد.
    - **قاعدة تشغيلية**: أداة تنفيذ الاستعلامات المستخدَمة تنفّذ **عبارة واحدة فقط بكل مرة**. أي ترحيل
      يُسلَّم كعبارات مرقّمة منفصلة، مع **تحقق إلزامي صريح** بين الخطوات الحساسة (خصوصًا قبل حذف/استبدال
      فهرس فريد) — هذا التحقق كشف فعليًا 6 سجلات غير متوقعة بترحيل 2026-08-08 قبل وقوع فشل.
    - ⚠️ عند تقديم أوامر **بديلة** (لا متتالية) للمستخدم، صرّح بذلك بوضوح تام — تنفيذ بديلين معًا وقع
      فعليًا وأفسد ضبط عدّاد (عولج بـ`TRUNCATE` وإعادة الضبط).

14. **النموذج الجديد للبلاغ متعدد الجهات يفصل التنظيم عن التنفيذ (2026-08-11) — لا تخلط `ticket_departments`/`ticket_tasks` مع `ticket_items`.**
    التسلسل المعتمد هو: `tickets(workflowModel=department_tasks)` → `ticket_departments` → `ticket_tasks`
    → `ticket_task_assignees` → **اختياريًا فقط** `tickets(workflowModel=sub_ticket)`، والبلاغ الفرعي وحده
    يدخل دورة التنفيذ الحالية (فحص → A/B/C → شراء/صيانة خارجية → تنفيذ → إغلاق).
    - **الجهة ليست بلاغًا فرعيًا، والمهمة لا تصبح بلاغًا فرعيًا تلقائيًا.** الفرز المتعدد يثبت الجهة/الجهات
      ومسؤول كل جهة فقط؛ إنشاء المهام وإسناد الفنيين يأتي بعد ذلك داخل الجهة.
    - `ticket_items` يبقى مصدر حقيقة **لوحدة الـWorkflow التنفيذي والتوافق الرجعي** للبلاغات القديمة والبلاغات
      الفرعية؛ لا تستخدمه لتمثيل طبقة الجهة/المهمة الجديدة. أعمدة رأس `tickets` تبقى ملخصًا للتوافق كما في #11.
    - كل مهمة يمكن أن تضم **فنيًا واحدًا أو عدة فنيين**. عند تحويلها إلى بلاغ فرعي يُنسخ أول فني فقط إلى
      `tickets.assignedToId`/`ticket_items.assignedToId` للتوافق، لكن **جميع** صفوف `ticket_task_assignees`
      يظلون مخوّلين لرؤية البلاغ الفرعي والعمل عليه — لا تحوّل حقل التوافق القديم إلى حارس وحيد للصلاحية.
    - صلاحيات خطة الجهة **أقل امتيازًا**: مدير الجهة يرى/يدير جهته فقط، والفني يرى مهامه المسندة فقط؛
      الوصول الجانبي للبلاغ (مثل طلب شراء مرتبط) لا يكشف خطة الجهات الأخرى.
    - **ترقيم البلاغات الفرعية أحادي الاتجاه ولا يُعاد استخدامه بعد الحذف.** المصدر هو
      `tickets.subTicketCounter` على البلاغ الرئيسي تحت قفل معاملة، وليس `MAX(subTicketSequence)` من الأبناء
      الحاليين. لا تستبدله بحساب أعلى ابن موجود، وإلا سيُعاد استخدام `-01/-02` بعد الحذف.
    - `tickets.sourceTaskId` فريد، وكذلك `(parentTicketId, subTicketSequence)`؛ المهمة الواحدة لا يجوز أن
      تنتج بلاغين فرعيين حتى مع طلبين متزامنين. التحويل يجب أن يقفل صف المهمة والأب داخل نفس المعاملة.
    - **تعديل بيانات البلاغ الأصلي:** أدوار `maintenance_manager` و`general_maintenance_manager` و
      `construction_procurement_manager` لا تعدّل بلاغًا لم تنشئه؛ `owner/admin` يحتفظان بالتجاوز الإداري،
      وبقية الأدوار تبقى على قاعدة التعديل السابقة. هذا القيد يخص تعديل بيانات البلاغ ولا يلغي صلاحيات
      الـWorkflow الممنوحة للمستخدم. يجب فرضه بالخادم والواجهة معًا.
    - **مسار الإنشاءات داخل البلاغ المتعدد (2026-08-11):** عند توجيه جهة الإنشاءات يجب حفظ `ticket_departments.organizationalTitle` كعنوان تنظيمي مستقل عن `routingNote`. مدير الصيانة والتشغيل يحدد الجهة والمسؤول والعنوان فقط؛ لا ينشئ/يوزع/يحوّل مهام جهة الإنشاءات. مسؤول الإنشاءات المحدد هو من ينشئ تحت العنوان مهمة واحدة أو عدة مهام، يوزع الفنيين، ثم يستخدم نفس مسار التحويل القائم إلى بلاغ فرعي. ترقيم أي بلاغ فرعي من هذه المهام يستخدم عداد الأب `tickets.subTicketCounter` نفسه مع باقي الجهات، ولا يوجد عداد خاص بالإنشاءات. `owner/admin` يبقيان تجاوزًا إداريًا.
    - مدير الإنشاءات يستطيع إنشاء بلاغ جديد (`/tickets/new` + إجراء `tickets.create`)؛ ما دام بلاغه الشخصي
      `pending_triage` يراه ويستطيع تعديل بياناته. بعد الفرز يرى ما وُجّه إليه صراحةً سواء كان جهة رئيسية أو
      ثانوية عبر `ticket_departments` — لا توسّع استثناء المنشئ/القراءة لبلاغات الآخرين.
    - أي ترحيل لهذا النموذج يُطبّق كعبارات منفصلة وفق قاعدة TiDB #13، ثم يُختبر عمليًا قبل الاستخدام الفعلي.


15. **ترقيم البلاغ الرئيسي أثناء مشاركة قاعدة البيانات بين نسخ مختلفة يجب أن يستخدم آلية واحدة لدى كل الكتّاب (2026-08-12).**
    حدث تكرار فعلي لـ`MT-2026-00224` ثم `MT-2026-00225` لأن النسخة السحابية القديمة كانت تولّد من أعلى
    رقم موجود في `tickets`، بينما النسخة المحلية الجديدة كانت تستخدم `ticket_number_counter` على **نفس القاعدة**؛
    القديم لا يحدّث العداد، فبقي عند 225 بينما `tickets` تقدم إلى 239 ثم 246.
    - **الحالة الحالية المعتمدة للفترة الانتقالية:** `server/_core/db/tickets.ts::getNextTicketNumber()` يقرأ
      أعلى **بلاغ رئيسي فعلي** من `tickets` ثم `+1`. لا تستخدم `ticket_number_counter` من هذه الدالة حاليًا.
    - يجب أن يبقى شرط استبعاد الأبناء: النمط الرئيسي فقط `^MT-YYYY-[0-9]{5}$`. لا تستبدله بـ`LIKE 'MT-YYYY-%'`
      وحده، لأن أرقامًا مثل `MT-2026-00252-03` بلاغات فرعية ولا يجب أن تدخل حساب الرقم الرئيسي.
    - **لا تحذف** `ticket_number_counter` أو migration التاريخي تلقائيًا؛ وجوده موثق من إصلاح 2026-08-09.
      لكن **لا تعِد تفعيله** طالما توجد نسخة قديمة تكتب على نفس القاعدة ولا تعرفه.
    - ⚠️ العودة إلى `MAX + 1` حل توافق وليست تقوية دائمة: حذف أعلى بلاغ قد يعيد استخدام الرقم، والإنشاء
      المتزامن جدًا قد يتصادم. بعد توحيد كل النسخ يمكن إعادة تصميم عداد دائم/فهرس `UNIQUE` بقرار وترحيل منفصلين
      وبعد فحص التكرارات الفعلية. راجع `docs/TICKET_NUMBERING_SHARED_DB_COMPATIBILITY_FIX.md`.

16. **البلاغ الرئيسي متعدد الجهات (`workflowModel = 'department_tasks'`) له مسار إغلاق واحد فقط، وخطته تُجمَّد بعده (2026-08-12).**
    الرأس لا يملك `maintenancePath` إطلاقًا، لذلك مسارات الإغلاق الثلاثة القائمة (`close` / `closeBySupervisor` /
    `finalClose`) **لا تنطبق عليه ولا يجب توسيعها لتشمله** — كلها تشترط حالة أو مسار A/B/C لا يملكهما. كان هذا
    يُبقي كل بلاغ رئيسي عالقًا على `department_planning` إلى الأبد، ومحسوبًا "مفتوحًا ومتأخرًا" في العدّادات،
    حتى بعد انتهاء كل أبنائه (مؤكَّد فعليًا على `MT-2026-00252` و`MT-2026-00253`).
    - **المسار الوحيد المعتمد:** `tickets.closure.ts::closeParentTicket` — إغلاق **يدوي بحارس** لا تلقائي،
      ليبقى توقيع مسؤول فعلي في `audit_logs` (`close_parent_ticket`). لا تضف إغلاقًا تلقائيًا عند إغلاق آخر
      ابن بلا قرار صريح من صاحب المشروع.
    - **"اكتمال الابن" = `closed` أو `requester_confirmed`، وليس `requester_confirmed` وحدها.** التأكيد فعل
      يخص مقدّم البلاغ وحده (راجع `confirmCompletion`)، واشتراطه للإغلاق يعيد إنتاج نفس التعليق إن لم يؤكد أبدًا.
      المصدر الوحيد لهذا التمييز: `shared/ticketUiRules.ts::summarizeSubTicketFamily` — **استخدمها ولا تعِد
      كتابة المنطق محليًا**، وهي تتحقق من `total > 0` قبل `every()` (قاعدة #1).
    - **الإغلاق يشمل التوابع في نفس الـtransaction:** الرأس + البند التوافقي (وإلا علق `assertAllTicketItemsClosed`)
      + `ticket_departments` إلى `completed` + `ticket_tasks` من `promoted` إلى `completed`. القيمتان موجودتان
      أصلًا في enum القاعدة — **لا Migration**.
    - **بعد الإغلاق تُجمَّد خطة الجهات لكل الأدوار بلا استثناء** عبر
      `tickets.workflow.ts::assertDepartmentPlanEditable` في `createDepartmentTask` و`assignDepartmentTask`
      و`promoteDepartmentTask`. **لا تستثنِ admin/owner** — تعديل بلاغ مغلق ليس صلاحية أعلى بل تجاوز لسجل
      مكتمل. أخطر حالة يمنعها الحارس: `assignDepartmentTask` كان يُرجع الجهة من `completed` إلى `active`
      تحت بلاغ مغلق، و`promoteDepartmentTask` كان ينشئ ابنًا مفتوحًا تحت أب مغلق فيكسر الحارس والنسبة معًا.
    - أي إجراء جديد يعدّل `ticket_departments`/`ticket_tasks` مستقبلًا **يجب أن يستدعي `assertDepartmentPlanEditable`
      أولًا**. راجع `docs/PARENT_TICKET_CLOSURE_AND_PLAN_FREEZE.md`.


17. **Inventory Lots / 2B-8 — لا تفعّل نظام الدفعات جزئيًا ولا تسمح بحركة Aggregate-only (2026-08-17).**
    التصميم المعتمد يفصل `inventory_lots` (هوية المصدر/الدفعة) عن `inventory_lot_balances` (رصيد نفس الدفعة حسب `inventoryId`/المخزن). Catalog Item يبقى هوية الصنف الواحدة.
    - عند تفعيل `INVENTORY_LOTS_ENABLED` يجب دائمًا أن يساوي `inventory.quantity` مجموع Lot Balances لنفس Inventory، وأن يساوي `inventory_lots.remainingQuantity` مجموع Balances لنفس Lot عبر المخازن.
    - **أي** استلام/صرف/مرتجع/تحويل/استبعاد/جرد/تسوية يغيّر كمية يجب أن يحدّث Aggregate Inventory والـLot/Balance المطابق **داخل نفس Transaction**. لا تضف مسارًا يغيّر أحدهما فقط.
    - التحويل بين المخازن ينقل **نفس Lot ونفس QR** بين `fromInventoryId` و`toInventoryId`; لا ينشئ Lot جديدًا ولا ينقص `remainingQuantity` لمجرد تغير الموقع.
    - الرصيد الافتتاحي مصدره `opening_balance`: اختيار Catalog Item إلزامي، ولا مورد/فاتورة وهمية. Receipt source نوعه `receipt`.
    - QR التشغيلي يحمل `trackingToken` داخليًا ولا يضم بيانات المورد/الفاتورة/التكلفة داخله.
    - الصرف المعتمد بعد التفعيل سيكون QR/Lot إلزاميًا؛ لا FIFO/FEFO حاليًا. **كود الصرف المركزي `issueDelivery()` والواجهتان `Inventory.tsx`/`PurchaseCycle.tsx` أصبحت Lot-aware خلف الـFeature Gate بتاريخ 2026-08-17؛ لا تعِد تنفيذها من الصفر.** يبقى UAT التشغيلي بعد اكتمال بقية الحركات.
    - **مرتجع المورد أصبح Lot-aware خلف Feature Gate:** يبدأ باختيار `warehouseId` صريح ثم `trackingToken`. الخادم يحل الصنف وReceipt/PO والمورد/الفاتورة داخل المستودع المحدد فقط ولا يثق بمعرفات المصدر من العميل. `opening_balance` ممنوع. كل تخفيضات Lot/Aggregate + سجل المرتجع + Inventory Transaction تتم في Transaction واحدة. لا تحذف Warehouse Context أو تعد إلى اختيار Balance تلقائي عبر المخازن.
    - **التحويل بين المخازن أصبح Lot-aware خلف Feature Gate (2026-08-18):** كل بند تحويل يمثل Lot واحدًا، والعميل يرسل `trackingToken` وليس `lotId`. التحويل ينقص Balance المصدر ويزيد Balance الهدف لنفس `lotId` داخل نفس Transaction مع Aggregate Inventory وحركتي OUT/IN و`warehouse_transfers.lotId`. **لا تعدّل `inventory_lots.remainingQuantity` في التحويل** لأنه تغيير موقع فقط. عند وجود Catalog identity لا تستخدم fallback بالاسم/الكود إلى Inventory هدف مختلف؛ أنشئ/استخدم Inventory مطابقًا للـCatalog.
    - **الاستبعاد/التالف أصبح Lot-aware خلف Feature Gate (2026-08-18):** عند التفعيل يختار المستخدم المستودع أولًا ثم يمسح `trackingToken`. الخادم يعيد حل الـLot داخل نفس `warehouseId` وداخل Transaction ولا يثق بـ`lotId` أو `inventoryId` من العميل. الخصم ذري من Lot Balance + `remainingQuantity` + Aggregate Inventory، مع `disposal_items.lotId` و`inventory_transactions.lotId`. تكلفة المستند من `inventory.averageCost`. لا تسمح بتغيير المستودع بعد إضافة أول بند في عملية الاستبعاد.
    - **الجرد الدوري/التسوية أصبحا Lot-aware خلف Feature Gate (2026-08-18):** الجرد الدوري يجب أن يكون داخل مستودع محدد وبـLot/QR؛ الجرد الشامل يحمل Snapshot لكل Balance موجب والجزئي يبدأ فارغًا ويضاف له ما يُمسح فقط. `recordCountItem` لا يحفظ Lot بدون إعادة تحقق من نفس Tracking Token. عند التسوية لا تضبط Aggregate Inventory مباشرة إلى الكمية المعدودة؛ طبّق فرق الـLot نفسه على Balance + `remainingQuantity` + Aggregate داخل Transaction. قبل التعديل يجب التحقق أن Snapshot لم يصبح stale وأن `inventory.quantity = SUM(balances)` و`lot.remainingQuantity = SUM(balances across warehouses)`؛ أي اختلاف يوقف التسوية. التسوية اليدوية Aggregate-only تبقى موقوفة عند تفعيل Lots حتى Workflow مستقل معتمد.
    - **UAT النهائي لـ2B-8 نجح بتاريخ 2026-08-18** بعد تفعيل الـGate محليًا: Receipt/Purchase، Delivery من Purchase Cycle وInventory، Transfer، Supplier Return، Disposal، Periodic Count/Settlement، ثم فحوص سلامة كمية وروابط بدون `MISMATCH`. يمكن استخدام `INVENTORY_LOTS_ENABLED=true` في البيئة المعتمدة بعد النشر. على Railway يجب إضافة المتغير في Service Variables؛ `.env` المحلي لا ينتقل عبر GitHub. راجع `docs/inventory/INVENTORY_DEVELOPMENT_PLAN_AND_CHANGE_CONTROL.md` و`docs/CHANGELOG_TECHNICAL.md`.
    - **الصرف بدون QR / اختيار Lot يدوي / FIFO / FEFO مؤجل** إلى قرار Workflow مستقل؛ لا تغيّر هذا السلوك كجزء من صيانة 2B-8 بدون موافقة صريحة.


18. **2B-9 Catalog Taxonomy ↔ Warehouse Taxonomy — COMPLETE / UAT PASSED (2026-08-19).**
    - `catalog_nodes` هي **المصدر الوحيد للتصنيف**. لا تضف `inventory.categoryId` أو `warehouse_categories` أو أي Taxonomy موازية.
    - Inventory يقرأ التصنيف من `inventory.linkedItemId → catalog_items.nodeId → catalog_nodes`. الصنف لا يتغير تصنيفه بسبب وجوده في مخزن مختلف.
    - المخزن الرئيسي عام. `warehouses.catalogNodeId` في المخزن الفرعي هو التخصص/التصنيف الطبيعي فقط **وليس قيد محتوى**؛ صنف من كهرباء يمكن أن يوجد في مخزن دهان ويبقى تحت تصنيفه الحقيقي.
    - `categoryMismatch` في التحويل يبقى **Warning وليس Block** ما لم يصدر قرار Workflow جديد.
    - الجرد الدوري له ثلاثة نطاقات معتمدة: **كل المخزن / Catalog node + descendants / جزئي يدوي بالـQR**.
    - Category-scoped count يحفظ `inventory_count_operations.catalogNodeId`; الخادم يفرض النطاق عند كل QR/Lot ويعيد `COUNT_LOT_OUTSIDE_CATEGORY_SCOPE` إذا كان Lot خارج العقدة المختارة وفروعها.
    - الإدخال اليدوي للجرد هو **Per-Lot** فقط؛ لا Aggregate-only. الخادم يعيد التحقق من Warehouse + Count Item + Lot/Inventory relation + Catalog identity + category scope قبل حفظ الكمية.
    - UAT النهائي Passed: Inventory taxonomy/tree، Cross-category warehouse behavior، QR scope rejection، custom tree scrollbar، Manual Lot count، Full Count regression، Manual Partial QR regression، Tree Search، وتسوية فرق فعلي على `CNT-2026-60023` / `ADJ-2026-30005` مع بقاء Lot invariants سليمة.
    - ظهرت Inventory aggregate mismatches تاريخية من نسخة Cloud قديمة كانت تسمح `delivery` بلا `lotId`; **لا تصلحها تلقائيًا ولا تعتبرها Regression في 2B-9**. البيانات الجديدة النظيفة المستخدمة للإغلاق بقيت متطابقة.
    - مفاتيح رسالة out-of-scope موجودة بالعربية/English/Urdu؛ Runtime العربي Passed. English/Urdu لم يُسجل لهما switch-test مستقل في جلسة الإغلاق، وهذا لا يغير حالة 2B-9 المغلقة.
    - **لا تبدأ 2B-10 تلقائيًا.** Broad FKs/Governance/Integrity/Security تحتاج موافقة صريحة منفصلة.


---

19. **2B-10 Catalog access policy — IMPLEMENTED / UAT PENDING (2026-08-19).**
    - **توسعة صريحة بتاريخ 2026-11-04 ثم تضييق لاحق في اليوم نفسه:** دور `senior_management` يملك إدارة أصناف الكتالوج وإعادة التفعيل والتصنيفات والوحدات والموردين والمرشحين والتدقيق والاستيراد والتصدير؛ **تبويبا النظرة العامة والإعدادات للأدمن والمالك فقط، وsettings.list/get ممنوعان للإدارة العليا** بطلب لاحق. تُمنح مسارات RPC وأنواعها صراحة في `business-role-policy.ts` وإجراءات Catalog فقط، مع بقاء هوية المعتمد الفعلية وفحص النشاط؛ لا يُحوَّل الدور إلى أدمن عام. مدير الإنشاءات يحتفظ بصلاحياته السابقة مضافًا إليها تعطيل الأصناف فقط دون إعادة تفعيلها أو تعطيل التصنيفات/الوحدات أو الإعدادات والاستيراد/التصدير. هذه التوسعة تستبدل حدود الأدوار المذكورة تاريخيًا أدناه في نطاقها فقط، ولا تنشئ وظائف غير منفذة في الواجهات الحالية.
    - وحدة `/catalog` المستقلة متاحة فقط لـ`owner` و`admin` و`construction_procurement_manager`. بقية الأدوار لا ترى الوحدة ولا تدخلها مباشرة.
    - `owner/admin` يملكان الصلاحية الكاملة: إضافة/تعديل/تعطيل، إعدادات، Import/Export.
    - `construction_procurement_manager`: التصنيفات والأصناف = عرض/إضافة/تعديل فقط؛ الوحدات = عرض/إضافة/تعديل فقط؛ الموردون و«الأصناف الجديدة» = كامل الصلاحية داخل تبويبيهما؛ لا Delete/Deactivate للأصناف/التصنيفات/الوحدات ولا Settings ولا Import/Export.
    - **لا توسّع هذه السياسة إلى منع القراءة المرجعية التشغيلية**: `catalogReadProcedure` يبقى متاحًا للأدوار التي تحتاج Catalog داخل PO/Receipt/Warehouse/Inventory حتى لا ينكسر الـWorkflow الحالي. هذه قراءة مرجعية وليست صلاحية دخول لوحدة الكتالوج.
    - حماية الـBackend هي المصدر الحاسم؛ إخفاء الأزرار/التبويبات في الواجهة طبقة إضافية فقط. كتابة مرفقات `catalog_item` تتبع نفس سياسة الإدارة (owner/admin/construction فقط).
    - لا Schema/SQL/DB migration لهذا التغيير.


20. **Main Phase 5.4 Inventory Reconciliation is future-facing and read-only (approved 2026-08-23).**
    - Old/experimental Inventory data remains untouched; do not use 5.4 as Historical Cleanup, Backfill, Revaluation, or Ledger reconstruction.
    - 5.4 approved steps: 5.4.1 Integrity Rules (CLOSED) → 5.4.2 Read-only Engine (CLOSED) → 5.4.3 Exception Report (OFFICIALLY CLOSED) → 5.4.4 Runtime UAT & Closure (NOT STARTED).
    - Core invariants: Inventory quantity ↔ Lot balances; global Lot remaining ↔ warehouse balances; no negative stock; current value consistency with approved rounding tolerance; valid Lot Balance → Inventory → Warehouse identity.
    - Reconciliation findings must not auto-fix data. Centralized numbering, Batch all-or-nothing redesign, Workflow/Accounting redesign, and production cutover are outside 5.4.
    - **Current stop: 5.4.3 is OFFICIALLY CLOSED after Runtime UI verification (`53/53` PASS, zero exceptions) and owner confirmation that the PDF user-guide download button works. Do not start 5.4.4 automatically.**
    - References: `docs/CMMS_PHASE5_STEP4_INVENTORY_RECONCILIATION_APPROVED_SCOPE_2026-08-23.md` and `docs/CMMS_PHASE5_STEP4_1_INVENTORY_INTEGRITY_RULES_CLOSURE_2026-08-23.md`.

21. **بلاغات تقنية المعلومات تعمل بطابور فريق مشترك مع فصل التنفيذ عن الشراء (2026-10-04).**
    - `it_manager` و`it_member` يريان بلاغات جهة IT، وأول عضو ينفذ `claimItTicket` يصبح المسؤول التشغيلي. حجز الرأس والجهة والتحديث الشرطي على `claimedById IS NULL` متطلبات ذرية لا تُفصل.
    - التنفيذ والفحص والإغلاق والمواد/الأصل يتبع العضو المسند إليه البلاغ أو المهمة تحديدًا. عضو الفريق يعتمد فحصه ويغلق عمله بنفس مسار مدير IT الحالي.
    - `it_manager` وحده ينشئ طلب الشراء الرسمي. `it_member` يرفع سجلًا في `it_purchase_needs` والمدير يراجعه أو يعيده أو يحوله ذريًا إلى طلب شراء.
    - إشعار فريق IT الوحيد هو دخول بلاغ جديد إلى طابور الفريق، سواء جاء من التصنيف أو الفرز/التحويل. لا تضف إشعارات إسناد أو شراء أو مستودع أو إغلاق لفريق IT.
    - مدير IT يبقى `responsibleManagerId` للرقابة والشراء حتى عندما يكون `claimedById` أو منفذ المهمة عضوًا آخر. لا تستبدل أحد الحقلين بالآخر.

22. **سياق طلب الشراء أصبح Site → Section → optional Asset + Purchase Category ديناميكيًا (2026-10-04).**
    - إنشاء/حفظ مسودة طلب شراء جديد يتطلب `siteId` و`sectionId`; `assetId` اختياري، والخادم يجب أن يتحقق دائمًا أن القسم تابع للموقع وأن الأصل — إن وُجد — تابع للقسم والموقع. لا تعتمد على فلترة الواجهة وحدها.
    - تغيير الموقع في الواجهة يجب أن يمسح القسم والأصل، وتغيير القسم يجب أن يمسح الأصل، حتى لا يبقى معرّف قديم لا ينتمي للسياق الجديد.
    - `center_categories` هو Master Data المركزي المشترك بين طلبات الشراء والبلاغات الجديدة. `purchase_orders.categoryId` و`tickets.categoryId` يرتبطان به بـ`ON DELETE RESTRICT`. عمود `tickets.category` القديم يبقى مؤقتًا كما هو للتاريخ/التوافق ولا تُرحّل قيمه آليًا في هذه المرحلة. `systemKey='it'` محجوز لمسار تقنية المعلومات في الصيانة فقط؛ طلبات الشراء تتعامل معه كتصنيف عادي.
    - الطلب المرتبط ببلاغ يستطيع وراثة الموقع/القسم والأصل عند غيابها للحفاظ على مسار IT المباشر، لكن `assetId: null` الصريح يعني “بدون أصل” ولا يجوز استبداله تلقائيًا بأصل البلاغ.
    - `purchase_orders.siteId/sectionId` قديمان ومستخدمان في تقارير/توزيع تكلفة لاحق؛ لا تنشئ حقول موقع/قسم موازية لطلب الشراء.


24. **لوحة متابعة المالك/الأدمن (2026-10-13) تفصل البلاغات عن التنفيذ والتكلفة المستلمة عن تكلفة الصيانة.**
    - مصدرها `shared/dashboard-overview.ts` عبر `dashboard.overview/details`: الرئيسي التنظيمي لا يضاف إلى تنفيذ الفرعيات؛ `closed` و`requester_confirmed` منجزان، ووقت الإنجاز `closedAt`.
    - «قيمة المشتريات المستلمة» تجمع `actualTotalCost` للأصناف المستلمة فقط، بلا تقديرات أو ازدواج شراء/صرف؛ تفاصيلها من نفس القواعد. لا تحولها إلى تكلفة تنفيذ الصيانة، فهذا مؤجل.
    - وقت الانتظار عند المدير لا يساوي عمر التذكرة؛ افصل الجهات الأخرى والمسؤولية المتعددة، ولا تخمن تاريخ انتقال غير مسجل. الوقائي وPMV2 خارج هذه اللوحة.
    - القراءة فقط من الجداول القائمة؛ لا تعديل ورك فلو أو بيانات لإصلاح العداد. راجع `docs/dashboard/IMPLEMENTATION_REPORT_AR.md` قبل تغيير قواعدها.
    - تفاصيل البطاقات تعيد استخدام نتيجة قراءة قصيرة عبر `server/services/dashboard/snapshots.ts`، مرتبطة بالحساب والدور الفعلي والفلاتر؛ افحص الصلاحيات قبل إعادة الاستخدام دائمًا. التحديث يقرأ المصدر مجددًا، ولا يسمح معرف النتيجة بتجاوز الحارس. راجع `docs/dashboard/DETAILS_LOADING_FIX_AR.md`.

25. **تكلفة مواد التنفيذ باللوت وتحويل الاستلام — 2026-10-15.**
    - `inventory_issue_cost_allocations` هو لقطة تكلفة اللوت وقت الصرف. `material_execution_cost_contexts` يثبت مرجع تنفيذ واحد لكل حركة جديدة: بلاغ بالاسم/الفريق، PMV2، أو مستقل. لا تستنتج المرجع من طلب الشراء أو مصدر اللوت، ولا تحسب الحركة مرتين عند وجود روابط مهمة/بلاغ.
    - لا تُغيّر تقييم المخزون أو حركات المتوسط أو المرتجع المالي لإصلاح كشف تكلفة البلاغ؛ هذه طبقة تشغيلية مستقلة مع فرق أساس التكلفة ظاهر للحسابات. مرتجع الكشف يستخدم نفس السند ولقطة اللوت الأصلية، وليس سعرًا حاليًا أو مرتجعًا ماليًا آخر.
    - الربط الجديد خلف `MATERIAL_EXECUTION_COSTS_ENABLED=true` بعد تركيب SQL يدويًا بواسطة المالك. الإعداد معطّل افتراضيًا، ولا كاتب أو قارئ للجدول الجديد قبله. لا تشغيل migrations/SQL/DB ضمن الاختبارات. التاريخ غير المرحّل خارج الكشف؛ لا Backfill أو إعادة تقييم تلقائية.
    - معامل تحويل الاستلام يبدأ بصفر ويجب إدخاله موجبًا صراحةً (حتى 1 للوحدة نفسها)، مع وحدة صرف فعالة. وحدة المخزون والكتالوج الأساسية لا تتغير لتفسير أرصدة قديمة؛ تعبئة المورد الفعلية تحفظ في الاستلام واللوت، والكمية والسعر في الطلب يبقيان بوحدته الأصلية عند إمكان المقارنة الموثوقة.
    - المرجع التنفيذي يُحفظ داخل معاملة الصرف نفسها؛ فشل السياق أو المستند يلغيها كاملة. إعادة ربط PMV2 لا تنقل سندًا جديدًا مسجلًا لمرجع تكلفة آخر. لا تستخدم `inventory.addTransaction(out)` كمسار يتجاوز الطبقة عند تفعيلها.
    - راجع `docs/material-costs/IMPLEMENTATION_AR.md` للتفعيل والحدود والاختبار.

26. **تاريخ احتياج أصناف الشراء ثابت، والأيام تُراجع عند الإرسال — قرار محدّث 2026-10-18.**
    - الإدخال ثنائي الاتجاه: تاريخ الاحتياج يحسب عدد الأيام، وعدد الأيام يحسب التاريخ وفق تقويم الرياض. تحفظ المسودة التاريخ المختار والمدة، ويمكن حفظها دون الحقلين. عند `create` أو `submitDraft` يبقى التاريخ المختار ثابتًا ويحسب الخادم الأيام المتبقية من يوم الإرسال؛ مثال 18 + 3 = يوم 21، والإرسال يوم 19 يثبت 21 ومدة يومين. التاريخ الماضي يبقى قابلًا للحفظ كمسودة دون مدة سالبة؛ يتطلب الإرسال تصحيح التاريخ. المسودة القديمة التي لا تملك إلا مدة تدعم التوافق بحساب التاريخ من تلك المدة عند الحفظ/الإرسال، دون Backfill.
    - تعديل المسودة والإرسال يستخدمان قفل الرأس نفسه مع إعادة فحص `draft` لمنع محرر قديم أو إرسال مكرر من مسح/إعادة بدء المهل. لا تحسب التاريخ من `createdAt` القديم أو معاينة المتصفح.
    - السجلات المرسلة سابقًا لا تُعاد كتابتها. عند إرسال المسودة يُثبت `requiredDate` و`deliveryLeadDays` مع رأس الطلب في المعاملة نفسها. يستخدم التطوير العمودين الموجودين؛ لا SQL جديد أو اتصال الوكيل بأي قاعدة.
    - طابور أصناف المندوب يبقى مقيدًا بـ`delegateId` وحالات الإجراء الحالية؛ يعرض المنشئ من `purchase_orders.requestedById`، ويرتب حسب تاريخ الاحتياج مع المفقود أخيرًا. العد التنازلي من اليوم الحالي في الرياض، وليس المدة الأصلية عند الإسناد.

27. **صلاحيات الفني المركزية — 2026-10-18.**
    - `shared/technician-policy.ts` يحدد صفحة الفني الوحيدة وقائمة `(type,path)` المسموحة لخدماتها. يطبّق `server/_core/trpc.ts` الحارس على `baseProcedure` قبل أي handler، من الهوية الأصلية الموثوقة. أي endpoint جديد غير مصرح صراحة يبقى مرفوضًا؛ لا توسع السماح إلى namespace كامل.
    - القائمة المركزية لا تستبدل حراس عضوية الفريق وملكية المهمة/البند في الخادم. مراجع نافذة البلاغ تجمع فقط بيانات عرضه المسموح بها؛ ممنوع إعادة السماح بـ`users.list` أو `inventory.list` أو القوائم العامة لتسهيل واجهة الفني.
    - ترجمة الفني مقيدة بمعرّفات بيانات البلاغات المسموحة. يحدد اسم الإجراء هل يستخدم `entityId` أو `entityIds` قبل المعالجة؛ لا تقبل الحقل الآخر كبديل لأن parser قد يحذفه لاحقًا. يفحص كل عنصر في الدفعة قبل إرجاع أي نتيجة.
    - إنشاء بلاغ من حساب الفني يحتاج مصدر PMV2 مسموحًا، والمرفقات تدعم البلاغ وأدلة إجراء PMV2 فقط مع بقاء تحقق الملكية. HTTP المصادق يسمح برفع الملف وطباعة مستند المهمة المحمي فقط؛ بقية التصدير خارج صلاحيات الفني. تبقى آلية media العامة القائمة خارج هذا التغيير.

## 📂 أين أجد التفاصيل الكاملة

- **كل إصلاح، سببه، ومثال قبل/بعد (ما تم إنجازه فعلًا):** `docs/CHANGELOG_TECHNICAL.md`
- **كل مشكلة/فكرة طُلب تأجيلها ولم تُنفَّذ بعد:** `docs/PENDING_TASKS.md`
- **التقرير الأصلي الكامل للتحقيق (السبب الجذري + الثغرة الأمنية):** `docs/archive/` (إن نُقل هناك) أو اسأل صاحب المشروع.

---

## 📋 بروتوكول إضافي: المهام المؤجَّلة (`docs/PENDING_TASKS.md`)

- إن طلب صاحب المشروع تأجيل مشكلة أو فكرة ("لاحقًا"، "ذكّرني بها"): أضِفها فورًا في ذلك الملف قبل الانتقال لأي شيء آخر.
- إن أنجزت بندًا كان مؤجَّلًا هناك: انقله لقسم "منجَزة" في نفس الملف بتاريخ الإنجاز، وأضف التفاصيل التقنية
  الكاملة في `docs/CHANGELOG_TECHNICAL.md` إن استحقت ذلك.

---

## 🧭 بروتوكول إلزامي: التوثيق بعد أي تعديل (ليس اختياريًا)

**هذا ليس اقتراحًا — هو جزء من عملية أي تعديل، تمامًا مثل حفظ الكود نفسه.**

إن كنت نموذج ذكاء اصطناعي (Claude Code أو غيره) وقمت بأي من التالي في هذا المشروع:
- إصلاح خلل (bug fix)
- إضافة ميزة تلمس طلبات الشراء/الاستلام/المخزون
- تغيير مخطط قاعدة بيانات (schema)
- أي قرار هندسي كان يمكن اتخاذه بطريقة مختلفة

**يجب عليك — قبل إنهاء المهمة — أن تفتح `docs/CHANGELOG_TECHNICAL.md` وتُضيف بندًا جديدًا في نهايته** بنفس
قالب البنود الموجودة فيه (التاريخ، الملف، المشكلة، الحل، السبب). هذه خطوة من خطوات إنجاز المهمة نفسها،
وليست "شيئًا إضافيًا لو توفر وقت".

**إن طلب المستخدم منك تعديلًا ولم تفعل هذا، فالمهمة غير مكتملة** حتى لو كان الكود يعمل بشكل صحيح — لأن الهدف
من هذا الملف هو منع أي نموذج ذكاء اصطناعي أو مبرمج لاحق من تكرار نفس الخطأ، أو التراجع عن إصلاح سابق بدون علم.

**قاعدة فرعية:** لو كان التعديل يُنشئ قاعدة جديدة يجب معرفتها فورًا من أي جلسة مستقبلية (وليس فقط عند لمس نفس
الملف)، أضفها أيضًا كبند جديد في قسم "🔒 القواعد الحرجة" أعلاه في هذا الملف نفسه (`CLAUDE.md`)، لا في
`CHANGELOG_TECHNICAL.md` فقط — لأن ذلك القسم هو ما يُقرأ تلقائيًا في كل جلسة جديدة بلا استثناء.

1. لا تحذف أي بند سابق من `CHANGELOG_TECHNICAL.md` إلا إذا تأكدت أن السبب الأصلي له لم يعد قائمًا إطلاقًا،
   وحتى في هذه الحالة، أضف ملاحظة توضح متى ولماذا أصبح البند القديم غير ذي صلة بدل حذفه بصمت.


## 41) Main Phase 5 / 5.4.2 — Read-only Reconciliation Engine implementation — 2026-08-23

- Added pure evaluator `server/services/inventory-reconciliation-core.ts` for the five approved 5.4.1 rules.
- Added SELECT-only DB adapter `server/services/inventory-reconciliation.ts`.
- Added query-only tRPC endpoint `inventoryReconciliation.run`; no mutation/repair API exists.
- Inventory quantity/value reconciliation is scoped to Inventory rows participating in Lot Balances, so experimental non-Lot rows remain outside future-facing failure scope.
- No historical transaction reconstruction, baseline table, cleanup/backfill/revaluation, numbering, workflow/accounting, or Batch Transfer semantic change.
- Targeted TypeScript syntax/transpile, pure evaluator harness and explicit read-only source scan = PASS. Full Vitest/full typecheck not claimed because uploaded Full Project has no node_modules.
- Reference: `docs/CMMS_PHASE5_STEP4_2_READ_ONLY_RECONCILIATION_ENGINE_IMPLEMENTATION_2026-08-23.md`.
- **5.4.2 = COMPLETE / TARGETED CHECKS PASSED / LIVE DB RUNTIME VERIFICATION PASSED / OFFICIALLY CLOSED. 5.4.3 = OFFICIALLY CLOSED. 5.4.4 = NOT STARTED.**


## 42) Main Phase 5 / 5.4.2 — Official closure — 2026-08-23

- Owner extracted the implementation package and restarted the server.
- Deployed `runInventoryReconciliation()` executed against Live DB with `readOnly=true`.
- Runtime result: 53 checks performed, 53 passed, 0 exceptions; Lot-tracked Inventory=5, Lots=4, Lot Balance rows=5.
- Historical reconstruction and Auto-fix remain disabled. No data/schema/migration/numbering/workflow/accounting/batch-transfer semantic change was made.
- Reference: `docs/CMMS_PHASE5_STEP4_2_READ_ONLY_RECONCILIATION_ENGINE_CLOSURE_2026-08-23.md`.
- **Historical stop: after 5.4.2 official closure and before 5.4.3. Superseded by the 5.4.3 closure below.**


## 43) Main Phase 5 / 5.4.3 — Reconciliation Exception Report — Official closure — 2026-08-23

- Owner explicitly started 5.4.3 after 5.4.2 closure.
- Read-only report UI uses `inventoryReconciliation.run`; no repair mutation, SQL or DB write exists.
- Runtime UI matched the engine: `53/53` checks PASS, `0` exceptions; tracked Inventory=`5`, total Inventory=`698`, Lots=`4`, Lot Balances=`5`.
- Search/warehouse/exception filters and refresh are present. A concise one-page Arabic **دليل تقرير مطابقة المخزون** was added and the owner confirmed the download button works.
- No deliberate Live DB exception was introduced to test a failing row; this is an accepted limit because data must not be corrupted for UAT.
- **5.4.3 = IMPLEMENTED / TARGETED CHECKS PASSED / RUNTIME UI VERIFICATION PASSED / OFFICIALLY CLOSED.**
- **Exact current stop: after 5.4.3 closure and before 5.4.4 Runtime UAT & Closure. Do not start 5.4.4 automatically.**

23. **IT Manager notifications + persisted localized Master Data display (2026-10-05, superseded/extended later the same day).**
    - `notifications.eventKey='it_ticket_arrival'` is the explicit IT Manager inbox event. Do not broaden the IT Manager notification inbox to generic system notifications; ticket-arrival cards must target the specific `/tickets/:id` when `relatedTicketId` exists.
    - `/notifications` is an allowed route for both IT team roles. Removing it from `canRoleAccessPath` makes the client route guard silently redirect the notification-center click back to `/tickets`.
    - Dynamic localization is display-only. Never overwrite canonical Site/Section/Asset/Center Category/Asset Category/User names merely because a translated label was shown. Admin edit screens must use the canonical/source value (`sourceName` where provided).
    - `entity_translations` is the shared persisted translation source for Site/Section/Asset/Center Category/Asset Category/User display names. Existing `sites.nameEn/nameUr` and `sections.nameEn/nameUr` remain compatibility/seed values only; on first localized read they may be copied into `entity_translations`, not treated as a second source of truth.
    - Missing master-name translations are generated through the external translation engine in batches, stored once in `entity_translations`, and reused. User display names must be transliterated, not semantically translated. Language changes refetch display data rather than mutate source records.


27. **الصرف التشغيلي وحزم تسعير المندوب (2026-10-17):** الإضافتان متوقفتان افتراضيًا حتى ينفذ المالك SQL يدويًا. لا تشغّل migration أو اتصالًا بالقاعدة تلقائيًا. حارس الصرف التشغيلي في الكاتب الفيزيائي الأصلي يجب أن يبقى ذريًا مع اللوت والحركة وDLV، ويجب حمل مرجع مهمة PMV2 في WIS أيضًا. لا تغيّر المتوسط أو المرتجع الأصلي. وحدة الأمر هي وحدة صرف المخزون الفعلية، وليست وحدة عبوة الشراء؛ لا تخمّن التحويل.
28. **DPB طبقة تجميع للمندوب فقط:** حزمة مفتوحة واحدة وحد 20 بند PR، بلا نسخ طلبات أو نقل packageId/sectionId. الإرسال يستعمل submitPricedBatchForPO الأصلي داخل transaction واحدة وبنود محددة، مع دفعات فرعية للحزم الأصلية. لا تُرجع الإرسال الجزئي القديم لحزمة DPB. PDF النهائي ولقطته ثابتان ومحميان من تصدير المراقب. فك العضوية لا يغيّر السعر أو الحالة. استكمال الإشعارات/البلاغات بعد التثبيت يعاد من السجل دون إرسال دفعات جديدة. راجع docs/runtime-uat/2026-10-17/OPERATIONAL_ISSUES_AND_PRICING_BUNDLES_AR.md قبل تعديل هذه الحدود.


29. **ملصقات المخزون وقارئ HID (2026-10-18):** اطبع الملصقات عبر printInventoryLabels في مستند مستقل؛ لا تعِد visibility:hidden لواجهة البرنامج أو فاصلًا بعد الملصق الأخير. تصحيح لغة الكيبورد يقتصر على LOT كامل معروف في مكون القارئ، ولا يلغي أي تحقق خادمي للصنف/المستودع/الرصيد.
30. **متابعة المندوب وأرشيف DPB (2026-10-18):** مرحلة المتابعة من دفعة الصنف ومساره الفعلي، لا من حالة PO العامة وحدها. واجهات القراءة للمندوب تعرض أصنافه فقط. إرسال DPB يؤرشفها داخل معاملته نفسها؛ الأرشفة تنظيمية ولا توقف الحسابات أو retrySync أو تنزيل PDF المجمد. راجع docs/runtime-uat/2026-10-18/DELEGATE_AND_LABELS_IMPLEMENTATION_AR.md.

31. **مراجعة تسويات المخزون والتصحيح الموثق للجرد (2026-10-19، طلب جديد صريح بعد إغلاق Phase 4):** المستودع يعد مسودة من جرد نهائي ويرسلها، والإدارة العليا/الأدمن/المالك تراجع وتعتمد أو تعيد بسبب إلزامي. لا يطبق مشارك في إعداد البيانات تسويته بنفسه. المسودة والإعادة وتصحيح خطأ التسجيل لا تكتب حركة مخزون. الاعتماد يستدعي `applySettlement` الأصلي عبر transaction writer نفسه، مع بقاء تقييم Snapshot/اللوت والترقيم ومنع التكرار. ترتيب الأقفال COUNT ثم DRAFT ثم Inventory بترتيب المعرفات؛ لا تفتح معاملة مستقلة من داخل الاعتماد. التسوية المباشرة للأدمن والمالك باقية للجرد الذي ليس له مسودة مراجعة، ولا تتجاوز مسودة قائمة أو طلب تصحيح معلق. التصحيح قبل الترحيل يقتصر على الأسطر التي أجازها المراجع، ويحفظ الأصل والإصدار المصحح وتكلفة/وقت Snapshot الأصليين؛ إعادة العد في وقت لاحق جرد جديد، وبعد الترحيل تسوية تصحيحية جديدة مرتبطة بالسابق. الحالة `no_adjustment` اعتماد دون حركة، وليست تسوية مالية فارغة. قراءة وطباعة الجرد المصحح تعرض رقم التصحيح وأثره. الجداول الثلاثة في `2026_10_19_settlement_review_*_manual.sql` يركبها صاحب المشروع يدويًا قبل النشر؛ لا متغير تفعيل جديد ولا اتصال أو migration أو Backfill من الوكيل. مرجع التنفيذ والتشغيل: آخر بند في `docs/CHANGELOG_TECHNICAL.md`.

32. **PDF المالي بعد اعتماد المستخدم — 2026-10-19.** المحاسب والإدارة العليا يراجعان البيانات المنظمة قبل الاعتماد؛ PDF ومفتاح التخزين والرابط محجوبة حتى اعتماد المستخدم نفسه للدفعة/الإرسال المحدد. الحزمة الكاملة تتطلب جميع أجزائها، والطلب الكامل يتطلب تغطية كل سطر يعرضه المولد؛ اعتماد رأس قديم لا يجيز صنفًا جديدًا. طبق `purchase-document.ts` قبل التوليد أو قراءة التخزين، وعلى المرفقات المالية في `media-access.ts` قبل أي مرجع بديل. لا تثق بـHTML عميل الحسابات/الإدارة لتوليد PDF: مستندات المخزون غير المالية تُبنى خادميًا من مرجعها عبر الحارس المركزي. لا توسع صلاحيات المندوب أو المراقب، ولا تحول إخفاء الزر إلى مصدر الصلاحية. المرجع: آخر بند PDF في `docs/CHANGELOG_TECHNICAL.md`.
**استثناء معتمد من المستخدم بتاريخ 2026-10-26 للبند 32:** الوثائق المؤرشفة في تبويب «الوثائق المالية المعتمدة» (`po_financial_batch` و`purchase_package_submission_financial`) متاحة للعرض والتنزيل والطباعة لأي مستخدم نشط بدور الحسابات بعد اكتمال اعتماد الحسابات والإدارة العليا للنطاق الكامل، ولو اعتمدها محاسب آخر. يطبق الشرط في القائمة وحارس المرفقات والروابط المباشرة. لا يعمم هذا الاستثناء على وثائق تسعير المندوب أو DPB أو التصدير الحي لطلب الشراء أو بقية الأدوار؛ تبقى شروطها السابقة.

# 33) صورة الصنف عند الحفظ اليدوي — 2026-10-21

- `catalog.items.create/update` يتطلبان صورة جديدة عند الإنشاء أو صورة محفوظة/جديدة عند تعديل الصنف. لا تُجبر المستخدم على إعادة رفع الصورة القائمة.
- ارفع الملف أولًا ثم اربط الصورة وبيانات الصنف داخل معاملة واحدة. لا تعِد فصل إنشاء الصنف ثم `attachments.add`؛ فشل الصورة كان يترك صنفًا ناقصًا وقد يؤدي لتكراره عند إعادة الحفظ.
- لا تعمم شرط الحفظ اليدوي على الاستيراد أو المرشحين أو السجلات القديمة تلقائيًا؛ تلك المسارات لم تتغير ضمن هذا الطلب. لا SQL جديد.

# 34) وحدة الكتالوج واعتماد كمية الاحتياج — 2026-10-31

- وحدة الكتالوج الحالية هي الوحدة الأساسية للطلب والاحتياج والصرف. لا تضف وحدة شراء/صرف ثانية في الكتالوج؛ وحدة عبوة المورد ومعامل التحويل يحددان في الاستلام كما هو قائم.
- الفني لا يحدد وحدة الصنف المرتبط بالكتالوج. المادة النصية تنتظر الوحدة حتى يربطها المستودع ويعتمد الكمية بوحدة الكتالوج، مع حفظ الأصل في سجل الإجراء.
- إصلاح وحدة احتياج مرتبط سابقًا مسموح لنفس الصنف فقط وقبل أي تاريخ توفير/شراء/تسليم/استخدام/مرتجع، وبحراس الدور والمرحلة والإصدار الحالية. لا تحويل تلقائي للكميات ولا إعادة تفسير لأرصدة قديمة. وحدات الطلبات التاريخية غير المعدلة تبقى snapshots محفوظة.

# 35) دفتر الكتالوج وأوراق المخزون — 2026-11-01

- صنف الكتالوج هو الهوية الأساسية، وسجلات Inventory أوراق مستقلة له. ربط المرشح ينشر الهوية فقط ولا يستدعي دمج السجلات أو نقل أرصدتها ولوتاتها ومستنداتها. احتفظ بالأسماء والوحدات والتاريخ الأصلي للتفاصيل والبحث.
- إجماليات الدفتر مفصولة بالوحدة والتجميد؛ لا تدمج الكجم بالحبة ولا تعيد تفسير تكلفة أو كمية تاريخية. الصرف من الدفتر FIFO للوتات المتوافقة داخل المستودع أو اختيار لوت يدويًا؛ المرتجع للمورد باختيار لوت الاستلام الصحيح فقط.
- استخدم حراس القراءة والصرف والكتّاب الفيزيائيين القائمين. الصرف المتعدد ذري وله مفتاح إعادة محاولة ومتابعات محفوظة بسجل التدقيق؛ التحويل يحتفظ بدورة النتائج الجزئية القائمة. لا توسع تحويلات مواد الفرق/PMV2 المقيدة بالمصدر دون طلب صريح.
- لا SQL جديد لهذه الإضافة ولا تعديل بيانات قديمة آليًا. حالة الاختبارات المعزولة وحدود القبول الحي في `docs/inventory-books/2026-11-01/RESULTS.md`.

# 36) اعتماد DPB موحد للحزم الجديدة — 2026-11-01

- استثناء صريح بطلب المستخدم من البند28: عند تفعيل `DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED=true` وبعد تركيب الجدول يدويًا، الحزم المرسلة حديثًا لها اعتماد حسابات واحد ثم إدارة واحد؛ الحزم السابقة تبقى بدورتها بلا ترحيل. لا تفعّل المفتاح قبل التحقق من schema والقبول الحي.
- رصيد العهد حقل رقمي حر وفق تحققه الحالي، يحفظ مرة واحدة بأصل الحزمة ولا يوزع على PB/PO ولا يحسب تلقائيًا من الأصناف. تمويل تعويض المرتجع يبقى بالفرق الموثق عبر الكاتب القائم، ولا يستخدم هذا الرصيد الحر كعهدة ثانية.
- الرفض والتنفيذ على مستوى الصنف وبمراجع PO/PB/البلاغ/المهمة الأصلية. لا تعِد إحياء المرفوض أو الملغى ولا تسمح لمسار اعتماد قديم بتجاوز أصل DPB، حتى عند إيقاف المفتاح بعد استخدامه. القراءات مجمعة، والاعتماد/التنزيل يتحققان من كل الأعضاء وهوية المعتمد الحالية.
- ملف المندوب المجمد باقٍ كما هو. نسخة مركز المستندات تحفظ التجميع وتضيف الاعتمادين والتوقيعين المحفوظين والقسم المالي بعد اكتمال الإدارة، وتميز المرفوض/الملغى والإجمالي المقبول. لا تختلق صورة توقيع تاريخية.
- التنفيذ ونتائج العزل وخطة SQL اليدوية وحدود القبول: `docs/unified-dpb-approval/2026-11-01/RESULTS.md`. لا اتصال أو migration أو نشر تلقائي ولا تعديل حزم تاريخية.
- تحديث مراجعة DPB في اليوم نفسه: `?approval=<id>` للحزمة المختارة فقط؛ الإدارة لا تعرض المرفوضات في شاشة القرار، لكنها تبقى محفوظة في الأرشيف واللقطة. لا تخلط هذه التصفية العرضية مع حذف العضوية أو شروط PDF الكامل.
- الوحدة الفارغة في اللقطة قد تكون `—` بينما المصدر NULL؛ وحّد غياب الوحدة في مقارنة التسعير فقط دون تخمين وحدة أو تحويل كمية. اختلاف وحدة فعلية يبقى مانعًا.
- استكمال قرار محفوظ مقصور على صاحبه الفعلي النشط، وبفحص جميع الآباء والعضوية والمرحلة الحالية. إسقاط مرحلة DPB للقراءة لا يتجاوز إلى قائمة PO العامة، ولا إلى محاسب آخر. `resumeApproval` يتابع الإشعارات/المزامنة فقط دون اعتماد أو تمويل جديد، ولا تُحوّل query إلى كاتب. المرجع: `docs/unified-dpb-approval/2026-11-01/FOCUSED_REVIEW.md`.
- تنسيق DPB المعتمد يتبع نموذج PB المالي المرجعي: جدول الأصناف ثم مسار التوقيعات ثم القسم المالي والرئيس التنفيذي وسند الصرف، دون ملحق اعتماد مكرر. تحفظ صور المعتمدين المثبتة وتجميع المصادر وأثر الرفض، وتبقى نسخة المندوب المجمدة كما هي. مرجع المعاينة المعزولة: `docs/pricing-bundle-approved-document/2026-11-01/REFERENCE_FORM.md`.

**تعديل عرض صريح من المستخدم 2026-11-02:** في PDF المعتمد فقط، الحسابات تعرض صورة التوقيع دون عبارة/تاريخ الاعتماد الإلكتروني. الرئيس التنفيذي نص ثابت عريض «المهندس/ زكري بن عبدالله الزكري» وخانة توقيعه فارغة؛ بيانات المعتمد الحقيقي وتوقيعه وتاريخه تبقى محفوظة ولا يعاد كتابتها. خانة مراجع الطلب تعرض الاسم فقط دون سطر أرقام PR؛ صفوف مقدم الطلب ونسخة المندوب باقية.

# 37) قارئ حزم التسعير المعتمدة لحسابين محددين — 2026-11-02

- صلاحية صريحة للاستعراض والطباعة وتنزيل PDF من تبويب «حزم التسعير المعتمدة» للحسابين `ANIS` و`ahmed1` وللأدمن والمالك. أضيف زر التنزيل بطلب المستخدم في2026-11-02 ويستخدم RPC الوثيقة المعتمدة نفسه مع فحص حديث لكل ضغطة. مصدر الهوية سجل الحساب المصادق عليه لا الاسم الظاهر أو مدخل العميل. لا تعمم المنح على الدور كله ولا تمنح إجراءات التسعير أو الاعتماد أو PO العام.
- `approvedPricingDocumentProcedure` قدرة مركزية مغلقة على `approvedPricingDocuments.listPage` (query) و`approvedPricingDocuments.pdf` (mutation للقراءة والتوليد فقط). لا ينتحل دور الحسابات أو الإدارة ولا يغير حراس RPC السابقة. يعاد فحص معرف الحساب واسم دخوله ودوره ونشاطه من السجل الحالي لكل طلب؛ تكرار اسم الدخول المحدد يمنع المنح بدل تخمين الحساب.
- شروط اكتمال الاعتماد القائمة في `approvedBundleCondition` و`approvedBundleSnapshot` باقية لجميع الأعضاء والآباء والإرسال؛ لا عرض قبل اعتماد الإدارة ولا تجاوز عبر PDF مباشر أو ملف المندوب القديم. القائمة مرقمة قبل إثراء النطاق، والأعضاء مميزون ومحملون بـ`readScopeChunks`/`groupReadRows` بحد500؛ التنزيل يفحص من جديد دون cache صلاحيات عام أو تعديل اللقطة/الملف الأصلي.
- لا SQL أو متغير بيئة جديد. تبويبات الأدوار الحالية محفوظة. الاختبارات والقبول المتبقي: `docs/approved-pricing-documents/2026-11-02/RESULTS.md`.

# 38) تنظيم مركز المستندات — 2026-11-02

- بطلب المستخدم استبدلت طبقات التبويب السابقة بثلاث مجموعات عرض فقط: الوثائق المالية المعتمدة، الشراء والتسعير، مستندات المستودع. أنواع المستندات داخل قائمة واحدة، والتصفية مطوية، والبحث والعدد يخصان النوع المختار. لا تعِد جلب جميع الأنواع لأجل عدادات التبويبات.
- هذه طبقة عرض فقط في `documentCenterNavigation.ts` و`DocumentFilters.tsx` وواجهات المركز. لا دمج لسجلات المستندات أو توسيع لدور أو شرط اعتماد. `ANIS` و`ahmed1` يبدآن بقارئ DPB المعتمد؛ الأدمن والمالك لهما مدخل DPB واحد. المحاسب والإدارة يحتفظان بالـRPC السابق ونطاق اعتماد المستخدم نفسه، لا بقارئ الحسابين العام.
- تحتفظ السندات بقوالبها وحراسها وكتّاب الطباعة السابقة، ونسخة المندوب المجمدة كما هي. عرض/تنزيل/طباعة DPB يعيد طلب الـRPC المناسب لكل عملية. التفاصيل الطويلة داخل النافذة، وأزرار PDF لا تظهر عند الرفض أو للمراقب.
- لا SQL أو تعديل قاعدة أو بيئة أو نشر تلقائي. الاختبارات والمعاينة المعزولة وحدود القبول في `docs/documents-center/2026-11-02/ORGANIZATION.md`.

**تصحيح محدود بطلب المستخدم 2026-11-03:** في مركز المستندات ← DPB المعتمدة، الاستعراض والتنزيل والطباعة متاحة للحسابات والإدارة العليا النشطين بعد اكتمال اعتماد الحسابات والإدارة لجميع أعضاء الحزمة، ولو كان المعتمد مستخدمًا آخر من الدور نفسه. `listPage` يثبت الاكتمال قبل الترقيم، و`pdf(approvedDocument:true)` يعيد فحصه عند العملية ولا يعتمد على نتيجة القائمة. قاعدة المعتمد الشخصي باقية لقائمة/تفاصيل التسعير العادية ونسخة PDF الأصلية، ولا تعمم هذا الاستثناء على بقية أنواع المستندات أو الأدوار أو إجراءات الاعتماد. لا تغيير لنسخة المندوب أو القالب أو SQL.

# 39) اطلاع المستودع على بلاغ طلب المواد فقط — 2026-11-03

- رابط `/tickets/:id` من بطاقة احتياج الفريق يعرض للمستودع مكون قراءة مستقلًا عبر `ticketTeamExecution.warehouseTicket`، الممنوح كـquery للمستودع فقط. يشترط حساب warehouse نشطًا حاليًا، إسنادًا صحيحًا لبلاغ فرعي وبنده وفريقه، ووجود احتياج مواد للإسناد نفسه، وفق نطاق قائمة طلبات المستودع القائمة بما فيها الاستلام والمرتجعات.
- لا توسع `assertTicketReadable` أو قائمة البلاغات أو إجراءاتها لهذا الغرض؛ تبقى صفحة بقية الأدوار وحراس البلاغ العام كما هي. DTO العرض محدد بالعنوان والوصف والموقع والقسم والفريق والحالة والأولوية ووسائط التقرير فقط، دون توقيعات أو PDF أو صور ما بعد العمل أو إجراء صرف/اعتماد.
- فتح الصورة/الفيديو يعيد فحص حساب المستودع ورابط الاحتياج والمفتاح الفعلي، وصور الأصل تتطلب رابط sourceTask/convertedTicket الصحيح. لا إعادة استعمال إذن القائمة أو كشف صفحة الأصل أو مرفقاته الأخرى. لا SQL جديد.

# 40) اختيار لوتات تحويل مواد التذاكر وPMV2 — 2026-11-03

- طلب صريح للمسارين: في WarehouseTransfer ذي سياق مواد تختار الواجهة التوزيع بالأقدم أو اللوتات وكمياتها من قائمة، دون QR إلزامي، وتجهز كامل كمية السياق فقط. تعديل الاختيار يمسح السلة الجاهزة، والتجهيز يعيد قراءة اللوتات. تبقى قواعد المصدر والهدف والوحدة والصنف وحد20بندًا والتحقق الخادمي ومنع التكرار كما هي.
- PMV2 يحتفظ بتوزيع الأصل والبدائل المعتمد والكميات الفعلية ونسب تغطية الأصل؛ allowedLotIds في استجابة التجهيز مشتقة من اللوتات الأصلية/خطط البديل المعتمدة المحملة أصلًا، لمنع اعتبار لوت البديل نفس الصنف كأنه أصل1:1. لا يغيّر المستخدم حصص الخطط أو نسبها عبر اختيار اللوتات.
- الاختيار الجديد يخص سياقي tickets/pmv2 فقط، ولا يغير التحويل العام أو الصرف التشغيلي أو كاتب المخزون أو الربط اللاحق لـPMV2. لا SQL أو صلاحية جديدة أو معالجة تاريخية.

# 41) مطابقة مواصفات الاستلام الموجّه للإنشاءات — 2026-11-04

- الاستلام الجديد المؤكد لصنف `reviewRole=construction_procurement_manager` ينشئ لوتًا بحالة `specificationStatus=pending` في معاملة الاستلام نفسها. اللوتات القديمة/غير الإنشائية تبقى NULL دون Backfill. أعمدة المطابقة الخمسة وفهرسها SQL يدوي قبل تشغيل النسخة؛ راجع `docs/purchase-specifications/IMPLEMENTATION.md`.
- القرار من تبويب طلبات الشراء للإنشاءات/أدمن/مالك: اعتماد يفتح الحركة الحالية، ورفض يظهر للمرتجعات دون خصم أو سند آلي. الحماية مرتبطة باللوت الفعلي، لا بتجميد دفتر الكتالوج كله؛ استعمل حارس الحركة الحالي داخل معاملة الصرف/التحويل، ولا تسمح بإكمال صنف شراء موقوف بواسطة لوت آخر.
- استبعد الكميات المعلقة/المرفوضة من الاختيار بالأقدم ومن الرصيد التشغيلي المتاح مع إبقائها ضمن إجمالي المخزون الفعلي. الكمية المستلمة المنتظرة للمطابقة تظل تغطية شراء معلقة في PMV2 لمنع طلب شراء مكرر. المرفوض يسمح بمرتجع المورد فقط عبر نوع إجراء داخلي، وليس عبارة نصية يمررها العميل.
- لا تغيّر هوية الطلب أو البند أو روابط البلاغ/PMV2 أو اعتمادات التسعير والمستندات لهذا الشرط. القبول الحي بعد SQL ما زال مطلوبًا؛ لم تُنفذ أوامر على قاعدة في جلسة التطوير.

# 42) ذرية تأكيد مرتجع مواد PMV2 — 2026-11-04

- `confirmPendingReturn` يحفظ مرتجع اللوت وسنده وربطه بالمهمة وتثبيت الاستهلاك وعلامة الإكمال داخل معاملة واحدة. مرّر `tx` نفسه عبر `currentRecipientReturnAdapter.createReturn(input, tx)` إلى `createRecipientWarehouseReturn` القائم؛ لا تضف `getDb()` أو معاملة مستقلة بين الترحيل وربط المهمة.
- إجازة الكتابة من الإعلان المستهدف الحالي تحت قفل بند المهمة والإعلان، وفحص المستخدم النشط بدور warehouse/admin/owner؛ ليست من نتيجة `listPendingReturns` العامة. تبقى المهام المكتملة/الملغاة قادرة على استقبال مرتجع فعلي معلق وفق السياسة السابقة.
- عزل `read committed` محلي لهذه المعاملة فقط حتى تقرأ طبقة المرتجع الأصلية الرصيد والمرتجعات السابقة بعد قفل سند الصرف من أحدث حالة. تبقى أقفال الكاتب الأصلية، وتُحجز سندات الصرف بترتيب ثابت ودفعات500. لا تغيير لعزل القاعدة العام أو لحساب تكلفة المرتجع أو لحركة الاستلام/الشراء.
- لا SQL جديد أو معالجة تاريخية أو نشر تلقائي. الاختبارات المعزولة في `tools/pmv2-return-atomic/run.mjs` لا تحل محل اختبار سلوك MVCC حي في TiDB.

# 43) متابعة مرتجعات المورد والتعويض المتتابع — 2026-11-04

- موافقة المستخدم الجديدة تلغي قرار تأجيل/منع تعويض البديل مرة ثانية: كل جولة تنشأ من مرتجع ولوت وفاتورة الاستلام الفعلية، وترتبط بخطة الجولة السابقة بواسطة `supplier_return_cases.parentReplacementPlanId`. لا تعِد استخدام رصيد الجولة السابقة أو تغيير الفاتورة الأصلية. العمود والفهرس SQL يدوي مستقبلًا فقط؛ راجع `docs/supplier-return-followup/04_sequential_returns_copycmms2.sql`.
- صفحة المندوب «مرتجعات المستودع» تستخدم صلاحية المتابعة القائمة ونطاق المندوب نفسه؛ ليست مركز مرتجعات شاملًا ولا منحة عامة لتنزيل المستندات. رفض التسليم يعيد المتابعة للمستودع دون إعادة رصيد مخزون تلقائية. تبويبا الجارية والمكتملة يصفّيان بـ`closedAt` قبل الترقيم، ولا توجد معالجة تاريخية آلية.
- استلام البديل الكامل يثبت اللوت/سند الاستلام وروابط التغطية والتسويات المعتمدة ثم يغلق متابعة المرتجع ويسجل الحدث والتدقيق داخل معاملة الاستلام نفسها؛ لا يغلق البلاغ/المهمة ولا ينفذ تسليمًا للفني. الرصيد غير المستخدم عند شراء بديل أرخص يبقى بعهدة المندوب ويُعرض فقط، دون إصدار عهدة أو حركة مالية إضافية.
- الاستلام المستقل بلا PR يسمح بطلب تعويض بعد التحقق من سلسلة المرتجع/الاستلام المؤكد/البند/اللوت/سجل المخزون؛ مسؤول المتابعة منشئ المرتجع الفعلي. لا تسقط متطلبات إنشاء PR العادي للموقع/القسم/التصنيف/جهة المراجعة أو الاعتمادين الماليين.
- تغطية الاحتياج عبر الجولات تعتمد نسبًا كسرية صحيحة وتطرح الكمية المُعادة للمورد من تغطية الجولة القديمة. تُحفظ كل اللوتات والسندات بوحداتها وتكاليفها الفعلية. لا تقرّب نسبة غير قابلة للتمثيل بدقة السند الحالية إلى كمية مكتملة؛ تبقى رسالة مراجعة التوزيع بدل إنشاء صرف زائد. قراءات الأجيال مجمعة بمعرفات مميزة ودفعات500، ولا يوجد cache بين الطلبات.
- منشئ الاحتياج الأصلي يبقى مسؤول اختيار البديل في الجولات التالية ولو أنشأ أدمن طلب الجولة السابقة نيابة عنه. لا يسمح أصل PMV2/التشغيل/الصيانة بإلغاء التعويض بحجة أن بند البديل نفسه ليس له رابط احتياج مباشر. يعاد فحص المصدر والهوية عند القرار.

# 44) استلام فاتورة مستقلة للأدمن والمالك فقط — 2026-11-04

- بتوجيه صريح من المستخدم، زر «إضافة» في Inventory وصفحة `/inventory/receive` وإجراء `warehouseReceiptsV2.receiveStandaloneV2` للأدمن والمالك النشطين فقط. الواجهة تتحقق من `authenticatedUser` الفعلي قبل إظهار الزر أو تركيب النموذج؛ لا تمنح الصلاحية للمراقب المعروض كأدمن. الحارس المركزي يمنع RPC المستقل ويستعمل الإجراء `adminOwnerProcedure` مع فحص الفاعل الحالي.
- `warehouseReceiptsV2.analyzeInvoice` مشترك: بلا `purchaseOrderId` يستلزم الأدمن/المالك؛ مع معرف موجب لطلب حقيقي يعاد فحص رؤية الطلب بالحارس القائم، وتبقى صلاحية المستودع المعتادة. لا يُسمح بمعرف وهمي لتجاوز قيد الاستلام المستقل، ولا يُضاف شرط مرحلة شراء جديد لهذا التحليل.
- لا تغيير لاستلام طلبات الشراء أو كتّاب المخزون أو قراءة/طباعة سندات الاستلام القديمة أو باركودها أو تعويض مرتجعاتها. لا SQL أو متغير بيئة لهذا الحصر.

# 45) الصيانة الخارجية: عنوان الشراء واستلام المندوب قبل الحراسة — 2026-11-04

- `purchaseTitle` إلزامي عند التجهيز ومستقل عن اسم الأصل؛ النص المحفوظ هو اسم بند PR و«المادة المطلوبة» في قالب العهدة القائم، دون بادئة صيانة خارجية أو ترجمة تلقائية للعنوان.
- تجهيز المستودع ووثيقة الخروج ← `waiting_delegate_receipt` ← قبول المندوب الحالي ← الحراسة ← إنشاء PR. الرفض بسبب إلزامي يعيد نفس job/الوثيقة؛ إعادة التجهيز تزيد `preparationRevision` وتمسح الإثبات السابق مع حفظه في التدقيق. لا إشعار حراسة عند التجهيز ولا حجز رقم PR قبل فحص القبول.
- استعمل `hasCurrentExternalDelegateReceipt` للحراسة و`canWarehouseReprepareExternalAsset` لإعادة التجهيز في القراءة والكتابة والواجهة. المندوب الفعلي النشط فقط يقرر لمهامه الحالية؛ فتح الصورة يفحص الإسناد والمصدر والمفتاح نفسه، ولا يفتح البلاغ أو الصور الأخرى عمومًا.
- المعاملة والأقفال ونسخة التجهيز هي مصدر صحة القرار والتكرار. القديم بعد الخروج والمراحل اللاحقة كما هي؛ القديم المنتظر بلا إثبات صالح يحتاج إعادة تجهيز صريحة دون Backfill.
- ستة أعمدة وتوسيع status بإضافة القيمة الجديدة في آخر ENUM؛ SQL يدوي قبل تشغيل النسخة في `docs/external-maintenance-delegate/`. نجاح الاختبارات والبناء لا يثبت تطبيق SQL أو القبول الحي.

# 46) مسئول المناديب — 2026-11-04

- `delegate_manager` من عائلة المندوب عبر `shared/delegate-role.ts`/`isDelegateRole`، وليس من عائلة مديري المراجعة أو الإدارة المالية. الهوية الفعلية والدور الحالي لا يُستبدلان بدور delegate. يحتفظ بنطاق الأصناف والمستندات والصور الخاصة به، وبقيود دليل المستخدمين ونسخة المندوب من PDF.
- الصلاحية الإضافية الوحيدة: خيار أسماء المناديب وإسناد بند عادي مسند إليه بعد مراجعة حقيقية وقبل أول تسعير. يمنع النقل لمسار C/مهمة صيانة خارجية أو خطة تعويض مرتجع أو بند مسعّر/ضمن حزمة. يتم التحقق تحت أقفال الطلب والبند والحسابين، ثم تحديث delegateId وdelegateAssignedAt للبند وحده مع التاريخ والتدقيق؛ لا رأس الطلب ولا روابط الاحتياج أو الحالات المالية.
- `managerAssignable` علامة عرض مشتقة من قراءات مجمعة بحد500، وليست إذنًا للكتابة. `assignOwnDelegateItem` يعيد الفحص الفعلي؛ لا تُضف منحته للمناديب العاديين أو المراجعين. حفظ السعر يقارن المندوب المتوقع في شرط الكاتب؛ تحرير صنف المندوب يعيد فحص الإسناد داخل المعاملة حتى لا تنجح نافذة سابقة بعد النقل.
- نموذج مراجعة الأصناف يقترح حساب المسئول النشط دون تغيير صلاحيات المراجعة؛ يبقى الاختيار اليدوي والإسناد الحالي محفوظين، ولا تُكتب حالة جديدة عند وصول قائمة الأسماء متأخرة. عند تعدد الحسابات يُقترح أقل معرف نشط، وعند غيابها لا يُختار مندوب عادي عشوائيًا.
- الاستلام الخارجي للمسئول يتبع قبول/رفض المندوب القائم، وتغيير المندوب بيد المستودع. SQL يدوي واحد يضيف الدور في آخر users.role دون تغيير الحسابات، ثم يختار المستخدم الدور لحساب مقصود. لا متغير بيئة جديد؛ التفاصيل في `docs/delegate-manager/IMPLEMENTATION.md`.
