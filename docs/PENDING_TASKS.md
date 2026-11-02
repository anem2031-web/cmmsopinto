# قائمة المهام المؤجَّلة والتذكيرات

> هذا الملف لتتبّع أي مشكلة أو تطوير طلب صاحب المشروع تأجيله عمدًا ("لاحقًا"، "ذكّرني بها")، بدل تنفيذه فورًا.
> **مختلف عن `docs/CHANGELOG_TECHNICAL.md`** — ذلك الملف لما *تم إنجازه بالفعل*، وهذا الملف لما *لم يُنجَز بعد*.
> راجع `/CLAUDE.md` أولًا دائمًا.

---

## 🧭 التعليمات لأي نموذج ذكاء اصطناعي يعمل على هذا المشروع

1. **في بداية أي جلسة عمل جديدة على هذا المشروع، افتح هذا الملف وتحقق من قسم "⏳ مهام معلَّقة" أدناه.**
   إن وُجد أي بند، ذكّر صاحب المشروع به بشكل استباقي في ردك الأول (لا تنتظر أن يسأل).

2. **عندما يطلب صاحب المشروع تأجيل مشكلة أو فكرة** ("لاحقًا"، "ذكّرني بها بعدين"، "خلها الآن ونرجعلها"):
   أضِفها كبند جديد تحت "⏳ مهام معلَّقة" بنفس القالب أدناه، **قبل أن تنتقل لأي موضوع آخر في نفس الرد.**

3. **عند إتمام تنفيذ أي بند مؤجَّل:**
   - انقله من قسم "⏳ مهام معلَّقة" إلى قسم "✅ منجَزة" في أسفل الملف.
   - أضف تاريخ الإنجاز.
   - إن كان الإنجاز يستحق تفاصيل تقنية (قبل/بعد، سبب الحل)، أضف أيضًا بندًا مطابقًا في `docs/CHANGELOG_TECHNICAL.md` — هذا الملف يبقى فقط "قائمة تتبع"، والتفاصيل التقنية الكاملة مكانها الملف الآخر.

4. **لا تحذف أي بند من قسم "✅ منجَزة" إطلاقًا** — يبقى كأرشيف يوضح تاريخ كل قرار وتنفيذه.

---

## 📍 Phase checkpoint — 2026-08-19

- **2B-10-2A — Catalog Audit Trail:** ✅ COMPLETE / UAT PASSED.
- **2B-10-2B — Catalog Relationship & Inactive Data Protection:** ✅ COMPLETE / UAT PASSED.
- **2B-10-2C — Integrity Rules, UAT & Closure:** ⏳ **DEFERRED إلى Final Project Hardening / Closure بقرار صاحب المشروع بتاريخ 2026-08-19.**
- **2B-10 current status:** implementation complete through 2B-10-2B؛ Final Integrity Closure مؤجل، لذلك لا تُسجَّل 2B-10 كـFinal Closed بعد.
- لا يبدأ 2B-10-2C تلقائيًا عند العودة له؛ يجب إعادة فحص Live DB، مناقشة نطاقه، ثم موافقة صريحة قبل أي Code/Schema/Workflow change.
- هذا التأجيل لا ينفذ FK/UNIQUE/Backfill ولا أي إصلاح تاريخي، ولا يبدأ المرحلة التالية تلقائيًا.
- البنود المؤجلة أدناه، خصوصًا `PR-2026-0378` وحوكمة أرقام PO، لم تُحل ضمن 2B-10-2B وتبقى مؤجلة كما هي.
- مرجع القرار: `docs/CMMS_2B10_2C_DEFERRAL_DECISION_2026-08-19.md`.

### Main Phase 3 checkpoint — 2026-08-20

- **المرحلة الرئيسية 3 — تطوير الجرد:** ✅ **COMPLETE / RUNTIME UAT PASSED / CLOSED**.
- Step 1 Opening Snapshot = COMPLETE / UAT PASSED.
- Step 2 Results & Reports = COMPLETE / UAT PASSED.
- Step 3 Settlement Cut-off / Lot Freeze = COMPLETE / UAT PASSED.
- `CNT-2026-60028`: منع الصرف من `Lot 10` قبل Settlement = PASS؛ `ADJ-2026-30006` طبق فرق `+1` كـdelta فوق Current Balance؛ بعد التسوية `inventory.quantity=SUM(lot balances)=4`; ثم `DLV-2026-300182` نجح وبعده بقي التطابق `3=3`.
- التطوير المحاسبي الأوسع للتسويات يبقى للمرحلة الرئيسية 4 ولا يبدأ تلقائيًا.
- `2B-10-2C` يبقى مؤجلاً إلى Final Project Hardening / Closure.
- مرجع الإغلاق: `docs/CMMS_PHASE3_INVENTORY_COUNT_FINAL_CLOSURE_2026-08-20.md`.

### Main Phase 4 checkpoint — 2026-08-22

- **Main Phase 4 — Settlement Development:** ✅ **COMPLETE / RUNTIME UAT PASSED / OFFICIALLY CLOSED**.
- **Step 1 — Database Foundation:** ✅ COMPLETE / LIVE DB VERIFIED. Live DB fields remain Future-only؛ لا Backfill.
- **Step 2 — Settlement Valuation & Posting Logic:** ✅ IMPLEMENTED / TARGETED CHECKS PASSED / RUNTIME VALIDATED. Code schema synchronized to existing Live DB fields; Count uses Opening `averageCostSnapshot`; financial audit fields are persisted; supported posting paths use one DB Transaction.
- **Step 3 — UI + Runtime UAT + Closure:** ✅ COMPLETE / RUNTIME UAT PASSED / CLOSED.
- Runtime evidence:
  - `CNT-2026-60030` / `ADJ-2026-30008`: Count Surplus + cost change after opening + Snapshot valuation + freeze/unfreeze + duplicate guard = PASS.
  - `CNT-2026-60031` / `ADJ-2026-30009`: Count Shortage + financial result + freeze/unfreeze = PASS.
  - `CNT-2026-60032`: forced in-transaction failure left no partial DB state; test failpoint removed; normal retry `ADJ-2026-30011` = PASS.
  - Manual Aggregate Settlement button remains disabled with Lots Enabled = PASS under approved workflow boundary.
- لا Historical Cleanup / Backfill / Revaluation / New Approval Workflow / Manual Lot Workflow ضمن Phase 4 المصغّرة.
- **Final stop:** Main Phase 4 مغلقة. لا تبدأ Main Phase 5 تلقائيًا.
- المراجع: `docs/CMMS_PHASE4_SETTLEMENT_THREE_STEP_PLAN_AND_STATUS_2026-08-20.md` + `docs/CMMS_PHASE4_STEP2_SETTLEMENT_VALUATION_POSTING_IMPLEMENTATION_2026-08-22.md` + `docs/CMMS_PHASE4_STEP3_SETTLEMENT_UI_RUNTIME_UAT_2026-08-22.md` + `docs/CMMS_PHASE4_SETTLEMENT_FINAL_CLOSURE_2026-08-22.md`.


### Main Phases Roadmap renumbering checkpoint — 2026-08-22

- بقرار صاحب المشروع تم اعتماد إعادة تجميع المراحل المتبقية كالتالي:
  - **Main Phase 5:** تجمع المراحل القديمة 5 + 6 + 7 + 8: Disposal / Returns / Receipt-Issue-Transfer Review / Inventory Reconciliation.
  - **Main Phase 6:** المرحلة القديمة 9 — Inventory & Accounting Reports.
  - **Main Phase 7:** المرحلة القديمة 10 — Inventory Posting Engine.
  - **Main Phase 8:** المرحلة القديمة 11 — Operational Workflow Development.
- هذا السطر يسجل **حالة لحظة إعادة الترقيم تاريخيًا**: وقتها لم تكن Main Phase 5 قد بدأت ولم يتم Code/SQL/DB/Workflow change. **لاحقًا في نفس التاريخ بدأت Main Phase 5 وأُغلق 5.1 رسميًا؛ راجع checkpoint التالي.**
- وثائق Phase 3/4 التاريخية تبقى كما هي ولا يعاد فتح المرحلتين بسبب إعادة الترقيم.
- `2B-10-2C` يبقى مؤجلًا إلى Final Project Hardening / Closure.
- المرجع الحالي: `docs/CMMS_INVENTORY_MAIN_PHASES_RENUMBERING_2026-08-22.md` + `docs/inventory/INVENTORY_DEVELOPMENT_PLAN_AND_CHANGE_CONTROL.md`.



### Main Phase 5 / 5.1 checkpoint — 2026-08-22

- بقرار صاحب المشروع بدأت **Main Phase 5** رسميًا بالجزء **5.1 — Disposal / Write-off**، ثم أُغلق 5.1 رسميًا بعد Runtime UAT ناجح.
- Gap Analysis أكد أن مسار Lots الحالي يغطي Lot QR + Server Average Cost + Quantity/Value + Disposal transaction داخل Transaction واحدة.
- تم تقوية Legacy non-Lot path ليصبح أيضًا Atomic: رقم العملية + Header + Items + Inventory quantity/value + Disposal movement في Transaction واحدة، مع `FOR UPDATE` والخصم الشرطي.
- Runtime UAT على Lots Enabled: `DO-2026-000003` = PASS؛ Live DB أثبت `1.000 @ 1.0000`, Lot/Inventory/SUM Lots `9.000`, Value `9.00`, وحركة `out/disposal` بقيمة `1.00`.
- Over-quantity UI guard = PASS برسالة `الكمية أكبر من رصيد الدفعة المتاح (9)`.
- Runtime UAT الثاني: `DO-2026-000004` = PASS؛ Live DB أثبت `4.000 @ 1.0000`, Lot/Inventory/SUM Lots `6.000`, Value `6.00`, وحركة `out/disposal` بقيمة `4.00`.
- تفاصيل العملية وطباعة `DO-2026-000004` عرضت Lot/quantity/reason/unit cost/value بصورة صحيحة = PASS.
- Legacy non-Lot runtime لم يُختبر منفصلًا لأن البيئة المنشورة تستخدم Lots Enabled؛ targeted source/regression checks لهذا المسار قُبلت كحد تحقق غير حاجب عند الإغلاق.
- لم يتم SQL/Migration/Live DB schema change أو Backfill/Cleanup أو Approval/Workflow change.
- **5.1 = ✅ COMPLETE / TARGETED CHECKS PASSED / RUNTIME UAT PASSED / OFFICIALLY CLOSED**.
- **Main Phase 5 = IN PROGRESS; 5.1 = CLOSED; 5.2 = CLOSED; 5.3 = CLOSED; 5.4 = NOT STARTED.**
- المراجع: `docs/CMMS_PHASE5_STEP1_DISPOSAL_IMPLEMENTATION_2026-08-22.md` + `docs/CMMS_PHASE5_STEP1_DISPOSAL_RUNTIME_UAT_CLOSURE_2026-08-22.md`.

### Main Phase 5 / 5.2 checkpoint — 2026-08-22

- بدأ **5.2 — Returns** بموافقة صريحة من صاحب المشروع بعد الإغلاق الرسمي لـ5.1.
- Gap Analysis: مسار **Supplier Return** موجود فعليًا؛ مع Lots Enabled يبدأ من Warehouse + Lot QR ويحل Receipt/PO/Vendor/Invoice من المصدر، ويدعم partial return ضمن الرصيد المتاح.
- تم تقوية Supplier Return دون تغيير Workflow: Current Inventory row lock/re-read قبل الترحيل المالي، Server Current Average Cost لحركة return، رقم `RTN-...` عبر نفس transaction writer، وLegacy non-Lot core posting داخل Transaction واحدة.
- لم يُضف SQL/Migration/Backfill/Cleanup أو Approval/State change.
- **Fresh Runtime UAT لمرتجع المورد نُفّذ لاحقًا ونجح؛ راجع checkpoint الإغلاق الرسمي لـ5.2 أدناه.**
- **Recipient-to-Warehouse Return** كان غير موجود كمسار عام مستقل عند هذا checkpoint الأول؛ لاحقًا اعتمد صاحب المشروع سياسة Same Original Lot + Original Issue Cost + Original Issue Link + Partial/Over-return Guards + Atomic Posting وتم تنفيذها واختبارها Runtime.
- هذا السطر يمثل **checkpoint تنفيذي أولي**؛ لاحقًا أُغلقت 5.2 رسميًا، ثم بدأ 5.3 بموافقة صريحة بتاريخ 2026-08-23.
- المرجع: `docs/CMMS_PHASE5_STEP2_RETURNS_IMPLEMENTATION_2026-08-22.md`.

### Main Phase 5 / 5.2 Returns Runtime UAT & Official Closure — 2026-08-22

- **5.2 Returns = ✅ COMPLETE / TARGETED CHECKS PASSED / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- Supplier Return fresh UAT: `RTN-2026-60003` from `RCV-2026-420140` / Lot `LOT-2026-AD6712E9`; `1.000 @ 1.0000 = 1.00`; Live DB after posting: Lot remaining/balance/Inventory/SUM Lots = `5.000`, Average Cost `1.0000`, Total Value `5.00`, movement = `out/return`, `transactionReturnId=60003`. PASS.
- Recipient full return: `RTN-2026-60004` from `DLV-2026-300204`; same Inventory `210253`, same Lot `21`, original issue movement `450501`, original issue cost `1.0000`, return movement `450502 = in/return @ 1.0000`, value `1.00`. PASS.
- A later resolve attempt against fully-returned `DLV-2026-300204` was rejected with `تم إرجاع كامل الكمية المصروفة في هذا السند مسبقًا`. PASS.
- Recipient partial/over-return case: `DLV-2026-300205` issued `2`; attempt to return `3` rejected with `الكمية (3) أكبر من المتبقي القابل للإرجاع (2)`; then `RTN-2026-60005` returned `1`. Live DB showed `totalReturned=1`, `remainingReturnable=1`, Lot/Inventory/SUM Lots `4.000`, Total Value `4.00`, and `in/return @ original issue cost 1.0000`. Reopening the Delivery in UI showed issued `2`, previously returned `1`, remaining `1`. PASS.
- Accepted non-blocking limits: hardened Legacy non-Lot Supplier Return was not separately Runtime-exercised in the Lots-enabled deployed environment; Recipient Return list/print source traceability remains covered by targeted source checks rather than a separate fresh print UAT.
- No historical backfill, legacy cleanup, broad FK/UNIQUE, Approval/Quarantine Workflow, or unrelated accounting redesign.
- **Historical stop before 5.3 approval:** Main Phase 5 = IN PROGRESS; 5.1 = CLOSED; 5.2 = CLOSED; 5.3 was NOT STARTED; 5.4 = NOT STARTED. 5.3 was subsequently started by explicit owner approval on 2026-08-23.
- Closure reference: `docs/CMMS_PHASE5_STEP2_RETURNS_RUNTIME_UAT_CLOSURE_2026-08-22.md`.

## ⏳ مهام معلَّقة (لم تُنفَّذ بعد)

### 2026-10-15 — مناقشة السجلات القديمة لتكلفة مواد البلاغات وPMV2

**من طلبها:** صاحب المشروع؛ طلب البدء بتطوير العمليات الجديدة ثم مناقشة السجلات القديمة بعد الانتهاء.

**الوصف:** تحديد المعالجة المناسبة للصرف والمرتجع السابقين اللذين لا يحملان مرجع التنفيذ الجديد أو لقطة تكلفة لوت موثوقة، وربطهما المحتمل بالبلاغات بالاسم/الفريق ومهام PMV2. لا توجد طريقة معالجة أو سياسة ترحيل تاريخي معتمدة بعد.

**الحالة:** مؤجلة للنقاش بعد مراجعة تطوير العمليات الجديدة. لا Backfill، ولا تخمين أسعار/مراجع، ولا تعديل حركات المتوسط أو السجلات التاريخية أو اتصال بالقاعدة من الوكيل. أي SQL لاحق يُعرض على صاحب المشروع لتنفيذه يدويًا بعد موافقته.

**المرجع:** `docs/material-costs/IMPLEMENTATION_AR.md`.

---


### 2026-09-02 — Annual Reset لترقيم PR ومراجعة PB قبل 2027
**من طلبها:** صاحب المشروع — بعد إغلاق مشكلة تكرار PR واعتماد العداد الذري الحالي.

**الوضع الحالي:**
- PR numbering أصبح ذريًا عبر `purchase_order_number_counter` + `UNIQUE` على `purchase_orders.poNumber`.
- Live verification نجح على `PR-2026-0471` ثم `PR-2026-0472` بعد Railway deployment.
- العداد الحالي Global `AUTO_INCREMENT`، لذلك Prefix السنة يتغير لكن التسلسل الرقمي لا يعود تلقائيًا إلى `0001`.
- `purchase_package_number_counter` يستخدم النمط العالمي نفسه ويجب مراجعته ضمن نفس المهمة إذا كان المطلوب `PB-2027-00001`.

**المطلوب مستقبلًا:** تصميم Year-Aware atomic counter أو حل مكافئ قبل 2027، مع الحفاظ على UNIQUE وعدم Renumbering للسجلات التاريخية.

**الحدود:** لا تنفيذ الآن؛ لا حذف counter rows؛ لا `ALTER AUTO_INCREMENT` عشوائي؛ لا تغيير Workflow. أي SQL على Live DB يكون أمرًا واحدًا فقط بعد فحص الواقع.

**الحالة:** ⏸️ **DEFERRED / REVIEW BEFORE 2027 / DO NOT AUTO-IMPLEMENT.**

**المرجع:** `docs/CMMS_PURCHASE_NUMBERING_ANNUAL_RESET_DEFERRED_2026-09-02.md`.

---

### 2026-09-02 — Purchase Package Grouping Hardening Review (غير حاجب)
**السياق:** مراجعة المصدر بعد نجاح Runtime UAT للحزم. لا يوجد عطل Runtime مثبت، ولم يوافق صاحب المشروع على تغيير جديد.

**ملاحظات للمراجعة المستقبلية فقط:**
1. جعل إنشاء رأس `purchase_packages` وربط `purchase_orders.packageId` داخل Transaction واحدة إذا تقرر hardening concurrency.
2. فرض Distinct `orderIds` في API، رغم أن الواجهة الحالية لا تنتج تكرارًا طبيعيًا.
3. `purchase_package_submissions.subNumber` يُحسب `last + 1`; يوجد `UNIQUE(purchasePackageId, subNumber)` يمنع duplicate فعليًا، لكن يمكن لاحقًا تحسين retry/atomic reservation لإرسالين متزامنين جدًا.

**الحالة:** ⏸️ **NON-BLOCKING / DEFERRED / DO NOT AUTO-IMPLEMENT.**

**المرجع:** `docs/CMMS_PURCHASE_PACKAGES_CURRENT_WORKFLOW_REVIEW_AND_RUNTIME_CLOSURE_2026-09-02.md`.

---

### 2026-08-24 — Main Phase 7 مؤجلة؛ التنفيذ المستقبلي = Option B Shared Posting Core
**من طلبها:** صاحب المشروع — بعد مناقشة الحاجة الفعلية إلى Main Phase 7 عقب الإغلاق الرسمي لـMain Phase 6.

**القرار:** تأجيل Main Phase 7 الآن وعدم بدء Coding. عند العودة إليها مستقبلًا، ينفذ الاتجاه المعتمد **Option B — Shared Posting Core صغير ومحافظ** بدل Full Centralized Inventory Posting Engine.

**حدود التنفيذ المستقبلي:**
- Business Rules وسياسات التكلفة تبقى داخل Workflows المتخصصة.
- Shared Core يقتصر على primitives مشتركة ذات فائدة واضحة بعد إعادة الفحص وقتها.
- Batch Transfer يبقى per-item / partial success.
- Centralized Numbering و`receipt_number_counter` يبقيان مؤجلين وخارج النطاق.
- لا Historical Cleanup / Backfill / Revaluation / Renumbering.
- لا Cutover ضمن Main Phase 7.
- لا Workflow/Accounting behavior change بدون موافقة منفصلة.
- Live DB هي مصدر الحقيقة؛ وإذا لزم SQL مستقبلًا فيكون أمرًا واحدًا فقط في كل مرة وينفذه صاحب المشروع يدويًا.

**الحالة:** ⏸️ **DEFERRED / NOT STARTED — DO NOT AUTO-IMPLEMENT.**

**المرجع:** `docs/CMMS_MAIN_PHASE7_DEFERRAL_AND_OPTION_B_SHARED_POSTING_CORE_DECISION_2026-08-24.md`.

---

### 2026-08-20 — Main Phase 3 Post-Closure: فحوصات تحقق غير حاجبة
**من طلبها:** صاحب المشروع — طلب توثيق المعلّقات للعودة إليها لاحقًا بعد الإغلاق الرسمي لـMain Phase 3.

**السياق:** Main Phase 3 تبقى ✅ **COMPLETE / RUNTIME UAT PASSED / CLOSED**. البنود التالية ليست عيوبًا مانعة ولا تعيد فتح المرحلة تلقائيًا؛ هي Spot-checks إضافية يمكن تنفيذها لاحقًا عند الرغبة أو ضمن Final Project Hardening / Closure.

**المتبقي:**
1. **Duplicate Settlement Runtime Retry:** توجد حماية Backend تمنع تطبيق نفس Count Settlement مرتين، لكن لم يُنفَّذ أثناء جلسة الإغلاق Runtime UAT مستقل يعيد محاولة تطبيق نفس Settlement نفسها مرة ثانية للتأكد من الرفض في البيئة الحية. لاحقًا ضمن Main Phase 4 تم تنفيذ Runtime retry مستقل على `CNT-2026-60030` ورُفضت المحاولة الثانية بنجاح؛ لذلك أصبحت الحماية مثبتة Runtime على مسار Count Settlement الحالي، مع بقاء الـPhase 3 historical case نفسها دون إعادة تشغيل.
2. **`inventory_lots.remainingQuantity` Final Independent Check:** بعد آخر Delivery (`DLV-2026-300182`) تم التحقق Runtime من أن `inventory.quantity = SUM(inventory_lot_balances.quantity)`، لكن لم يُنفَّذ Query مستقل أخير للتأكد من `inventory_lots.remainingQuantity` لنفس الـLot بعد تلك الحركة.

**الحدود:**
- لا تعديل Code/Schema/Workflow/DB بسبب هذين البندين دون موافقة صريحة.
- لا يُعاد فتح Main Phase 3 لمجرد وجودهما.
- إذا احتاج التحقق Live DB، يُستخدم **أمر SQL واحد فقط في كل مرة**.

**الحالة:** ⏳ **معلَّقة كفحوصات تحقق إضافية غير حاجبة.**

**المرجع:** `docs/CMMS_PHASE3_INVENTORY_COUNT_FINAL_CLOSURE_2026-08-20.md` + Handoff الإغلاق بعد Main Phase 3.

---

### 2026-08-20 — Carry-forward بعد Phase 3: بنود تبقى مؤجلة/خارج النطاق
**من طلبها:** صاحب المشروع — توثيق المعلّقات للرجوع لها لاحقًا فقط، من دون تنفيذ الآن.

**البنود:**
- `2B-10-2C — Integrity Rules, UAT & Closure` → مؤجل إلى **Final Project Hardening / Closure**.
- ~~حوكمة/إصلاح تكرار أرقام Purchase Order~~ → ✅ **CLOSED 2026-09-02:** تم تنظيف التكرارات، تشغيل عداد ذري مستقل، وإضافة `UNIQUE` على `purchase_orders.poNumber`. بقيت فقط مهمة **Annual Reset** مستقلة أدناه.
- `PR-2026-0378` suspected approval race-condition → مؤجل (وله بند تفصيلي مستقل أدناه).
- Broad FK rollout → مؤجل، ولا يُنفَّذ تلقائيًا.
- Broad legacy Inventory cleanup / merge / backfill → مؤجل.
- FIFO / FEFO → خارج النطاق الحالي.
- Direct issue without QR → خارج النطاق الحالي.
- Historical Audit backfill → مؤجل.
- Orphan inactive Catalog Item cleanup → مؤجل.
- أي **Settlement approval workflow جديد** → غير معتمد، ولا يُضاف إلا بموافقة صريحة مستقلة.

**ملاحظة Phase 4:** **Main Phase 4 — Settlement Development أُغلقت رسميًا بتاريخ 2026-08-22 بعد نجاح Runtime UAT.** البنود المؤجلة في هذه القائمة، خصوصًا Approval Workflow أو Legacy cleanup، لم تصبح معتمدة بسبب إغلاق Phase 4 ولا تُنفذ دون موافقة مستقلة.

**الحالة:** ⏳ **CARRY-FORWARD / DO NOT AUTO-IMPLEMENT.**

---

### 2026-08-20 — CLOSED: Receipt Inventory Identity Future Guard
**من طلبها:** صاحب المشروع — وافق على إصلاح الفجوة للمستقبل فقط بعد اكتشاف Duplicate Inventory أثناء Phase 3 Step 1.

**الوصف:** Backend أصبح يعيد استخدام Inventory الوحيد لنفس `Catalog Item + Warehouse` عند الاستلام بدل إنشاء سجل جديد، ويمنع إنشاء سجل ثالث إذا وجد أكثر من Legacy Inventory.

**الحدود:** لا دمج/حذف/Backfill للسجلات القديمة `210200` و`210222` أو أي Legacy duplicates، ولا FK/UNIQUE/Migration، ولا إزالة UI للربط اليدوي ضمن هذه الحزمة.

**UAT المنفذ:** `PR-2026-0389` على Catalog Item `360002` أعاد استخدام Inventory `210211`; quantity `2→3`, averageCost `5→10` بعد استلام `1×20`, مع بقاء `averageCostSnapshot=5.0000` في `CNT-2026-60028`.

**الحالة:** ✅ **IMPLEMENTED / RUNTIME UAT PASSED.**

**المرجع:** `docs/CMMS_RECEIPT_INVENTORY_IDENTITY_FUTURE_GUARD_IMPLEMENTATION_2026-08-20.md`.

---


### 2026-08-19 — 2B-10-2C: Final Integrity Rules / UAT / Closure
**من طلبها:** صاحب المشروع — قرر تأجيلها إلى الإغلاق النهائي للمشروع.

**الوصف:** مراجعة Integrity النهائية بعد استقرار بقية المشروع، مع إعادة فحص Live DB وتحديد الحماية المستقبلية الضرورية فقط، ثم UAT وإغلاق 2B-10 رسميًا.

**سبب التأجيل:** القيود النهائية مثل FK / UNIQUE / hard constraints تكون أدق وأقل مخاطرة بعد اكتمال التصميم والعلاقات النهائية للمشروع.

**حدود واضحة:** لا FK/UNIQUE/Migration/Backfill/cleanup أو تعديل Workflow ضمن قرار التأجيل نفسه.

**الحالة:** ⏳ **DEFERRED — Final Project Hardening / Closure.**

**المرجع:** `docs/CMMS_2B10_2C_DEFERRAL_DECISION_2026-08-19.md`.

---


### 2026-08-19 — PR-2026-0378: حالة Parent PO غير متسقة بعد الاعتماد
**من طلبها:** صاحب المشروع — تم اكتشافها أثناء UAT صلاحيات Catalog وطلب تأجيل إصلاحها.

**الوصف:** الطلب `PR-2026-0378` لديه Pricing Batch = `approved`، وبند الطلب = `approved`، والمندوب معيّن، وحقول اعتماد الإدارة موجودة، بينما `purchase_orders.status` بقي `pending_management`. الطلب المقارن `PR-2026-0379` عبر المسار ووصل إلى `approved` طبيعيًا.

**الفحص المنفذ:** لا يوجد Trigger على جدول `purchase_orders`. المقارنة الزمنية ومسار الكود الحالي يدعمان اشتباه **Race Condition بين اعتماد الحسابات واعتماد الإدارة**.

**سبب التأجيل:** المشكلة تخص Purchase Workflow وليست Catalog Permissions، وصاحب المشروع طلب توثيقها والعودة لها لاحقًا.

**الحالة:** ⏳ **معلَّقة — لا تعديل يدوي لبيانات PR-2026-0378 ولا إصلاح كود ضمن 2B-10-1.**

---

<!--
القالب:
### [تاريخ الإضافة] — [عنوان مختصر]
**من طلبها:** صاحب المشروع
**الوصف:**
**سبب التأجيل:**
**الحالة:** ⏳ معلَّقة
-->

### 2026-08-08/10 — ✅ مُنجَز: خلل تعارض تسمية `relatedPOId`/`relatedPoId` بكل النظام
**الحالة النهائية:** ✅ **مُصلَح بالكامل (2026-08-10)** — لا يحتاج أي إجراء إضافي (يُبقى للمرجعية فقط)

**الاكتشاف الأصلي (2026-08-08):** حذف طلب شراء له إشعارات مرتبطة يفشل — `deletePurchaseOrder` تستخدم
`relatedPOId` (حرف O كبير) بينما عمود `notifications.relatedPoId` بالفعل بحرف o صغير.

**إعادة التقييم عند المعالجة (2026-08-10) — الأثر أوسع بكثير مما قُدِّر ابتداءً:** التتبّع الكامل كشف أن
**دالة إنشاء الإشعارات المركزية نفسها** (`createNotification`) كانت تكتب بنفس الاسم الخاطئ — يعني **كل
إشعار أُنشئ بالنظام منذ البداية فقد رابطه بطلب الشراء بصمت**، ليس فقط موضع الحذف. الأثر الفعلي المؤكَّد:
(1) فشل حذف الطلبات ذات الإشعارات، (2) **زر "فتح الطلب المرتبط" بصفحة الإشعارات لم يعمل من قبل لأي
مستخدم إطلاقًا**.

**القرار المعتمد (بموافقة صريحة بعد توضيح الأثر):** لا استرجاع للإشعارات القديمة (بيانات فارغة فعليًا
بلا مصدر بديل موثوق) — التركيز على المستقبل فقط. الإصلاح بالكود حصرًا، **صفر تعديل على قاعدة البيانات**
(القرار الهندسي: الخطأ بالكود لا بالبنية، فلا داعٍ لترحيل `RENAME COLUMN` بجدول حيّ).

**التنفيذ:** توحيد الاسم على `relatedPoId` (مطابقًا للعمود الفعلي) بـ**10 ملفات، 51 موضعًا** — خادمًا
وواجهة معًا. راجع `docs/CHANGELOG_TECHNICAL.md` (بند 2026-08-10) لقائمة الملفات الكاملة بعدد المواضع بكل
واحد.

**⚠️ اختبار مطلوب قبل الإغلاق النهائي:** إنشاء إشعار جديد مرتبط بطلب شراء، فتحه من صفحة الإشعارات
والتأكد من نجاح الانتقال؛ وحذف طلب شراء له إشعار والتأكد من نجاح الحذف.

---

### 2026-08-09/10 — ✅ مُنجَز: رقم البلاغ كان يُعاد استخدامه بعد الحذف
**الحالة:** ✅ **مكتمل ومُختبَر على الإنتاج — لا يحتاج أي إجراء إضافي** (يُبقى هنا للمرجعية فقط)
**ما كان:** `getNextTicketNumber()` تولّد الرقم بـ`SELECT MAX` على البلاغات الموجودة، فحذف بلاغ يحمل أعلى
رقم يُرجع العدّاد للخلف. حالتان مؤكَّدتان بالإنتاج: MT-2026-00174 وMT-2026-00175 أُعيد استخدامهما لبلاغين
حقيقيين ("Electrical") بعد حذف بلاغين تجريبيين.
**ما صار:** جدول عدّاد مستقل `ticket_number_counter` (نفس نمط العدّادات الستة القائمة). مُطبَّق على
الإنتاج ومُهيَّأ عند 221. **اختبار عملي: بلاغ جديد أخذ MT-2026-00222** — متصل بلا فجوة.
**مكسب جانبي:** أُغلقت ثغرة سباق تزامن كانت قائمة (طلبان متزامنان كانا قد يأخذان نفس الرقم).
**ملاحظة:** الأرقام المكرَّرة سابقًا (00174/00175) تُركت كما هي عمدًا — إعادة الترقيم كانت ستكسر المستندات
والتقارير المطبوعة. راجع `docs/CHANGELOG_TECHNICAL.md` (بندا 2026-08-09 و2026-08-10).

---

### 2026-08-08/10 — ✅ مُنجَز: دورة حياة الصيانة الخارجية أصبحت واعية بالبند
**الحالة النهائية:** ✅ **مُصلَح (2026-08-10)** — لا يحتاج أي إجراء إضافي (يُبقى للمرجعية فقط)

**ما كان:** بعد استبدال الفهرس الفريد بالخطوة 5 (سمح بتعدد سجلات صيانة خارجية نشطة معًا بنفس البلاغ)،
كانت `approveExternalMaintenanceGateExit`/`approveExternalMaintenanceGateEntry`/
`receiveExternalMaintenanceAsset`/`handoverExternalMaintenanceAsset` كلها تعمل على `tickets.status`
مباشرة — خطر تعارض كتابات إن نشط أكثر من سجل معًا.

**التشخيص عند المعالجة:** من الأربع، **دالتان فقط** تكتبان قيمة جديدة فعليًا على `tickets.status`
(مصدر التعارض الحقيقي): `approveExternalMaintenanceGateExit` و`handoverExternalMaintenanceAsset`.
الأخريان لا تغيّران حالة البلاغ إطلاقًا، فلا خطر فيهما.

**ما نُفِّذ:** الدالتان أصبحتا تفحصان وتحدّثان *البند* (`ticket_items`) عند توفر `job.ticketItemId`، مع
توافق رجعي كامل (البند الأول يعكس التحديث على `tickets`). كذلك أُصلحت ثغرة إضافية موثَّقة منذ الخطوة 5:
`handoverExternalMaintenanceAsset` تستخدم الآن فني *البند* (`item.assignedToId`) لا فني رأس البلاغ فقط.
**لا تعديل على الراوتر** — طبقة قاعدة البيانات تستنتج البند داخليًا.

راجع `docs/CHANGELOG_TECHNICAL.md` (بند المتابعة 2026-08-10) للتفاصيل الكاملة، بما فيها نقطة ثانوية
متبقية غير خطرة (حقول معلوماتية بلا مقابل بجدول `ticket_items` تبقى على `tickets` فقط — عرض ثانوي محتمل
التضليل، لا فقدان بيانات، موثَّقة بالتفصيل).

⚠️ **اختبار مطلوب قبل الاستخدام الفعلي المكثّف**: بلاغ بندين على مسار C، دورة صيانة خارجية كاملة متزامنة
لكل بند، والتأكد من عدم تعارض حالتيهما.

---

### 2026-08-10 — ميزة البلاغ متعدد الجهات: الدورة التشغيلية مكتملة، 3 أجزاء محيطة متبقية

⚠️ **تحديث 2026-08-11:** هذا الوصف يخص نموذج `ticket_items` القديم الذي كان يجعل كل جهة بندًا تنفيذيًا. النموذج الجديد لا يحذفه للتوافق، لكنه يفصل التنظيم إلى `ticket_departments` و`ticket_tasks`، ثم يحوّل المهمة إلى بلاغ فرعي اختياري يدخل الـWorkflow. البنود الثلاثة المحيطة أدناه ما زالت دَينًا تقنيًا وتحتاج إعادة تقييم على ضوء النموذج الجديد.
**من طلبها:** صاحب المشروع سأل "هل انتهينا من البلاغات المتعددة؟" — التوثيق للعودة لاحقًا بدل التنفيذ الآن
**الحالة:** ⏳ معلَّقة — **الدورة الأساسية تعمل بالكامل، هذا البند لأجزاء محيطة فقط**

**✅ ما يعمل بالكامل من أوله لآخره (لا حاجة لأي عمل إضافي هنا):** الفرز المتعدد الجهات، رؤية كل جهة
لمهمتها فقط، اختيار مسار مستقل لكل بند (A/B/C)، طلب شراء مستقل لكل بند، صيانة خارجية مستقلة لكل بند،
تنفيذ الإصلاح لكل بند، والإغلاق المشروط باكتمال كل البنود. راجع كل بنود `docs/CHANGELOG_TECHNICAL.md`
من 2026-08-08 حتى 2026-08-10 للتفاصيل الكاملة لكل جزء.

**⏳ ما تبقّى — 3 أجزاء محيطة، لا تمنع الاستخدام التشغيلي اليومي، لكنها تحتاج معالجة:**

1. **التقارير التسعة تقرأ `tickets.maintenancePath` مباشرة** (لا `ticket_items`) — مواضعها الرئيسية:
   `server/services/reports/purchaseCyclePhases.ts` وتقارير دورة الصيانة/القسم/التكلفة. **الأثر:** بلاغ
   متعدد المسارات (مثال: بندان A وB معًا) تُحسب أرقامه بالتقارير كمسار واحد فقط — غير دقيق.
   **الإصلاح المقترح:** كل استعلام تقرير يحتاج مراجعة ليقرأ من `ticket_items` بدل عمود البلاغ عند وجود
   أكثر من بند، بنفس مبدأ التوافق الرجعي المتبع بكل خطوة سابقة (بلاغ أحادي البند ينتج نفس النتيجة).

2. **مستند البلاغ المطبوع (PDF)** — `server/services/pdf/ticketPdfService.ts` يطبع حقل مسار/ملاحظات
   واحدًا فقط، لا يعرض البنود إطلاقًا. **الإصلاح المقترح:** جدول بنود يُضاف للمستند عند `ticketItems.length > 1`
   (نفس شرط إظهار قسم "بنود البلاغ" بشاشة التفاصيل — الخطوة 2).

3. **ترجمة وصف البنود** — أعمدة `ticket_items.description_en/ur` موجودة من الخطوة 1 لكن غير موصولة
   بمحرك الترجمة (`server/services/translation/translationEngine.ts`). **الأثر:** الفني غير الناطق
   بالعربية لا يفهم "المطلوب من هذه الجهة" إن كتبه مدير عربيًا. **الإصلاح المقترح:** فرع جديد
   `TICKET_ITEM` بالمحرك (نفس نمط `TICKET`/`ASSET`/`WORK_ORDER` القائم) + استدعاء `queueTranslation` عند
   إنشاء/تعديل بند.

**سبب التأجيل:** لا تشكّل ثغرة تشغيلية أو أمنية — الدورة الفعلية (إنشاء→فرز→تنفيذ→إغلاق) تعمل بشكل كامل
وصحيح بدونها. تُعالَج عند الحاجة الفعلية للتقارير/الطباعة/الترجمة الدقيقة لبلاغات متعددة البنود.

---

### 2026-08-10 — مبدأ متفق عليه (لم يُنفَّذ بعد): "الدور أولًا ثم المستخدم" — قاعدة عامة لكل مستلمي الإشعارات بالنظام
**من طلبها:** صاحب المشروع، بعد سؤاله "ايش رايك نعيد بناء مركز الاشعارات" ثم اقتراحه المبدأ التالي
**الحالة:** ⏳ معلَّقة — **مبدأ مؤكَّد ونهائي، توثيق فقط بانتظار الأمر بالتنفيذ**

**القرار الحاسم أولًا (رفض إعادة البناء):** اقتُرح إعادة بناء مركز الإشعارات بالكامل — **رُفض صراحةً**.
السبب: طبقة القراءة (`getUserNotifications`) سليمة ومعزولة بشكل صحيح 100% (`WHERE userId = ...`)، وبنية
جدول `notifications` كافية. **المشكلة الفعلية محصورة بمنطق اختيار المستلم عند الإنشاء فقط** — دوال مساعدة
معينة تُرجع "كل من له دور معيّن" بدل "الشخص المسؤول فعليًا"، رغم أن حقل المسؤول موجود ومملوء غالبًا. إعادة
بناء نظام يُستدعى من كل دومين بالمشروع (بلاغات، مشتريات، مخزون، صيانة خارجية) لحل خلل محصور بدالتين
مساعدتين = مخاطرة غير مبرَّرة (قد تُسكت إشعارات حرجة بكل دومين دفعة واحدة).

**المبدأ المعتمد بدلًا من إعادة البناء — "الدور أولًا ثم المستخدم":**
```
هل يوجد شخص محدد مسؤول عن هذا الحدث بعينه؟
  نعم → يصله الإشعار وحده (لا كل الدور)
  لا (لم يُعيَّن أحد بعد) → يصل لكل من بهذا الدور (سقوط احتياطي إلزامي — يمنع ضياع الإشعار)
```
هذا **تعميم رسمي** لنفس النمط المُطبَّق فعليًا بموضعين اليوم (`notifyTicketSupervisor` للمشرفين، والمقترح
لـ`getTicketWorkflowManagerUsers` للمدراء) — لا حل جديد، بل تثبيته **كقاعدة عامة لكل مستلمي الإشعارات
بالنظام**، لا فقط الحالتين اللتين عُولجتا.

**الأداة المقترحة للتعميم (لم تُبنَ بعد):** دالة مساعدة موحّدة واحدة تُستخدَم بكل موضع إنشاء إشعار بالنظام
(لا تكرار الشرط يدويًا بكل ملف):
```
notifyRoleOrAssignee(role, specificUserId?, notification)
  → لو specificUserId موجود: يُرسَل له وحده
  → لو غير موجود: يُرسَل لكل مستخدمي role
```

**نطاق العمل المتبقي عند التنفيذ (مُحدَّد بالتفصيل من التدقيق الفعلي لدورة البلاغات بهذه الجلسة):**

1. **إصلاح مركزي واحد يحل 8 مواضع دفعة واحدة:** `server/_core/db/tickets.ts::getTicketWorkflowManagerUsers`
   حاليًا تُرجع (كل مدراء الصيانة بالشركة) **+** المدير المُوجَّه — بثّ مقنَّع رغم وجود تخصيص ظاهري.
   يجب أن تُرجع **فقط** المدير المُوجَّه (`ticket.maintenanceResponsibleManagerId`) مع سقوط احتياطي للبثّ
   عند غيابه. تُستخدَم بـ8 مواضع بـ`tickets.approvals.ts` (4), `tickets.closure.ts` (2),
   `tickets.purchase.ts` (1), `tickets.workflow.ts` (1) — إصلاح مكان واحد يصلحها جميعًا تلقائيًا.
2. **4 مواضع تستخدم `server/_core/db/purchase.ts::getTicketManagerUsers`** (بثّ كامل بلا أي تخصيص —
   إنشاء بلاغ، تعديله، حذفه، بـ`tickets.router.ts`): **تبقى بثًّا عمدًا** بنفس منطق إنشاء البلاغ الذي
   أُقرَّ سابقًا (لا مسؤول مُعيَّن بعد بهذه اللحظات) — توثيق فقط، لا تعديل.
3. **تعميم الأداة `notifyRoleOrAssignee`** لتحل تدريجيًا محل الاستدعاءات المباشرة لـ`getUsersByRole` بكل
   دومين آخر غير البلاغات (مشتريات: إشعار الحسابات/الإدارة العليا، مخزون، صيانة خارجية) — راجع التصنيف
   الأصلي للـ19 موضعًا الأول بهذا الملف (مجموعة "بثّ مبرَّر تشغيليًا" مقابل غير المبرَّر) قبل التطبيق على
   كل دومين، لأن بعضها (مستودع/حراسة بنوبات) بثّها مقصود ولا يجب تضييقه.
4. **توثيق المبدأ رسميًا بـ`CLAUDE.md`** كقاعدة حرجة جديدة — بنفس مستوى القواعد الحالية — ليلتزم بها أي
   تطوير مستقبلي بالنظام تلقائيًا عند إضافة أي إشعار جديد، لا فقط المواضع المُصلَحة اليوم.

**العلاقة بالتصميم المؤجَّل السابق (تقييد إشعارات الحسابات + `category`):** مبدآن **مكمِّلان لا بديلان**.
"الدور ← مستخدم" يجيب "لمن يُرسَل الإشعار تحديدًا؟"، و"`category`" يجيب "أي أنواع إشعارات يُسمح لهذا
الدور برؤيتها أصلًا؟". قد نحتاجهما معًا مستقبلًا لنفس الإشعار.

**سبب التأجيل:** توثيق المبدأ والنطاق أولًا بطلب صريح من صاحب المشروع، قبل البدء بالتنفيذ الفعلي.

---

### 2026-08-10 — تصميم متفق عليه (لم يُنفَّذ بعد): تقييد إشعارات دور الحسابات + نظام تصنيف عام قابل لإعادة الاستخدام
**من طلبها:** صاحب المشروع
**الحالة:** ⏳ معلَّقة — **تصميم مؤكَّد ونهائي، بانتظار الأمر بالتنفيذ فقط**

**الطلب الأصلي:** مركز الإشعارات لا يُظهر لدور "الحسابات" إلا إشعارًا واحدًا تحديدًا: عندما يرسل المندوب
طلب شراء مُسعَّرًا للحسابات للاعتماد. بقية الإشعارات لا تظهر له إطلاقًا.

**رفض صريح لحل مؤقت:** اقتُرح ابتداءً فلترة بمطابقة نص العنوان حرفيًا (`"طلب شراء بانتظار الاعتماد"`) —
رُفض لأنه هش (ينكسر بصمت لو تغيّر نص العنوان مستقبلًا) وغير قابل لإعادة الاستخدام.

**التصميم المعتمد نهائيًا — عام لكل الأدوار، لا خاص بالحسابات وحده:**

1. **عمود جديد** `notifications.category` (نص قصير، **اختياري** — `NULL` لكل الإشعارات القديمة والمستقبلية
   غير المصنَّفة، لا يكسر شيئًا).
2. **الموضعان المحدَّدان فقط** يُعلَّمان بالتصنيف عند الإنشاء (لا تصنيف رجعي لأي إشعار قديم أو لبقية
   مواضع الإنشاء بالنظام — خارج نطاق هذا الطلب صراحةً):
   - `submitPricedBatch` (`server/routers/purchase/purchase-orders.router.ts`, حول السطر 1495)
   - `requestItemRevision` (نفس الملف، حول السطر 2046)
   - كلاهما: `category: "po_pending_accounting"`.
3. **خريطة مركزية جديدة** `server/_core/notifications/roleCategoryPolicy.ts` — تربط كل دور بقائمة
   التصنيفات المسموح له رؤيتها فقط:
   ```
   accountant: ["po_pending_accounting"]
   ```
   **قاعدة افتراضية إلزامية**: أي دور **غير مذكور** بالخريطة يستمر يرى **كل** الإشعارات كالمعتاد — الخريطة
   قائمة استثناءات، لا نظام إلزامي شامل. **لا تُغيَّر هذه القاعدة الافتراضية عند التنفيذ.**
4. **الفلترة** تُضاف بـ`server/_core/db/notifications.ts::getUserNotifications` و`getUnreadNotificationCount`
   — تستقبل دور المستخدم، وتُطبِّق قيد `category IN (...)` فقط لو الدور موجود بالخريطة.

**القيمة المستقبلية (سبب اختيار هذا التصميم تحديدًا):** أي قيد مشابه لأي دور آخر لاحقًا (مثال أعطاه صاحب
المشروع: "المستودع يرى فقط إشعارات الاستلام والتسليم") يصبح: (أ) تصنيف مواضع الإنشاء ذات العلاقة بسطر
واحد لكل موضع، (ب) سطر واحد جديد بالخريطة. **بلا أي بنية جديدة ولا تعديل بمكان آخر.**

**سبب التأجيل:** طلب صاحب المشروع تنفيذ النقطة ١ (إخفاء التقارير/تتبع الصنف) أولًا وتوثيق هذا التصميم
للتنفيذ لاحقًا.

---

### 2026-08-08 — دَين تقني: كتلة "الجهات المتعددة" مكرَّرة بثلاثة مواضع بالواجهة
**من طلبها:** اكتُشف أثناء تنفيذ إعادة ترتيب أزرار الفرز (`docs/CHANGELOG_TECHNICAL.md`، بند إعادة الترتيب)
**الوصف:** كتلة "مربعات اختيار الجهات + حقل المطلوب من كل جهة + المسؤول + الفني" مكرَّرة الآن حرفيًا
بثلاثة مواضع: نافذة الفرز الكامل (`TriageDashboard.tsx`، معطَّلة الظهور)، نافذة الفرز السريع
(`TriageDashboard.tsx`، نشطة)، ونافذة "بدء الفرز وتعيين الفني" (`TicketDetail.tsx`). تعديل شكل هذه
الكتلة مستقبلًا (حقل جديد، تغيير تصميم) يتطلب تعديل ثلاثة أماكن يدويًا بدل مكان واحد.
**سبب التأجيل:** قرار مقصود لتسريع التسليم وتقليل الخطر على شاشتين حيّتين بنفس الجلسة؛ استخراج مكوّن
React مشترك (`MultiDepartmentTriageFields` مثلًا) يستحق جلسة منفصلة مع اختبار كامل.
**الحالة:** ⏳ معلَّقة

---

### 2026-08-08 — البلاغ متعدد الجهات والمسارات: الخطوات 3→7 لم تبدأ بعد

⚠️ **ملاحظة 2026-08-11: هذا القسم تاريخي ومُتجاوَز.** الدورة القديمة اكتملت لاحقًا، ثم اعتمد صاحب المشروع في 2026-08-11 نموذجًا أحدث يفصل **الجهات → المهام → الفنيين → التحويل الاختياري لبلاغ فرعي**. لا تستخدم عبارة "لم تبدأ" أدناه لتحديد الحالة الحالية؛ راجع القاعدة #14 في `CLAUDE.md` وبند 2026-08-11 في `docs/CHANGELOG_TECHNICAL.md`.
**من طلبها:** صاحب المشروع
**الوصف:** ميزة "البلاغ متعدد الجهات ومتعدد المسارات" تُنفَّذ **على خطوات متتابعة بقرار صريح من صاحب
المشروع** — كل خطوة تُسلَّم وتُجرَّب فعليًا قبل بدء التي تليها.

**✅ الخطوة 1 (مُنجَزة 2026-08-08، ومُطبَّقة فعليًا على قاعدة الإنتاج بتاريخ 2026-08-08):** جدول
`ticket_items` + ترحيل كل البلاغات القائمة إلى "بند واحد" + طبقة قاعدة البيانات + إجراء القراءة
`tickets.items`. طُبِّق الترحيل يدويًا على الإنتاج والتحقق أظهر تطابقًا تامًا: 160 بلاغًا = 160 بندًا.
راجع `docs/CHANGELOG_TECHNICAL.md` (بندا 2026-08-08 والمتابعة).

**⏳ متبقٍّ من الخطوة 1 نفسها (لم يُؤكَّد بعد من صاحب المشروع):**
- تشغيل `npm run check` و`npm test` على بيئة حقيقية (ملاحظة: التحقق العملي المباشر — حذف بلاغ فعلي على
  الإنتاج — أُنجز ونجح فعليًا 2026-08-08، وهو أقوى دليل عملي من فحوصات التحويل الساكنة).

**✅ الخطوة 1 — مكتملة بالكامل ومؤكَّدة عمليًا (2026-08-08):**
- استبدال ملفات الكود الأربعة (`schema.ts`, `server/_core/db/tickets.ts`, `server/_core/db/deletes.ts`,
  `server/routers/tickets/tickets.router.ts`) على الخادم الفعلي: **تم**.
- **الاختبار الحاسم (حذف بلاغ تجريبي `MT-2026-00197` بعد استبدال الكود): نجح فعليًا** — يؤكد أن
  `deleteTicket` يحذف `ticket_items` قبل `tickets` كما هو مطلوب، ولا خلل بالمفتاح الخارجي الجديد.

**⏳ تذكير بتنظيف لاحق:** جدول `tickets_backup_20260808` (نسخة احتياطية احترازية من `tickets`، 160
صفًا) لا يزال موجودًا على قاعدة الإنتاج. اتُّرك عمدًا بضعة أيام للاطمئنان. **بعد التأكد من استقرار النظام،
احذفه:** `DROP TABLE tickets_backup_20260808;` — لا يؤثر على `ticket_items` ولا على `tickets` نفسه إطلاقًا.

**✅ الخطوة 2 (مُنجَزة 2026-08-08):** الفرز المتعدد الجهات — إجراء `tickets.triageMulti` + دالة
`routeTicketToMultipleDepartments` (تستدعي `routeTicketAfterTriage` القائمة للجهة الرئيسية، بلا آلية
موازية) + قائمة منسدلة "طريقة الفرز" بـ`TriageDashboard.tsx` + `deleteLegacyTicketItems` +
ربط `tickets.create` بإنشاء بند تلقائي (أنهى فجوة "بلاغ جديد بلا بند"). **الفرز العادي والفرز السريع لم
يُلمسا إطلاقًا.** راجع `docs/CHANGELOG_TECHNICAL.md` (بند الخطوة 2).
⚠️ **متبقٍّ صغير مؤجَّل من الخطوة 2:** تفعيل ترجمة `ticket_items.description_*` (الأعمدة موجودة وتُملأ
حاليًا بالنص الأصلي بـ`descriptionAr` فقط؛ لم يُضف بعد فرع `TICKET_ITEM` في `translationEngine.ts`).

**⏳ الخطة المُعاد صياغتها بعد اكتشاف ثغرة الصلاحيات (2026-08-08) — 5 خطوات بدل الترقيم القديم 3→7:**

🔴 **أولوية عاجلة مكتشَفة أثناء اختبار صاحب المشروع للخطوة 2:** الجهة **الثانوية** بالفرز المتعدد (كل
جهة ليست الجهة الأولى المختارة) **تصلها إشعار بنص مهمتها لكنها تُمنع من فتح البلاغ نفسه** برسالة "ليس
لديك صلاحية للاطلاع على هذا البلاغ". السبب الجذري: `isConstructionTicketAssignedToUser`
(`tickets.access.ts`) وفلاتر القوائم (`tickets.list`, `getTicketsInboxCounts`, وفلترة شاشة الفرز) **كلها
تفحص عمود `tickets.maintenanceResponsibleDepartment` وحده** (يحمل بيانات الجهة **الأولى فقط** — راجع
`routeTicketToMultipleDepartments`)، ولا تعرف بوجود `ticket_items` إطلاقًا. **هذه ليست حالة نادرة —
ستتكرر مع كل فرز متعدد.** صاحب المشروع رفض صراحةً أي حل مؤقت (توسعة استثناء واحد) وطلب حلًا معماريًا
جذريًا. راجع `docs/CHANGELOG_TECHNICAL.md` لتفاصيل التتبّع الكامل لهذه الثغرة.

**✅ الخطوة 1 من الخطة الخماسية — نُفِّذت (2026-08-08)، بانتظار اختبار صاحب المشروع:**
`isTicketVisible`/`isConstructionTicketAssignedToUser` (`tickets.access.ts`) وواجهة
`assertTicketReadable` أصبحت تفحص `ticket_items` عند فشل المسار السريع؛ `buildTicketsWhere`
(`server/_core/db/tickets.ts`) — المصدر المشترك لـ`tickets.list`/`listPaginated`/`inboxCounts` — أصبح
يفحص `ticket_items` عبر `OR EXISTS` لفلتري (الجهة+المسؤول) و(الفني). راجع القاعدة الحرجة #12 بـ`CLAUDE.md`
و`docs/CHANGELOG_TECHNICAL.md` (بند تنفيذ الخطوة 1) للتفاصيل الكاملة.
⚠️ **لم يُختبر على قاعدة فعلية بعد** — الاختبار الحاسم: فتح بلاغ MT-2026-00212 من حساب مدير الإنشاءات
(الجهة الثانوية) والتأكد من زوال رسالة "ليس لديك صلاحية".
⚠️ **لم يشمل بعد:** إجراءات سير العمل (`canManageTicketWorkflow`, `assertTicketWorkflowManageable`) —
مؤجَّلة عمدًا للخطوة 3 (اختيار المسار لمستوى البند).
📝 **تصحيح تخطيط:** فلتر `TriageDashboard.tsx` (`ticket.maintenanceResponsibleDepartment !== CONSTRUCTION`)
تبيّن أنه فصل عرض مقصود لا جزءًا من الثغرة — **لم يُلمس عمدًا**، خلافًا لما ذُكر سابقًا في هذا الملف.

**✅ الخطوة 2 من الخطة الخماسية — نُفِّذت (2026-08-08)، بانتظار اختبار صاحب المشروع:**
قسم "بنود البلاغ" بشاشة تفاصيل البلاغ (`TicketDetail.tsx`، يظهر فقط للبلاغات >1 بند) + بطاقة "مهمتي"
بصفحة بلاغات الإنشاءات (`ConstructionTicketsPanel`) تعرض بند المستخدم الثانوي بدل حقول البلاغ العامة،
مع مؤشر خطوات مرتبة (فحص→مسار→تنفيذ→إغلاق) عبر ملف مشترك جديد `client/src/lib/ticketItemSteps.ts` ومكوّن
`TicketItemStepCard.tsx`. إجراء جديد آمن بذاته `tickets.myItemsForTickets`. راجع
`docs/CHANGELOG_TECHNICAL.md` (بند تنفيذ الخطوة 2).
⚠️ **لم يُختبر على قاعدة فعلية بعد** — الاختبار المطلوب: فتح MT-2026-00212 والتأكد من ظهور قسم البنود،
وفتح صفحة بلاغات الإنشاءات من حساب الجهة الثانوية والتأكد من ظهور بطاقة "بند 2".
📝 **دَين تقني موثَّق:** `client/src/pages/tickets/GeneralTicketsList.tsx` لم يحصل على نفس معاملة "بطاقة
مهمتي" بهذه الدفعة (تقليل حجم التغيير بشاشتين معًا بجلسة واحدة) — الأساس المشترك جاهز، الدمج هناك أخف
جهدًا مستقبلًا.

**✅ الخطوة 3 من الخطة الخماسية — نُفِّذت (2026-08-08)، بانتظار اختبار صاحب المشروع:**
`approveWorkForItem` (`tickets.workflow.ts`) + `canManageTicketItemWorkflow`/`canSelectTicketItemMaintenancePath`
(`tickets.access.ts`) — كل بند يُعتمَد بمساره المستقل، `approveWork` القديمة **لم تُلمس**. البند الأول
يعكس بياناته على أعمدة البلاغ تلقائيًا (توافق رجعي كامل مع البلاغات أحادية البند). راجع
`docs/CHANGELOG_TECHNICAL.md` (بند تنفيذ الخطوة 3).
🔴 **ثغرة إضافية اكتُشفت وأُصلحت أثناء هذه الخطوة**: نفس فئة ثغرة الخطوة 1 كانت موجودة أيضًا على العميل
(`TicketDetail.tsx::isManagedConstructionTicket/isGeneralMaintenanceScope`) — أُصلحت بنفس المبدأ.
⚠️ **لم يُختبر على قاعدة فعلية بعد** — الاختبار الحاسم: اعتماد مسارين مختلفين (A وB) لبندين مختلفين
بنفس البلاغ من حسابين مختلفين، والتأكد من استقلالهما التام.

**✅ الخطوة 4 من الخطة الخماسية — نُفِّذت (2026-08-08)، بانتظار تطبيق الترحيل واختبار صاحب المشروع:**
عمود `purchase_orders.ticketItemId` + `assertCanCreateTicketLinkedPurchaseOrder`/`syncPathBTicketItemFromItemId`
(`ticket-purchase-workflow.ts`) أصبحا واعيين بالبند — كل بند على مسار B يحصل على طلب شراء مستقل، وقيد
"طلب نشط واحد" يُفحص لكل بند لا لكل بلاغ. `create`/`saveDraft` بالراوتر و`CreatePurchaseOrder.tsx` بالواجهة
يدعمان `ticketItemId` اختياريًا. راجع `docs/CHANGELOG_TECHNICAL.md` (بند تنفيذ الخطوة 4).
✅ **الترحيل مُطبَّق على قاعدة الإنتاج (2026-08-10)** — عمود `purchase_orders.ticketItemId` وفهرس
`idx_purchase_orders_ticket_item` مؤكَّدان بـ`SHOW COLUMNS`/`SHOW INDEX`.
📝 **دَين تقني موثَّق**: لا يوجد بعد زر جاهز بشاشة تفاصيل البلاغ لإنشاء طلب شراء **لبند محدد** ضمن بلاغ
متعدد البنود (الأساس الخلفي جاهز بالكامل — رابط بمعامل `ticketItemId` يكفي). الزر القائم يعمل لمستوى
البلاغ فقط (صحيح للبلاغات أحادية البند).

**✅ الخطوة 5 (الأخيرة) من الخطة الخماسية — نُفِّذت جزئيًا بقرار مقصود (2026-08-08)، ومُطبَّقة بالكامل
على قاعدة الإنتاج (2026-08-10):**
عمود `external_maintenance_jobs.ticketItemId` + استبدال الفهرس الفريد (من `ticketId` إلى `ticketItemId`)
+ إعادة كتابة `listPathCTicketsWaitingWarehousePreparation`/`prepareExternalMaintenanceJob` لتصبحا واعيتين
بالبند. راجع `docs/CHANGELOG_TECHNICAL.md` (بند تنفيذ الخطوة 5) للتفاصيل والترحيل الحساس (5 عبارات مرقّمة).
🔴 **إصلاح خلل جانبي بالطريق**: مفتاح React كان سيتصادم لبلاغ له أكثر من بند بانتظار التجهيز — أُصلح.
⚠️ **النطاق المؤجَّل عمدًا — مهم قبل الاستخدام الفعلي**: بوابة الخروج/الدخول، الاستلام، والتسليم
(`server/_core/db/external-maintenance.ts`) **لا تزال تعمل على مستوى `tickets.status` فقط** — لم تُعمَّم
لتحديث `ticket_items` تحديدًا. **لا يُنصَح باستخدام أكثر من سجل صيانة خارجية نشط بنفس البلاغ فعليًا** حتى
معالجة هذه النقطة (مهمة تالية منفصلة موصى بها فورًا بعد اختبار الأساس المُنجَز هنا).
✅ **الترحيل مُطبَّق على قاعدة الإنتاج (2026-08-10)** — الفهارس مؤكَّدة بـ`SHOW INDEX`:
`uq_external_maintenance_ticket_item` و`idx_external_maintenance_ticket` موجودان، والقديم
`uq_external_maintenance_ticket` محذوف فعليًا.
📌 **5 سجلات صيانة خارجية تبقى بـ`ticketItemId = NULL` دائمًا** (id: 1,2,3,4,5) — بلاغاتها محذوفة من
جدول `tickets` فلا يوجد بند لربطها به. **قرار صريح من صاحب المشروع بالاحتفاظ بها دون حذف.** لا أثر
وظيفي (الفهرس الفريد يسمح بتكرار NULL). راجع `docs/CHANGELOG_TECHNICAL.md` (بند 2026-08-10) للتفاصيل.

**🎉 الخطة الخماسية اكتملت بكل خطواتها الخمس** (بعضها بنطاق مؤجَّل موثَّق أعلاه). البنود المتبقية التالية
كلها "دَين تقني" أو "نطاق مؤجَّل" مسجَّل صراحةً في هذا الملف، لا خطوات أساسية ناقصة من الخطة نفسها.

**ثابت معماري مؤكَّد صراحةً من صاحب المشروع (2026-08-08):** كل هذا يبقى **داخل بلاغ صيانة واحد موحَّد** —
رقم بلاغ واحد، مُبلّغ واحد، وإغلاق واحد لا يتم إلا باكتمال كل البنود. البنود مستقلة بالجهة/المسار/الشراء/
الصيانة الخارجية، لكنها لا تتحول أبدًا لعدة بلاغات منفصلة.

**بند سابق لا يزال مؤجَّلًا (من الخطوة 2):** شاشة تفاصيل البلاغ (`TicketDetail.tsx` — 1772 سطرًا، أكبر
شاشة بالنظام) تحتاج إعادة هيكلة لعرض بطاقة منفصلة لكل بند — **أخطر جزء وأكثره حاجة للاختبار**، يقع الآن
ضمن الخطوة 2 الجديدة أعلاه.
**بند سابق لا يزال مؤجَّلًا:** الإغلاق والتقارير — منع إغلاق البلاغ قبل اكتمال كل بنوده (مع `length > 0`
قبل أي `every()` — القاعدة #1)، ومراجعة التقارير التي تقرأ `tickets.maintenancePath` مباشرة. يقع ضمن
الخطوات 3-5 حسب الجزء المتأثر.
**التوثيق النهائي** بعد اكتمال الخطوات الخمس.

**تحذير على الوضع الحالي:** بعد الخطوة 1، **البلاغات الجديدة لا يُنشأ لها بند تلقائيًا** (الربط يأتي
بالخطوة 2). لا ضرر وظيفي — البلاغ الجديد يعمل من أعمدة `tickets` كالمعتاد — لكن إن طالت الفترة الفاصلة،
تُعالَج بإعادة تشغيل نفس ملف الترحيل
(`drizzle/migrations/2026_08_08_ticket_items_multi_task.sql`، وهو idempotent وآمن للتكرار).

**سبب التأجيل:** تسلسل متفق عليه صراحةً — تجربة كل خطوة قبل التالية، لتقليل الخطر على نظام يعمل فعليًا.
**الحالة:** ⏳ الخطوتان 1 و2 منجَزتان، الخطوات الخمس المُعاد صياغتها (أعلاه) لم تبدأ — الخطوة 1 منها
(إصلاح الصلاحيات) 🔴 عاجلة لأنها تحل ثغرة مؤكَّدة تمنع أي جهة ثانوية من فتح بلاغاتها.

---

### 2026-07-19 — مسار قديم (v1) مُعطَّل في الواجهة لكنه لا يزال مسجَّلًا في الخادم
**من طلبها:** صاحب المشروع
**الوصف:** `receiptsRouter` (v1) لا يزال مسجَّلًا فعليًا في `server/routers/index.ts` وقابلًا للاستدعاء
المباشر عبر API، رغم أن صفحته الأمامية (`WarehouseReceive.tsx`) مُوجَّهة لـ `NotFound`. الإصلاح الآمن الكامل
يتطلب حذف تسجيل الراوتر نهائيًا من الخادم (وليس فقط تعطيل الإجراء الخطر بداخله كما تم في الإصلاح #4 من
`docs/CHANGELOG_TECHNICAL.md`).
**سبب التأجيل:** طلب صاحب المشروع صراحةً تركها الآن، على أن يُذكِّر بها بنفسه لاحقًا متى ما قرر معالجتها.
(أُعيد تأكيد هذا القرار صراحةً بتاريخ 2026-07-28 أثناء مراجعة قائمة المعلَّقات.)
**الحالة:** ⏳ معلَّقة

---

### 2026-07-28 — migration رسمي يوثّق انحراف Schema سابق في `purchase_order_items`
**من طلبها:** صاحب المشروع
**الوصف:** تعديلات يدوية سابقة طُبِّقت مباشرة على قاعدة الإنتاج (خارج نظام الـmigrations) أضافت 3 قيم لـenum
`purchase_order_items.status` (`pending_review`, `needs_item_revision`, `purchase_cancelled`) و9 أعمدة متعلقة
بميزتي "مراجعة الصنف"/"إلغاء الشراء"، لم تكن موثّقة بـ`drizzle/schema.ts` ولا بأي ملف بمجلد `drizzle/migrations`.
تم تحديث `schema.ts` ليطابق الواقع الفعلي (بالسحب المباشر من القاعدة)، لكن **لم يُنشأ بعد ملف migration رسمي**
يوثّق "كيف" وصلت القاعدة لهذي الحالة من الحالة السابقة — يُوصى بتشغيل أداة توليد الفروقات ومراجعتها يدويًا.
**سبب التأجيل:** مستقل تمامًا عن موضوع الصلاحيات/الحارس المركزي، بانتظار توقيت مناسب من صاحب المشروع.
**الحالة:** ⏳ معلَّقة

---

### 2026-07-28 — عمودان يتيمان بجدول المشتريات
**من طلبها:** صاحب المشروع
**الوصف:** `purchase_order_items.reviewReason` (لا استخدام له بأي مكان بالكود) و
`procurementComments.purchaseOrderItemId` (عمود موجود لكن لا تُرسله أي دالة إنشاء تعليق حاليًا). يحتاجان قرارًا:
استخدام فعلي مستقبلي أم حذف.
**سبب التأجيل:** لا أثر وظيفي حاليًا، يحتاج فقط قرار عند التفرغ له.
**الحالة:** ⏳ معلَّقة

---

### 2026-07-28 — 12 اختبار فاشل مسبقًا في `server/tests/purchaseCycle.test.ts`
**من طلبها:** صاحب المشروع (اكتُشفت أثناء تشغيل خط الأساس قبل معالجة صلاحيات المشتريات)
**الوصف:** 12 اختبارًا فاشلة بسبب حقول input أصبحت مطلوبة لاحقًا بالـzod schema
(`receivedQuantity`, `supplierInvoiceNumber` بـ`confirmDeliveryToWarehouse`؛ `custodyAmount` إلزامي بـ
`approveAccounting`) لكن استدعاءات الاختبارات القديمة لم تُحدَّث لتزويدها. **لا علاقة لها بالصلاحيات إطلاقًا**
— تأكدنا أنها موجودة بنفس القائمة قبل وبعد معالجة صلاحيات `reject`/`getById`/`list` (صفر تغيير).
**سبب التأجيل:** خارج نطاق مرحلة معالجة صلاحيات طلبات الشراء صراحةً، بقرار صاحب المشروع.
**الحالة:** ⏳ معلَّقة

---

### 2026-07-28 — أخطاء أنواع (`tsc --noEmit`) سابقة على المشتريات
**من طلبها:** صاحب المشروع
**الوصف:** أخطاء `TS2367`/`TS7006` متعددة بـ`purchase-orders.router.ts`/`approvals.router.ts`، أغلبها ناتج
عن مقارنات بقيم enum لم تكن موجودة بـ`schema.ts` القديم (`needs_item_revision`, `purchase_cancelled` — جزئيًا
معالجة الآن بتحديث ملف الـSchema)، وبعضها `implicit any` عام غير متعلق بالصلاحيات. لم تنتج أي خطأ جديد عن
تعديلات هذي المرحلة (تحقّقنا صراحة عبر `tsc --noEmit`).
**سبب التأجيل:** خارج نطاق مرحلة الصلاحيات، ومرتبطة جزئيًا ببند migration الـSchema أعلاه.
**الحالة:** ⏳ معلَّقة

---

## ✅ مهام مُنجَزة (تاريخ كامل)

### 2026-08-22 — Main Phase 4 Settlement Development — ✅ أُغلقت في 2026-08-22
**الوصف:** إكمال Step 1 Database Foundation + Step 2 Settlement Valuation/Posting + Step 3 UI/Runtime UAT/Closure ضمن النطاق المصغّر المعتمد.

**كيف نُفِّذت:** Count Settlement تستخدم Opening `averageCostSnapshot` وتخزن `unitCostUsed`/`adjustmentValue` وتحدّث quantity/value/average cost داخل Transaction. Runtime UAT نجح على `CNT-2026-60030`/`ADJ-2026-30008` (Surplus + تغير Current Average Cost)، و`CNT-2026-60031`/`ADJ-2026-30009` (Shortage)، و`CNT-2026-60032` (forced rollback ثم `ADJ-2026-30011` بعد إزالة failpoint). Manual Aggregate Settlement guard بقي فعالًا مع Lots.

**الحالة:** ✅ **MAIN PHASE 4 COMPLETE / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**

**المرجع:** `docs/CMMS_PHASE4_SETTLEMENT_FINAL_CLOSURE_2026-08-22.md`.


### 2026-08-20 — Main Phase 3 / Step 3 Settlement Cut-off Runtime UAT — ✅ أُنجزت في 2026-08-20
**الوصف:** إكمال Runtime UAT النهائي للـLot freeze والتسوية ثم فك التجميد وإغلاق Main Phase 3.

**كيف نُفِّذت:** على `CNT-2026-60028` تم رفض الصرف من `Lot 10` قبل Settlement، ثم تطبيق `ADJ-2026-30006` بفرق `+1` (`2→3`) مع تطابق Inventory ومجموع Lots=`4`; بعد التسوية نجح `DLV-2026-300182` من نفس Lot، ثم بقي `inventory.quantity=SUM(lot balances)=3`.

**الحالة:** ✅ **MAIN PHASE 3 COMPLETE / RUNTIME UAT PASSED / CLOSED.**

**المرجع:** `docs/CMMS_PHASE3_INVENTORY_COUNT_FINAL_CLOSURE_2026-08-20.md`.


<!--
القالب عند نقل بند من "معلَّقة" إلى هنا:
### [تاريخ الإضافة] — [عنوان مختصر] — ✅ أُنجزت في [تاريخ الإنجاز]
**الوصف:**
**كيف نُفِّذت:** (ملخص سطر أو سطرين، والتفاصيل الكاملة في CHANGELOG_TECHNICAL.md إن وُجدت)
-->

### 2026-07-19 — أي من زرّي تصدير PDF في تفاصيل طلب الشراء يجب إخفاؤه؟ — ✅ أُنجزت في 2026-07-19
**الوصف:** كان يوجد زرّان لتصدير PDF (عام أعلى الصفحة، وآخر لكل دفعة تسعير). تأكد عبر الحوار أن كل تسعير
(جزئي أو كامل) يمر عبر آلية الدفعات نفسها (`submitPricedBatch`)، وأن زر الدفعة محمي بالفعل من الأصناف
الملغاة/غير المُسعَّرة/قيد المراجعة — فلا حاجة للزر العام في أي سيناريو.
**كيف نُفِّذت:** حُذف الزر العام (`handleExportPdf`) بالكامل مع حالته (`exportingPdf`) من
`client/src/pages/purchase/PurchaseOrderDetail.tsx`. التفاصيل الكاملة في `docs/CHANGELOG_TECHNICAL.md`.

### 2026-07-28 — `useTranslatedField.ts`/`useContentTranslation.ts` بالواجهة الأمامية تستخدمان اصطلاح تسمية قديم — ✅ أُنجزت في 2026-07-28
**الوصف:** بعد مزامنة `drizzle/schema.ts` مع قاعدة الإنتاج، أصبحت استجابات الـAPI تحمل الحقول المترجَمة
بصيغة camelCase (`itemNameAr`) بدل الصيغة القديمة بشرطة سفلية (`itemName_ar`). دالتان مركزيتان بالواجهة
(`useTranslatedField.ts` تُستخدم بـ14 ملفًا، و`useContentTranslation.ts` تُستخدم بـ13 ملفًا — بينها
`PurchaseOrderDetail.tsx` و`PurchaseOrders.tsx`) كانتا لسه تبنيان الاسم القديم، فيسقط كل نص مترجَم بالواجهة
دائمًا للنص الأصلي غير المترجَم، بصمت.
**كيف نُفِّذت:** تحديث بناء اسم المفتاح بالدالتين ليطابق camelCase، + إصلاح موضع واحد بـ`PMPlansPanel.tsx`
كان يبني كائنًا محليًا بمفاتيح قديمة قبل تمريره لـ`getField`. تحقّقنا أن حالتين أخريين مشابهتين بالشكل
(صفحتا استلام المخزون، وقائمة `PurchaseCycle.tsx`) غير متأثرتين فعليًا (الأولى تطابق عقد الـAPI الثابت،
والثانية تُغذَّى من استعلام SQL خام لم يتأثر بإعادة التسمية). التفاصيل الكاملة في `docs/CHANGELOG_TECHNICAL.md`.

### 2026-07-28 — ترحيل `approveAccounting`/`approveManagement` للحارس المركزي — ✅ أُنجزت في 2026-07-28
**الوصف:** كان الإجراءان يعتمدان فقط على فحص الدور، بدون أي تحقق من مرحلة الطلب — يسمح باعتماد طلب تجاوز
مرحلته من زمان. صاحب المشروع اختار إصلاحها فعليًا.
**كيف نُفِّذت:** إضافة `assertCanPerformPOAction` لكلا الإجراءين (يشترط الآن `pending_accounting`/
`pending_management` بالضبط)، مع تصحيح 3 اختبارات كانت تعتمد على بيانات حالة غير واقعية. **هذا أكمل
ترحيل الحارس المركزي بالكامل: 15/15 إجراءً.** التفاصيل الكاملة في `docs/CHANGELOG_TECHNICAL.md`.

### 2026-07-28 — `tickets.getById` بلا أي تحقق ملكية — ✅ أُنجزت في 2026-07-28
**الوصف:** `getById` بوحدة البلاغات كانت `protectedProcedure` عارية بلا أي فحص — أي مستخدم مسجّل دخول يقرأ
أي بلاغ برقمه، رغم أن `list`/`listPaginated`/`inboxCounts` تُقيّد النطاق فعليًا (operator ← بلاغاته،
technician ← المسنَد له). **نفس فجوة "القائمة مقيّدة والتفاصيل مفتوحة"** المكتشَفة سابقًا بطلبات الشراء.
**كيف نُفِّذت:** ملف جديد `server/routers/tickets/tickets.access.ts` يحمل قاعدة الرؤية بمصدر واحد، يطابق
نطاق `list()` **حرفيًا** (بلا تشديد ولا توسيع). أُضيف قبول `assignedTechnicianId` كذلك لأن بعض مسارات
الإسناد تكتب فيه، فمنعه كان سيحجب عن الفني بلاغًا مسنَدًا له فعليًا. **وتبعًا لذلك** شُدِّدت مرفقات البلاغات
أيضًا (كانت متساهلة عمدًا بمبرر "وحدة التذاكر نفسها مفتوحة" — مبرر لم يعد قائمًا). 14 اختبارًا جديدًا.
التفاصيل الكاملة في `docs/CHANGELOG_TECHNICAL.md`.

### 2026-07-28 — ثغرة IDOR في `attachments.list`/`attachments.add` — ✅ أُنجزت في 2026-07-28
**الوصف:** `entityType`/`entityId` كانا قيمًا حرة بلا أي تحقق من علاقة المستخدم بالكيان.
**كيف نُفِّذت:** ملف جديد `attachments.access.ts` فيه قائمة سماح صريحة لأنواع الكيانات (Default Deny) +
فحص ملكية لكل نوع يطابق قواعد وحدته الأصلية حرفيًا. الثغرة الحقيقية كانت بـ`improvement_idea` (وحدته تفرض
فعليًا قيدًا، فكان تجاوزه عبر المرفقات خرقًا حقيقيًا) — أُغلقت. `ticket`/`catalog_item` تُركا متساهلين عمدًا
لأن وحدتيهما نفسيهما بلا قيود (راجع البند المعلَّق أعلاه). **اكتُشف وأُصلح أيضًا خطأ منفصل بـ`.gitignore`**:
قاعدة `uploads/` كانت تستثني بالخطأ مجلد الكود المصدري `server/routers/uploads/` بالكامل من Git.
8 اختبارات جديدة. التفاصيل الكاملة في `docs/CHANGELOG_TECHNICAL.md`.

---

### 2026-08-10 — خطة المرحلة السادسة: إكمال دورة التنفيذ والإغلاق على مستوى البند
**من طلبها:** صاحب المشروع (بعد مراجعة شاملة لما ينقص ميزة البلاغ متعدد الجهات)
**الحالة:** ✅ **نُفِّذت (2026-08-10)** — بانتظار اختبار صاحب المشروع.
**القرار المعتمد:** الخيار الأصرم — كل بند يُعتمَد ويُغلق مستقلًا، والبلاغ لا يُغلق إلا باكتمالها جميعًا.
**ما نُفِّذ:** `areAllTicketItemsComplete`/`isTicketItemComplete`/`getIncompleteTicketItems`
(`shared/ticketUiRules.ts`) + `assertAllTicketItemsClosed` مُستدعاة في `close` و`closeBySupervisor`
(`tickets.closure.ts`) + ثلاثة إجراءات جديدة `startRepairForItem`/`completeRepairForItem`/`closeTicketItem`
(`tickets.approvals.ts`) + أزرار التنفيذ داخل بطاقة كل بند (`TicketDetail.tsx`). راجع
`docs/CHANGELOG_TECHNICAL.md` (بند تنفيذ المرحلة 6).
✅ **مُعالَج (2026-08-10)**: `assertPathBMaterialsDeliveredToTechnicianForItem` (نظير جديد بمستوى البند)
مُستدعاة الآن من `startRepairForItem`. راجع `docs/CHANGELOG_TECHNICAL.md` (بند المتابعة 2026-08-10).

#### السياق: أين توقّفنا بالضبط

الخطة الخماسية (2026-08-08) أوصلت البلاغ متعدد البنود حتى **"البند جاهز للتنفيذ"**: الفرز المتعدد ✅،
الصلاحيات ✅، العرض ✅، اختيار المسار لكل بند ✅، طلب شراء لكل بند ✅. **لكن النصف الثاني من الرحلة —
من "جاهز للتنفيذ" حتى "مغلق" — لا يزال يعمل على مستوى البلاغ العام حصريًا.**

#### الفجوات المؤكَّدة بتتبّع الكود (لا افتراض)

| # | الإجراء | الملف والسطر | ما يفحصه اليوم |
|---|---|---|---|
| 1 | `startRepair` | `tickets.approvals.ts:148` | `ticket.status` + `ticket.maintenancePath` |
| 2 | `completeRepair` | `tickets.approvals.ts:175` | نفسه، ويكتب على `tickets.repairNotes/afterPhotoUrl/materialsUsed` |
| 3 | `markReadyForClosure` (مسار A) | `tickets.closure.ts:82` | نفسه |
| 4 | `close` | `tickets.closure.ts:43` | نفسه — **بلا أي فحص لاكتمال البنود** |
| 5 | `closeBySupervisor` | `tickets.closure.ts:118` | نفسه |

**الأثر العملي المؤكَّد:** يمكن اليوم إغلاق بلاغ متعدد البنود بينما بند الإنشاءات فيه لم يبدأ أصلًا —
مخالفة مباشرة للمبدأ المتفق عليه صراحةً: "البلاغ لا يُغلق إلا باكتمال كل بنوده".

#### الخطة المقترحة — 3 أجزاء متتابعة، بنفس أنماط الخطوات السابقة

**الجزء 1 — تنفيذ الإصلاح لكل بند (`startRepairForItem`, `completeRepairForItem`)**
- إجراءان جديدان بجانب القائمين (لا تعديلهما — نفس نمط `approveWorkForItem` بالخطوة 3).
- الصلاحية عبر `assertTicketItemWorkflowManageable` (موجودة من الخطوة 3) + فحص كون المستخدم فني البند.
- الشروط تُفحص على `item.status`/`item.maintenancePath` بدل البلاغ، وتُعاد صياغة `canStartTicketRepair`
  و`canSubmitStandardRepair` (`shared/ticketUiRules.ts`) لتقبل بندًا — **دوال نقية، تعديلها منخفض الخطر**.
- ⚠️ `assertPathBMaterialsDeliveredToTechnician` (مسار B) تفحص تسليم المواد على مستوى البلاغ — **تحتاج
  تعميمًا لمستوى البند** (نقطة موثَّقة سابقًا كنطاق مؤجَّل بالخطوة 4).
- ⚠️ مسار C يستدعي `getExternalMaintenanceJobByTicketId` — يُستبدل بـ`...ByTicketItemId` (موجودة من
  الخطوة 5).
- توافق رجعي: البند الأول (`itemNumber === 1`) يعكس تحديثه على أعمدة البلاغ — نفس مبدأ الخطوتين 3 و4.

**الجزء 2 — الإغلاق المشروط باكتمال كل البنود**
- دالة مشتركة جديدة بـ`shared/` (لا تكرار خادم/واجهة): `areAllTicketItemsComplete(items)`.
- ⚠️ **قاعدة #1 بـCLAUDE.md إلزامية هنا**: `items.length > 0 &&` **قبل** أي `every()` — مصفوفة فارغة
  ترجع `true` من `every` فتسمح بإغلاق بلاغ بلا بنود.
- تُستدعى في `close`, `closeBySupervisor`, و`markReadyForClosure` — **مع الإبقاء على كل الفحوصات القائمة
  كما هي** (الفحص الجديد يُضاف، لا يستبدل).
- توافق رجعي كامل: بلاغ ببند واحد → الفحص الجديد يمر تلقائيًا متى مرّ الفحص القديم (البند مطابق للبلاغ).

**الجزء 3 — الواجهة**
- أزرار "بدء الإصلاح"/"إكمال الإصلاح" تنتقل لبطاقة كل بند بشاشة تفاصيل البلاغ (للبلاغات متعددة البنود
  فقط — البلاغ أحادي البند يبقى بأزراره الحالية حرفيًا، نفس نمط الخطوة 3).
- رسالة واضحة عند منع الإغلاق تُبيّن **أي بند** لم يكتمل تحديدًا.

#### مخاطر وEdge Cases يجب الانتباه لها

1. **`length > 0` قبل كل `every()`** — أخطر فخ بهذه المرحلة (تكرار للإصلاح #1 الموثَّق بالمشروع).
2. **`ticket_items.status` يستخدم الحالات الـ21 نفسها** — تعريف "مكتمل" يجب أن يشمل `closed`,
   `verified`, `requester_confirmed` (وقرار صريح مطلوب: هل `ready_for_closure` تُعدّ اكتمالًا؟).
3. **بلاغات ما قبل الميزة** لها بند واحد مُرحَّل مطابق — يجب التأكد ألا ينكسر إغلاقها إطلاقًا.
4. **`tickets.status` يبقى "ملخصًا"** — لا يُحذف ولا يُهجر (القاعدة الحرجة #11).
5. **تعارض محتمل**: إن أغلق البند الأول بينما بند آخر نشط، لا يُعكس "مغلق" على البلاغ إلا بعد اكتمال
   الجميع — منطق العكس (`itemNumber === 1`) يحتاج استثناءً صريحًا للإغلاق تحديدًا.

#### ما يُنجَز لاحقًا (خارج هذه المرحلة)
دورة حياة الصيانة الخارجية الكاملة، التقارير الـ9 التي تقرأ `tickets.maintenancePath`، مستند PDF،
والترجمة — كلها مسجَّلة كبنود مستقلة بهذا الملف.

---

## مؤجَّل (2026-08-12) — قيود ما بعد إغلاق البلاغ الرئيسي، وتوحيد مسار رفع الملفات

مرتبط ببندي `docs/CHANGELOG_TECHNICAL.md` بتاريخ 2026-08-12.

### 1. تقييد البلاغات الفرعية بعد إغلاق الأب
حاليًا: إغلاق الرأس يجمّد `ticket_departments`/`ticket_tasks` فقط
(`tickets.workflow.ts::assertDepartmentPlanEditable`). البلاغ الفرعي نفسه يبقى قابلًا للتعديل بالكامل
لأن دورة حياته مستقلة بمساره A/B/C وحراسه الخاصة.
- **سبب التأجيل:** أي قيد هنا يمس مسارات الصيانة الثلاثة كلها لا الهيكل الجديد وحده — نطاق أوسع بكثير.
- **قرار مطلوب قبل التنفيذ:** هل يُمنع تعديل الابن بعد إغلاق أبيه أصلًا؟ أم يُمنع الإغلاق ما دام أي ابن
  قابلًا للتعديل؟ الحالة الحالية (أب مغلق + ابن قابل للتعديل) متسقة منطقيًا لأن الإغلاق يشترط أن كل
  الأبناء منتهون فعلًا.

### 2. لا يوجد إجراء "إعادة فتح" للبلاغ الرئيسي
الإغلاق نهائي؛ استئناف العمل يكون ببلاغ جديد. إن أُريدت إعادة الفتح لاحقًا فتحتاج قرارًا صريحًا
(من يملكها؟ وماذا يحدث للجهات/المهام التي أصبحت `completed`؟).

### 3. توحيد رفع الملفات على مسار واحد
`ExternalMaintenanceWarehouseTab.tsx` وصفحات `DropZone` لا تزال ترفع عبر `/api/upload` مباشرة، بينما
`useOfflineUpload` يوفّر presigned URL + طابور offline + fallback. التوحيد يلغي ازدواج منطق الضغط
ومعالجة الأخطاء، لكنه يمس صفحات كثيرة دفعة واحدة — لذلك أُجّل بعد إصلاح 2026-08-12 الذي عالج التذبذب
دون تغيير المعمارية.

### Main Phase 5 / 5.2 Recipient → Warehouse checkpoint — 2026-08-22

- وافق صاحب المشروع صراحة على سياسة: **Same Original Lot + Original Issue Cost + Original Issue Link + Partial/Over-return Guards + Atomic Posting**.
- Live DB inspection أثبت أن `delivery_documents` يحمل `inventoryId + lotId + inventoryTransactionId` بينما `warehouse_returns` لم يكن يملك مرجعًا مباشرًا لسند الصرف.
- المحاولة الأولى لإضافة العمود+الفهرس معًا فشلت ولم تترك عمودًا جزئيًا؛ تم التحقق من ذلك قبل أي إعادة تنفيذ.
- أضيف يدويًا إلى Live DB: `warehouse_returns.sourceDeliveryDocumentId INT NULL` ثم تم التحقق منه، وبعدها أضيف `idx_warehouse_returns_source_delivery(sourceDeliveryDocumentId)` بأمر مستقل.
- لا FK/UNIQUE/Backfill/Legacy cleanup، والسجلات القديمة وSupplier Returns تبقى `sourceDeliveryDocumentId = NULL`.
- `drizzle/schema.ts` تمت مزامنته مع الإضافة المؤكدة في Live DB؛ لا migration SQL داخل الحزمة حتى لا يعاد تنفيذ التغيير الذي طُبق يدويًا.
- Recipient Return الجديد يبدأ من رقم سند الصرف الأصلي، ويتحقق من ربط Delivery→Inventory/Lot/Movement، ويرفض السندات القديمة غير المرتبطة بدل تخمين/Backfill التاريخ.
- التقييم المالي = **Original Issue Movement Cost**، وليس Current Average Cost.
- partial/over-return guard يحسب مجموع المرتجعات السابقة لنفس `sourceDeliveryDocumentId`، مع قفل سند الصرف `FOR UPDATE` لمنع تجاوز متزامن.
- الترحيل الذري يزيد نفس original Lot balance + `inventory_lots.remainingQuantity` + Inventory quantity/value، ويعيد حساب Average Cost، ثم يسجل Return header + `in/return` movement + Return document داخل نفس Transaction.
- UI/Return list/print تعرض مرجع سند الصرف الأصلي للمرتجع من الجهة.
- **Recipient → Warehouse = IMPLEMENTED / TARGETED CHECKS PASSED / RUNTIME UAT PASSED**.
- **5.2 = ✅ COMPLETE / TARGETED CHECKS PASSED / RUNTIME UAT PASSED / OFFICIALLY CLOSED**. هذا كان حاجز التوقف التاريخي قبل أن يبدأ 5.3 لاحقًا بموافقة صريحة.
- المراجع: `docs/CMMS_PHASE5_STEP2_RETURNS_IMPLEMENTATION_2026-08-22.md` + `docs/CMMS_PHASE5_STEP2_RECIPIENT_RETURN_IMPLEMENTATION_2026-08-22.md`.


### Main Phase 5 / 5.3 Receipt-Issue-Transfer checkpoint — 2026-08-23

- بدأ **5.3** بموافقة صريحة من صاحب المشروع بعد إغلاق 5.2 رسميًا.
- Receipt hardening: إزالة `warehouseId = 1` الثابت من submit paths الحالية ومن backend fallback؛ الخادم يحل Warehouse الصريح/Inventory warehouse ثم single active Main warehouse ديناميكيًا، ويرفض الغموض بدل اختيار رقم ثابت.
- Receipt existing-Inventory valuation أصبح يقرأ الكمية/التكلفة بعد `FOR UPDATE`; مسار invoice-draft legacy حصل على نفس Main-warehouse resolution والقفل بدون Backfill.
- Delivery: Aggregate Inventory lock قبل قراءة availability/averageCost مع إبقاء Lot/QR + DLV + movement ضمن Transaction الحالية.
- Transfer: source + existing destination Inventory locks في Lot/legacy paths؛ حركتا `transfer` تحملان نفس `documentUrl = TRF-...`.
- Transfer batch mixed-success behavior بقي كما هو؛ تحويله إلى all-or-nothing يحتاج Workflow approval منفصل.
- **Document numbering:** تم الاحتفاظ بآليات الترقيم الحالية. لم يتم إنشاء `receipt_number_counter`. Live DB check: max RCV sequence `420148`, duplicate receipt-number groups `0`, counter table absent.
- تم توثيق بند مؤجل مستقل: **Centralized Document Numbering Service / Engine** في `docs/CMMS_CENTRALIZED_DOCUMENT_NUMBERING_DEFERRED_2026-08-23.md`. لا يُنفذ تلقائيًا، ولا Historical Renumbering/Backfill، ولا gapless guarantee بدون موافقة مستقلة.
- لا SQL/Migration/Backfill/Cleanup ضمن 5.3 implementation package الحالي.
- **5.3 = ✅ COMPLETE / TARGETED CHECKS PASSED / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- مرجع التنفيذ: `docs/CMMS_PHASE5_STEP3_RECEIPT_ISSUE_TRANSFER_IMPLEMENTATION_2026-08-23.md`.


### Main Phase 5 / 5.3 Runtime UAT & Official Closure — 2026-08-23

- **5.3 Receipt / Issue / Warehouse Transfer Review = ✅ COMPLETE / TARGETED CHECKS PASSED / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- Receipt `RCV-2026-420150` = PASS: two fresh items posted to `WH-MAIN`; each had quantity `5.000 @ 10.0000`, Inventory/Lot/SUM Lots `5.000`, Total Value `50.00`, and `in/purchase` movement.
- Delivery `DLV-2026-300213` = PASS: Lot `LOT-2026-224A39C8` decremented from `5` to `4`; Inventory/SUM Lots `4`; Total Value `40.00`; movement `out/delivery 1 @ 10 = 10`.
- Transfer `TRB-2026-030005` / `TRF-2026-030005` = PASS: `1` unit moved from `WH-MAIN` to `SUB-1`; source Lot/Inventory `3`, destination `1`, company-wide Lot remaining/total balances `4`, source/destination values `30/10`, paired transfer movements verified.
- Transfer over-quantity guard = PASS: attempt `4` with source balance `3` rejected with `الكمية أكبر من الرصيد المتاح (3 قطعة)`.
- Existing numbering mechanisms retained. **Centralized Document Numbering Service / Engine remains DOCUMENTED / DEFERRED**; no `receipt_number_counter`, renumbering, backfill, gapless policy or prefix change was introduced.
- Accepted non-blocking limits: legacy/non-Lot and invoice-draft variants not separately Runtime-exercised; one-item transfer batch used; mixed-success batch semantics preserved without redesign; UI over-quantity evidence was not a backend-bypass failpoint test.
- No Historical Backfill, Legacy Cleanup, In-Transit, destination approval, batch all-or-nothing workflow redesign, broad FK/UNIQUE rollout, or unrelated Accounting change.
- Closure reference: `docs/CMMS_PHASE5_STEP3_RECEIPT_ISSUE_TRANSFER_RUNTIME_UAT_CLOSURE_2026-08-23.md`.
- **Historical stop immediately after 5.3 closure:** Main Phase 5 = IN PROGRESS; 5.1/5.2/5.3 = CLOSED; 5.4 was NOT STARTED at that point. 5.4 was later started by explicit owner instruction on 2026-08-23; see the 5.4.1 checkpoint below.

### Main Phase 5 / 5.4.1 Inventory Integrity Rules — Official Closure — 2026-08-23

- بدأ 5.4 بموافقة صريحة من صاحب المشروع، مع اعتماد أربع خطوات فقط: 5.4.1 Rules → 5.4.2 Read-only Engine → 5.4.3 Exception Report → 5.4.4 Runtime UAT & Closure.
- صاحب المشروع حسم أن البيانات القديمة/التجريبية **تبقى كما هي ولا تُلمس**؛ التركيز على المستقبل فقط. لا Baseline table ولا Historical Ledger Reconstruction ضمن 5.4.
- Live DB structure was inspected read-only; actual relation is through `inventory_lot_balances(lotId, inventoryId)`, and Live DB remains authoritative over project Schema.
- Rules approved: Inventory Qty ↔ Lot balances; global Lot remaining ↔ distributed balances; no negative Inventory/Lot quantities; current value consistency with rounding tolerance; Lot Balance reference/warehouse integrity.
- Live DB evidence: `quantityLotMismatches=0`; `lotBalanceMismatches=0`; negative Inventory/Lot/remaining rows=`0`; orphan/warehouse/duplicate-lot integrity exceptions=`0`.
- Two existing value mismatches were observed on old experimental Inventory rows (`180001`, `167`) and deliberately left untouched. They are not a Backfill/Revaluation task and are not blockers for the future-facing rules.
- No Code/SQL write/Migration/Schema change/Backfill/Cleanup/Revaluation/Numbering/Workflow/Accounting behavior change occurred in 5.4.1.
- **5.4.1 = ✅ COMPLETE / LIVE DB READ-ONLY DISCOVERY PASSED / RULES APPROVED / OFFICIALLY CLOSED.**
- **Historical stop at 5.4.1 closure:** Main Phase 5 = IN PROGRESS; 5.4 = IN PROGRESS; 5.4.2 was NOT STARTED then. This checkpoint is superseded by the 5.4.2 implementation entry below.
- References: `docs/CMMS_PHASE5_STEP4_INVENTORY_RECONCILIATION_APPROVED_SCOPE_2026-08-23.md` + `docs/CMMS_PHASE5_STEP4_1_INVENTORY_INTEGRITY_RULES_CLOSURE_2026-08-23.md`.

### Deferred — Centralized Document Numbering Service / Engine

- **Status:** DOCUMENTED / DEFERRED.
- الهدف: توحيد allocation policy لاحقًا لكل document families بدل إضافة حلول جزئية لكل Prefix.
- المطلوب قبل التنفيذ: inventory كامل من then-latest code + Live DB لكل Prefix/Generator/Counter/transaction boundary.
- لا إعادة ترقيم تاريخي، لا Backfill، ولا تغيير formats/prefixes/gap policy بدون موافقة صريحة.
- المرجع: `docs/CMMS_CENTRALIZED_DOCUMENT_NUMBERING_DEFERRED_2026-08-23.md`.


### Main Phase 5 / 5.4.2 Read-only Reconciliation Engine — Implementation checkpoint — 2026-08-23

- Owner explicitly started 5.4.2 after official closure of 5.4.1.
- Added a pure evaluator for all five approved integrity rules plus a SELECT-only DB adapter and query-only `inventoryReconciliation.run` endpoint.
- No repair mutation exists. Historical/experimental non-Lot rows remain outside Inventory quantity/value failure scope.
- No SQL/Migration/Schema/Data write, Historical Reconstruction, Backfill/Cleanup/Revaluation, Centralized Numbering, Batch Transfer redesign, Workflow or Accounting change.
- Targeted syntax/transpile + pure evaluator functional harness + read-only source scan = PASS. Full Vitest/full typecheck is not claimed from the uploaded workspace because `node_modules` is absent.
- Owner confirmed extraction of the 5.4.2 package and server restart.
- Deployed engine was run directly against Live DB: `readOnly=true`; `historicalReconstructionIncluded=false`; `autoFixIncluded=false`; Inventory=`698`, tracked Inventory=`5`, non-Lot/out-of-scope=`693`, Lots=`4`, Lot Balance rows=`5`; checks=`53`, passed=`53`, exceptions=`0`.
- **5.4.2 = ✅ COMPLETE / TARGETED CHECKS PASSED / LIVE DB RUNTIME VERIFICATION PASSED / OFFICIALLY CLOSED.**
- **Current stop:** after 5.4.2 closure and before 5.4.3. Do not start 5.4.3 without explicit owner instruction.
- References: `docs/CMMS_PHASE5_STEP4_2_READ_ONLY_RECONCILIATION_ENGINE_IMPLEMENTATION_2026-08-23.md` + `docs/CMMS_PHASE5_STEP4_2_READ_ONLY_RECONCILIATION_ENGINE_CLOSURE_2026-08-23.md`.


### Main Phase 5 / 5.4.3 Reconciliation Exception Report — Official Closure — 2026-08-23

- Owner explicitly started 5.4.3 after 5.4.2 official closure.
- Added read-only **تقرير مطابقة المخزون** UI over the existing query-only `inventoryReconciliation.run` engine; no duplicated reconciliation logic and no mutation/repair endpoint.
- Runtime UI verification after owner extraction/restart matched the deployed engine: total checks=`53`, passed=`53`, exceptions=`0`; tracked Inventory=`5`, total Inventory=`698`, outside Lot-tracked scope=`693`, Lots=`4`, Lot Balance rows=`5`.
- Search, warehouse filter, exception-type filter, manual refresh, summary cards, scope cards and zero-exception state were visibly present.
- Added a one-page Arabic PDF **دليل تقرير مطابقة المخزون** explaining the practical benefit of the screen and its own terminology (`إجمالي الفحوص`, `فحوص ناجحة`, `الاستثناءات`, `نطاق الفحص`, `Inventory ضمن Lot Tracking`, `Lots`, `Lot Balances`, `تحديث الفحص`). Owner confirmed the download button works at Runtime.
- No Exception was deliberately injected into Live DB solely to test an exception row/filter. This is an accepted verification limit; no production/experimental data was corrupted for UAT.
- No SQL/Migration/Schema/Data write, Auto-fix, Historical Backfill/Cleanup/Revaluation, Centralized Numbering, Workflow/Accounting change, or Batch Transfer semantic change.
- **5.4.3 = ✅ IMPLEMENTED / TARGETED CHECKS PASSED / RUNTIME UI VERIFICATION PASSED / OFFICIALLY CLOSED.**
- **Historical stop at 5.4.3 closure:** before 5.4.4; later superseded by explicit owner start and successful 5.4.4 Runtime UAT.
- References: `docs/CMMS_PHASE5_STEP4_3_RECONCILIATION_EXCEPTION_REPORT_IMPLEMENTATION_2026-08-23.md` + `docs/CMMS_PHASE5_STEP4_3_RECONCILIATION_EXCEPTION_REPORT_CLOSURE_2026-08-23.md`.

### Main Phase 5 / 5.4.4 Runtime UAT & Closure — Approved Plan — 2026-08-23

- Owner approved the 5.4.4 design after official closure of 5.4.3.
- 5.4.4 is the final deployed Runtime UAT and closure gate for Inventory Reconciliation; it does not add a new reconciliation feature.
- Use only new supported inventory movements for UAT; do not reconstruct or repair old/experimental history.
- Re-run **تقرير مطابقة المخزون** after material movements and confirm the five approved 5.4.1 integrity rules remain satisfied.
- Do not corrupt Live DB merely to manufacture an exception; targeted evaluator/source tests may evidence exception-generation behavior.
- No Auto-fix, Historical Cleanup/Backfill/Revaluation, Centralized Numbering, Batch Transfer semantic change, Workflow/Accounting redesign, or Production Cutover is part of 5.4.4.
- **Historical plan status:** 5.4.1 = CLOSED; 5.4.2 = CLOSED; 5.4.3 = CLOSED; 5.4.4 = **SCOPE APPROVED / DOCUMENTED — NOT STARTED**; Main Phase 5.4 = IN PROGRESS.
- This checkpoint is superseded by the closure entry below: 5.4.4 Runtime UAT later passed and Main Phase 5.4/Main Phase 5 were officially closed.
- Reference: `docs/CMMS_PHASE5_STEP4_4_RUNTIME_UAT_AND_CLOSURE_APPROVED_PLAN_2026-08-23.md`.

### Main Phase 5 / 5.4.4 Runtime UAT + Main Phase 5.4 / Main Phase 5 Official Closure — 2026-08-23

- Owner explicitly started 5.4.4 after 5.4.3 official closure and approved the representative future-only Runtime UAT sequence.
- Pre-UAT **تقرير مطابقة المخزون** baseline: checks=`53`, passed=`53`, exceptions=`0`; tracked Inventory=`5`, total Inventory=`702`, outside scope=`697`, Lots=`4`, Lot Balances=`5`.
- Fresh Receipt UAT: `PR-2026-0397` → `RCV-2026-420151`; two new Lot-aware items were confirmed. Reconciliation after receipt: checks=`75`, passed=`75`, exceptions=`0`; tracked Inventory=`7`, total Inventory=`704`, Lots=`6`, Lot Balances=`7`.
- Fresh Delivery UAT: `DLV-2026-300215`; reconciliation after delivery: checks=`75`, passed=`75`, exceptions=`0`; tracked Inventory=`7`, total Inventory=`705`, Lots=`6`, Lot Balances=`7`.
- Fresh Warehouse Transfer UAT: `TRB-2026-030006` (1 item); reconciliation after transfer: checks=`84`, passed=`84`, exceptions=`0`; tracked Inventory=`8`, total Inventory=`706`, Lots=`6`, Lot Balances=`8`.
- No mismatch was deliberately injected into Live DB. Existing evaluator/source checks remain the accepted evidence for exception-generation behavior; Runtime UAT proves normal supported future movements preserve reconciliation PASS.
- No Auto-fix, Historical Cleanup/Backfill/Revaluation, Legacy repair, Centralized Numbering/`receipt_number_counter`, historical renumbering, Batch Transfer all-or-nothing redesign, Workflow/Accounting redesign, or Production Cutover was performed or approved.
- **5.4.4 = ✅ COMPLETE / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- **Main Phase 5.4 — Inventory Reconciliation = ✅ COMPLETE / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- With 5.1 / 5.2 / 5.3 already officially closed and no other approved Main Phase 5 scope open, **Main Phase 5 = ✅ COMPLETE / OFFICIALLY CLOSED.**
- **Current stop:** after Main Phase 5 official closure and before Main Phase 6 — Inventory / Accounting Reports. Main Phase 6 remains NOT STARTED and must not start automatically.
- References: `docs/CMMS_PHASE5_STEP4_4_RUNTIME_UAT_CLOSURE_2026-08-23.md` + `docs/CMMS_MAIN_PHASE5_FINAL_CLOSURE_2026-08-23.md`.



### Main Phase 6 — Inventory / Accounting Reports — Approved Scope / Pre-implementation checkpoint — 2026-08-23

- بعد الإغلاق الرسمي لـMain Phase 5، وافق صاحب المشروع على تصميم Main Phase 6 كتقارير مخزنية/محاسبية ضمن **مركز تقارير مخزنية موحد** بدل تشتيت التقارير على صفحات منفصلة كثيرة.
- **Main Phase 6 = SCOPE APPROVED / DOCUMENTED — IMPLEMENTATION NOT STARTED.**
- التقسيم المعتمد: `6.1 Reports Foundation & Unified Reports Center` → `6.2 Stock Balance & Movement Reports` → `6.3 Inventory Valuation & Accounting Reports` → `6.4 Inventory Analytics & Planning Reports` → `6.5 Runtime UAT & Closure`.
- قرار أولوية صريح: **6.4 التحليل والتخطيط منخفضة الأولوية وتنفذ في الأخير، بعد إنجاز واعتماد 6.1–6.3؛ لا تبدأ الآن.**
- عند الوصول إلى 6.4 لاحقًا، الاتجاه المعتمد صفحة واحدة **تحليل المخزون** مع Tabs: الحركة البطيئة / المخزون الراكد / ABC / الأعمار / معدل الدوران، وليس خمس صفحات Top-level مشتتة.
- 6.2 يجمع Stock Balance / Stock Card / Transactions ومشاهد Receipt/Issue/Return/Transfer/Disposal/Adjustments عبر بنية حركة موحدة وفلاتر مشتركة حيث يناسب.
- 6.3 يجمع Inventory Valuation + Value by Warehouse + Value by Category + Inventory Variance بدون تغيير قواعد Accounting/Posting الحالية.
- 5.4 Reconciliation يبقى مستقلًا؛ لا تكرار للمحرك ولا Auto-fix داخل التقارير.
- لا Historical Backfill/Legacy Cleanup/Revaluation، ولا Centralized Numbering، ولا Batch Transfer redesign، ولا Workflow/Accounting redesign، ولا Production Cutover ضمن اعتماد هذا النطاق.
- **Current stop: before 6.1. Do not start Main Phase 6 implementation automatically.**
- المرجع: `docs/CMMS_MAIN_PHASE6_INVENTORY_ACCOUNTING_REPORTS_APPROVED_SCOPE_2026-08-23.md` + `docs/inventory/INVENTORY_DEVELOPMENT_PLAN_AND_CHANGE_CONTROL.md`.

## 2026-08-23 — Main Phase 6 — Unified report toolbar / Excel / PDF / Print standard approved

- Owner explicitly approved the shared report actions/export standard as part of **6.1 Reports Foundation & Unified Reports Center**.
- All Main Phase 6 reports should use a consistent organized toolbar: **تحديث** + **إعادة تعيين الفلاتر** + **طباعة** + grouped **تصدير** menu for **Excel** and **PDF**, rather than scattered per-report buttons.
- Show **تاريخ ووقت إنشاء التقرير** consistently and carry it to exports/print where practical.
- Export/print must respect the current report filters/scope.
- Excel is approved as a true `.xlsx` output where technically feasible, with clean formatting, logical columns, numeric/date typing, useful filter/freeze behavior, and Arabic RTL support while preserving English codes/source data.
- PDF/Print must use a consistent readable template with active filters, pagination/header handling where needed, and correct Arabic + mixed Arabic/English rendering.
- Shared export/report infrastructure should be created once in 6.1 and reused; do not duplicate independent export logic inside each report.
- This is documentation/approval only. **6.1 remains NOT STARTED** until a new explicit owner instruction.
- Reference: `docs/CMMS_MAIN_PHASE6_UNIFIED_REPORT_TOOLBAR_AND_EXPORT_STANDARD_APPROVED_2026-08-23.md`.


## 2026-08-23 — Main Phase 6 / 6.1 Reports Foundation implementation checkpoint

- Owner explicitly started **6.1 — Reports Foundation & Unified Reports Center**.
- **Main Phase 6 = IN PROGRESS.**
- Implemented `/inventory/reports` as the unified Inventory Reports Center; sections are Balance/Status, Movements/Tracking, Valuation/Accounting, and Analytics/Planning.
- **6.4 Analytics/Planning remains deferred / execute last** and is not implemented.
- Added reusable report UI foundation: unified toolbar (`تحديث` / `إعادة تعيين الفلاتر` / `طباعة` / grouped `تصدير` Excel/PDF), filter shell, and generated-at presentation.
- Added shared server export foundation using existing `exceljs` + existing Chromium HTML-to-PDF service; no new export dependency.
- Excel foundation: title/generated time/filter context, typed numeric/date cells, RTL, bounded widths, Auto Filter/freeze, Unicode filename support.
- PDF/Print foundation: common A4 template, RTL/LTR, mixed Arabic/English isolation, repeated table headers, escaped source values.
- No report-specific 6.2/6.3 data queries were added; no DB/SQL/migration/data mutation or workflow/accounting change.
- Targeted TS syntax/transpile + translation-key parity + source checks = PASS. Deployed Runtime verification is still required before 6.1 closure.
- **6.1 implementation checkpoint التاريخي = IMPLEMENTED / TARGETED CHECKS PASSED / DEPLOYED VERIFICATION PENDING; superseded by official closure below.**
- **Historical stop at implementation checkpoint: before 6.1 closure / before 6.2. Superseded by official 6.1 closure below.**
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_1_REPORTS_FOUNDATION_IMPLEMENTATION_2026-08-23.md`.


## 2026-08-23 — Main Phase 6 / 6.1 Reports Foundation official closure

- Initial deployed verification found the Reports Center action labels were visual-only; 6.1 correctly remained open until the defect was fixed.
- After applying the action fix and restarting, owner confirmed Runtime operation of: **تحديث / إعادة تعيين الفلاتر / طباعة / Excel / PDF**.
- Targeted test `server/tests/reportExportFoundationPhase6Step1.test.ts` = **4/4 PASS**.
- Targeted test `server/tests/reportCenterFoundationActionsPhase6Step1.test.ts` = **3/3 PASS**.
- Generated `.xlsx` and PDF outputs were supplied and opened successfully.
- No Live DB/SQL/Schema/Migration/data change and no 6.2/6.3/6.4 report business implementation.
- **6.1 = ✅ COMPLETE / TARGETED TESTS PASSED / RUNTIME VERIFICATION PASSED / OFFICIALLY CLOSED.**
- **Main Phase 6 = IN PROGRESS.**
- **Historical stop after 6.1 closure: before 6.2. Superseded when the owner explicitly started 6.2.1.**
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_1_REPORTS_FOUNDATION_RUNTIME_UAT_CLOSURE_2026-08-23.md`.

### 2026-08-23 — Main Phase 6 / 6.2 Stock Balance & Movement Reports — approved scope

- **6.1 Reports Foundation & Unified Reports Center = OFFICIALLY CLOSED.**
- Approved 6.2 execution checkpoints:
  1. `6.2.1 — Stock Balance & Status`
  2. `6.2.2 — Stock Card & Unified Movement Report`
  3. `6.2.3 — Unified Export & Review`
  4. `6.2.4 — Runtime UAT & Closure`
- 6.2 stays read-only and future-focused; old/experimental data is not repaired or cleaned.
- Reuse the closed 6.1 toolbar/filter/export foundation; do not scatter separate export implementations across reports.
- 6.3 remains NOT STARTED. 6.4 remains DOCUMENTED FOR LATER / EXECUTE LAST.
- **Historical scope stop: before 6.2.1. Superseded by the 6.2.1 implementation checkpoint below.**
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_2_STOCK_BALANCE_MOVEMENT_REPORTS_APPROVED_SCOPE_2026-08-23.md`.


### 2026-08-23 — Main Phase 6 / 6.2.1 Stock Balance & Status — implementation checkpoint

- Owner explicitly started 6.2.1.
- Implemented `/inventory/reports/stock-balance` as the first real report under the unified Reports Center.
- Read-only current-state columns: item, internal code, warehouse, quantity, unit, average cost, stored inventory value, minimum stock, status.
- Status filters: All / Normal / Low / Zero / Negative. Zero is separate from Low for an unambiguous operational view.
- Lot-tracked rows provide collapsed Lot drill-down without duplicating Main Phase 5.4 reconciliation.
- Reuses 6.1 Refresh / Reset / Print / Excel / PDF foundation and active-filter export behavior.
- No DB/schema/migration/data write, no historical cleanup/backfill/revaluation, no Accounting/Posting/Numbering/Workflow change.
- Targeted source syntax/transpile checks = PASS; deployed Runtime verification and targeted Vitest remain pending.
- **6.2.1 = IMPLEMENTED / TARGETED SOURCE CHECKS PASSED / RUNTIME VERIFICATION PENDING.**
- **6.2.2 = NOT STARTED.**
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_2_1_STOCK_BALANCE_STATUS_IMPLEMENTATION_2026-08-23.md`.


### 2026-08-23 — Main Phase 6 / 6.2.1 Runtime verification checkpoint

- 6.2.1 implementation is deployed and the Stock Balance & Status page renders in Runtime.
- Runtime screenshot evidence: `709` report rows; `141` normal; `0` low; `568` zero; `0` negative; `8` Lot Tracking inventory.
- Targeted test `stockBalanceReportPhase6Step2_1.test.ts` passed `4/4`.
- Remaining before official closure: confirm status filter Runtime behavior, Lot drill-down Runtime behavior, and Excel/PDF exports using active filters.
- **6.2.1 is not officially closed yet. 6.2.2 remains NOT STARTED.**


### 2026-08-23 — Main Phase 6 / 6.2.1 official closure

- `6.2.1 — Stock Balance & Status` Runtime acceptance completed.
- Targeted test: `server/tests/stockBalanceReportPhase6Step2_1.test.ts` = **4/4 PASS**.
- Runtime page verification = PASS.
- Stock-status filter = PASS.
- Filter-aware Excel/PDF exports = PASS.
- Lot drill-down = PASS.
- Report behavior remains read-only; no historical data changes were made.
- **6.2.1 = OFFICIALLY CLOSED.**
- **6.2.2 = NOT STARTED.**
- **Current stop: after 6.2.1 closure / before 6.2.2.**

## 2026-08-23 — Main Phase 6 / 6.2.2 Stock Card & Unified Movement Report implemented

- Owner explicitly started 6.2.2 after official closure of 6.2.1.
- Added one read-only page `/inventory/reports/movements` with two tabs: **جميع الحركات** and **بطاقة الصنف**.
- Unified filters: item/document/Lot search, warehouse, movement type, direction, date range; Stock Card adds one-item selection.
- Stock Card shows current stored quantity/value plus recorded transaction history only; no fabricated opening balance and no legacy reconstruction/backfill.
- Movement rows expose available item, warehouse, type/direction, Lot Code, quantity, unit cost/value, document/reference and reason.
- Reused 6.1 Refresh/Reset/Print/Excel/PDF foundation; exports use the same filter contract as the screen.
- Added targeted test `server/tests/inventoryMovementReportPhase6Step2_2.test.ts`.
- No SQL/schema/migration/data mutation, historical cleanup/backfill/revaluation, workflow/accounting/posting/numbering change, Batch Transfer redesign, or Production Cutover.
- **6.2.2 = IMPLEMENTED / TARGETED SOURCE CHECKS PASSED / DEPLOYED RUNTIME VERIFICATION PENDING.**
- **6.2.3 = NOT STARTED.**
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_2_2_STOCK_CARD_UNIFIED_MOVEMENT_IMPLEMENTATION_2026-08-23.md`.


### 2026-08-23 — Main Phase 6 / 6.2.2 Stock Card & Unified Movement Report — official closure

- `6.2.2 — Stock Card & Unified Movement Report` Runtime acceptance completed.
- Targeted test: `server/tests/inventoryMovementReportPhase6Step2_2.test.ts` = **4/4 PASS**.
- Runtime **جميع الحركات** and **بطاقة الصنف** views = PASS.
- Movement/Stock Card filters = PASS.
- Filter-aware Excel/PDF exports = PASS.
- Stock Card remains current-state + recorded-history only; no fabricated Opening Balance or historical reconstruction.
- Report remains read-only; no historical data changes, Auto-fix, Accounting/Posting/Numbering or Workflow change.
- **6.2.2 = OFFICIALLY CLOSED.**
- **6.2.3 = NOT STARTED.**
- **Current stop: after 6.2.2 closure / before 6.2.3.**
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_2_2_STOCK_CARD_UNIFIED_MOVEMENT_RUNTIME_CLOSURE_2026-08-23.md`.


### 2026-08-23 — Main Phase 6 / 6.2.3 Unified Export & Review — implementation checkpoint

- 6.2.1 and 6.2.2 remain officially closed.
- Owner explicitly started 6.2.3.
- Reviewed the actual 6.2 report export paths against the closed 6.1 common foundation.
- Added `server/tests/unifiedReportExportReviewPhase6Step2_3.test.ts` for cross-report Export/Print/RTL/filter/generated-at consistency.
- Hardened movement/Stock Card warehouse filter export metadata to use readable warehouse code/name rather than a raw numeric ID when metadata is available.
- No new report page, no second export architecture, no DB mutation/SQL/migration/backfill/cleanup/revaluation.
- **6.2.3 = IMPLEMENTED / TARGETED SOURCE CHECKS PASSED / DEPLOYED RUNTIME VERIFICATION PENDING.**
- **6.2.4 = NOT STARTED.**
- **Current stop:** deploy and Runtime-verify 6.2.3. Do not start 6.2.4 automatically.
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_2_3_UNIFIED_EXPORT_REVIEW_IMPLEMENTATION_2026-08-23.md`.


## 2026-08-23 — Main Phase 6 / 6.2.3 Unified Export & Review — OFFICIALLY CLOSED

- Owner completed deployed Runtime verification for the unified 6.2 export/review step.
- `server/tests/unifiedReportExportReviewPhase6Step2_3.test.ts` = **4/4 PASS**.
- Runtime report filters = PASS.
- Runtime Excel export = PASS.
- Runtime PDF export = PASS.
- Runtime Print = PASS.
- Active-filter-aware export behavior = PASS.
- 6.2.3 continues to reuse the single closed 6.1 reporting/export foundation; no parallel export architecture was added.
- Timezone-specific `Asia/Riyadh` enforcement was reviewed but the owner explicitly marked it **not important currently**; it is not a 6.2.3 closure blocker and this closure does not claim a Riyadh-time guarantee.
- No SQL/schema/migration/data mutation, Historical Backfill/Cleanup/Revaluation, Workflow/Accounting/Posting/Numbering change, Batch Transfer redesign, or Production Cutover.
- **6.2.3 = COMPLETE / TARGETED TESTS PASSED / RUNTIME EXPORT-PRINT REVIEW PASSED / OFFICIALLY CLOSED.**
- **6.2.4 = NOT STARTED. Current stop: after 6.2.3 closure / before 6.2.4.**
- Closure reference: `docs/CMMS_MAIN_PHASE6_STEP6_2_3_UNIFIED_EXPORT_REVIEW_RUNTIME_CLOSURE_2026-08-23.md`.


## 2026-08-23 — Main Phase 6 / 6.2.4 Runtime UAT & 6.2 official closure

- Stock Balance report was verified against Live DB for `LOT-2026-191EEB06`: source warehouse quantity `3`, destination warehouse quantity `1`, total Lot remaining `4`, with current values `30.00` and `10.00`.
- Unified Movement Report was verified against Live DB for the same Lot: Receipt IN `5`, Delivery OUT `1`, Transfer OUT `1`, Transfer IN `1`; references include `DLV-2026-300215` and `TRF-2026-030006`.
- Stock Card search issue found during UAT was fixed; `server/tests/stockCardSearchPhase6Step2_4.test.ts` = **4/4 PASS** and Runtime re-test passed.
- Stock Card showed current quantity `4`, current value `40.00`, `2` warehouses and `4` movements; total in `6`, total out `2`.
- Existing accepted filters / Excel / PDF / Print behavior remained working.
- Reports remain read-only. No historical reconstruction/backfill/cleanup/revaluation or data mutation was introduced.
- Riyadh timezone enforcement remains deferred/non-blocking by owner decision; no universal timezone guarantee is claimed.
- **6.2.4 = OFFICIALLY CLOSED.**
- **6.2 = COMPLETE / OFFICIALLY CLOSED.**
- **6.3 = NOT STARTED.**
- **Current stop: after 6.2 closure / before 6.3. Do not start 6.3 automatically.**
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_2_4_RUNTIME_UAT_AND_STEP6_2_CLOSURE_2026-08-23.md`.


## 2026-08-23 — Main Phase 6 / 6.3 Inventory Valuation & Accounting Reports — Approved Scope

- **6.1 = OFFICIALLY CLOSED.**
- **6.2 = COMPLETE / OFFICIALLY CLOSED.**
- Owner approved/documented 6.3 before implementation.
- Approved breakdown: `6.3.1 Inventory Valuation Report` → `6.3.2 Value by Warehouse / Category` → `6.3.3 Inventory Variance & Accounting Review` → `6.3.4 Runtime UAT & Closure`.
- 6.3 is read-only reporting over current accepted quantity/cost/value state; no revaluation, posting, historical reconstruction, backfill or cleanup.
- 6.3.3 may present/reuse relevant read-only 5.4 reconciliation evidence but must not duplicate/fork the 5.4 engine or add Auto-fix.
- Reuse the 6.1/6.2 report foundation for filters / generated-at / Print / Excel / PDF / RTL/mixed-language output.
- Riyadh timezone enforcement remains deferred/non-blocking by current owner decision.
- **6.3 = SCOPE APPROVED / DOCUMENTED — IMPLEMENTATION NOT STARTED.**
- **6.3.1 = NOT STARTED.**
- **Current stop:** before 6.3.1. Do not start 6.3.1 automatically from documentation alone.
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_3_INVENTORY_VALUATION_ACCOUNTING_REPORTS_APPROVED_SCOPE_2026-08-23.md`.


## 2026-08-24 — Main Phase 6 / 6.3.1 Inventory Valuation Report — OFFICIALLY CLOSED

- Owner explicitly started 6.3.1 after the 6.3 scope was approved/documented.
- Inventory Valuation report is implemented and deployed as a **read-only** report over current stored inventory values.
- It displays current `quantity`, `averageCost`, and stored `totalCostValue`; it does not recalculate/revalue inventory for posting.
- Runtime UI: search, warehouse filter, and value-status filter verified working.
- Runtime export/print: Excel / PDF / Print verified working.
- Targeted Vitest: `inventoryValuationReportPhase6Step3_1.test.ts` = **4/4 PASS**.
- No DB/SQL/migration/data mutation, no Revaluation, no historical backfill/cleanup, and no accounting/posting behavior change.
- **6.3 = IN PROGRESS.**
- **6.3.1 = COMPLETE / TARGETED TESTS PASSED / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- **6.3.2 = NOT STARTED.**
- **Current stop:** after 6.3.1 closure / before 6.3.2 Value by Warehouse / Category.
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_3_1_INVENTORY_VALUATION_REPORT_RUNTIME_CLOSURE_2026-08-24.md`.


## 2026-08-24 — Main Phase 6 / 6.3.2 Value by Warehouse / Category — Implemented in Code

- Owner explicitly approved implementing 6.3.2 completely in one delivery.
- Added grouped read-only views inside `/inventory/reports/valuation`: **By Warehouse** and **By Category**, while preserving the closed 6.3.1 detail view.
- Grouped values reuse the 6.3.1 stored `totalCostValue` basis; no Revaluation or `averageCost`/`totalCostValue` mutation.
- Category grouping reuses the accepted 2B-9 `Inventory → Catalog Item → Catalog Taxonomy` read layer; unmapped rows remain visibly `Uncategorized / غير مصنف` with no Backfill/Cleanup.
- Mixed quantity units are kept separate as quantity context instead of being summed into a misleading cross-unit total.
- Share % is based on the active filtered total and is suppressed when that denominator is zero/negative.
- Added filter-aware Excel/PDF/Print endpoints for both grouped views using the shared 6.1 reporting foundation.
- Added targeted test `server/tests/inventoryValueDistributionReportPhase6Step3_2.test.ts` (5 tests prepared).
- Packaging environment checks: TypeScript syntax transpilation PASS + isolated exact grouping logic harness PASS. Project Vitest is not claimed because uploaded project dependencies are not installed in this environment.
- No SQL/migration/DB mutation, Auto-fix, Historical Backfill/Cleanup, Revaluation, Accounting/Posting/Workflow/Numbering change, Batch Transfer redesign, 6.4 work, or Cutover.
- **6.3 = IN PROGRESS.**
- **6.3.1 = OFFICIALLY CLOSED.**
- **6.3.2 = IMPLEMENTED IN CODE / TARGETED VITEST + DEPLOYED RUNTIME UAT PENDING.**
- **6.3.3 = NOT STARTED. Do not start automatically before 6.3.2 verification/closure.**
- Reference: `docs/CMMS_MAIN_PHASE6_STEP6_3_2_VALUE_BY_WAREHOUSE_CATEGORY_IMPLEMENTATION_2026-08-24.md`.


## 2026-08-24 — Main Phase 6 / 6.3.2 Value by Warehouse / Category — OFFICIALLY CLOSED

- Owner executed `pnpm exec vitest run server/tests/inventoryValueDistributionReportPhase6Step3_2.test.ts` → **1 test file passed / 5 tests passed**.
- Runtime evidence confirmed the three valuation-area tabs render after deployment: 6.3.1 detail, **Value by Warehouse**, and **Value by Category**.
- Runtime warehouse view showed **717** source inventory rows and **3** grouped results; category view showed **717** source rows, **16** category groups, and **688** rows visibly unmapped/uncategorized.
- Owner confirmed the report works correctly and **Excel / PDF / Print** work in Runtime.
- Stored `totalCostValue` remains the valuation basis; no Revaluation and no `averageCost`/`totalCostValue` mutation.
- Category gaps remain visible as `غير مصنف / Uncategorized`; no Backfill/Cleanup was performed.
- No SQL/migration/DB mutation, Auto-fix, Historical Backfill/Cleanup, Accounting/Posting/Workflow/Numbering change, Batch Transfer redesign, 6.4 work, or Cutover.
- **6.3 = IN PROGRESS.**
- **6.3.1 = OFFICIALLY CLOSED.**
- **6.3.2 = COMPLETE / TARGETED TESTS PASSED / RUNTIME UAT ACCEPTED / OFFICIALLY CLOSED.**
- **6.3.3 = NOT STARTED.**
- **Current stop:** after 6.3.2 official closure / before 6.3.3 Inventory Variance & Accounting Review. Do not start 6.3.3 automatically.
- Closure reference: `docs/CMMS_MAIN_PHASE6_STEP6_3_2_VALUE_BY_WAREHOUSE_CATEGORY_RUNTIME_CLOSURE_2026-08-24.md`.


## 2026-08-24 — Main Phase 6 / 6.3 reorganized into two checkpoints; Current 6.3.2 implemented

- Owner explicitly approved merging the previous four 6.3 checkpoints into two current checkpoints only.
- **Current 6.3.1 — Inventory Valuation & Value Distribution = former 6.3.1 + former 6.3.2 = OFFICIALLY CLOSED.**
- **Current 6.3.2 — Inventory Variance, Accounting Review & Runtime Closure = former 6.3.3 + former 6.3.4 = IMPLEMENTED IN CODE / VERIFICATION PENDING.**
- Historical implementation/test/closure documents retain their old numbering and are not renamed.
- Accounting Review reuses `loadInventoryValuationReport()` + `runInventoryReconciliation()` + accepted Catalog taxonomy; no second reconciliation engine was created.
- No Auto-fix, Revaluation, Historical Backfill, Legacy Cleanup, Posting redesign, Centralized Numbering, Batch Transfer semantic change, or 6.4 Analytics work was introduced.
- Targeted test to run: `pnpm exec vitest run server/tests/inventoryAccountingReviewReportPhase6Step3_2Merged.test.ts`.
- **Current stop:** after code implementation of current 6.3.2; before final 6.3 closure. Runtime UAT remains required.


## 2026-08-24 — Current Main Phase 6 / 6.3.2 + Main Phase 6.3 — OFFICIALLY CLOSED

- Owner confirmed all Accounting Review runtime filters work: search, warehouse, stored-value status, category, and review status.
- Owner also confirmed Excel/PDF/Print work in Runtime.
- Targeted test `server/tests/inventoryAccountingReviewReportPhase6Step3_2Merged.test.ts` = **6/6 PASS**.
- **Current 6.3.1 — Inventory Valuation & Value Distribution = OFFICIALLY CLOSED.**
- **Current 6.3.2 — Inventory Variance, Accounting Review & Runtime Closure = COMPLETE / TARGETED TESTS PASSED / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- **Main Phase 6.3 — Inventory Valuation & Accounting Reports = COMPLETE / OFFICIALLY CLOSED.**
- No SQL/migration/DB mutation, Revaluation, Auto-fix, Historical Backfill, Legacy Cleanup, Accounting/Posting/Workflow/Numbering change, Batch Transfer all-or-nothing change, 6.4 work, or Cutover was part of this closure.
- **6.4 Inventory Analytics & Planning Reports = DOCUMENTED FOR LATER / EXECUTE LAST / NOT STARTED.**
- **6.5 Runtime UAT & Main Phase 6 Closure = NOT STARTED.**
- **Current stop:** after Main Phase 6.3 official closure. Do not start 6.4 or 6.5 automatically.
- Closure reference: `docs/CMMS_MAIN_PHASE6_MERGED_STEP6_3_2_RUNTIME_UAT_AND_PHASE6_3_CLOSURE_2026-08-24.md`.

## 2026-08-24 — Main Phase 6.4 Inventory Analytics & Planning — implementation checkpoint

- Owner explicitly resumed and approved execution of 6.4 after Main Phase 6.3 closure.
- Implemented one unified `/inventory/reports/analytics` page with five Tabs: Slow Moving / Dead Moving / ABC / Aging / Turnover.
- Read-only implementation only; no SQL/Migration/DB mutation, Auto-fix, Historical Backfill, Legacy Cleanup, Revaluation, accounting/workflow/numbering change, Batch Transfer semantic change, or Cutover.
- Slow/Dead uses recorded outbound history only with configurable thresholds (defaults 90/180 days); missing outbound history stays explicitly unassessed rather than being invented as slow/dead.
- ABC uses positive stored current value only and does not revalue inventory.
- Aging uses current positive `inventory_lot_balances` joined to `inventory_lots.createdAt`; uncovered positive inventory is reported as unavailable aging coverage without historical reconstruction.
- Turnover is explicitly a planning indicator based on recorded outbound value / current stored value; it is not claimed as accounting COGS/Average Inventory turnover.
- Shared filters/export foundation reused; Excel/PDF/Print are wired per active tab and active filters.
- Targeted test prepared: `server/tests/inventoryAnalyticsReportPhase6Step4.test.ts`.
- **6.4 current status = IMPLEMENTED IN CODE / TARGETED TEST + RUNTIME UAT PENDING.**
- **6.5 = NOT STARTED.** Do not start 6.5 automatically.

## 2026-08-24 — Main Phase 6.4 Inventory Analytics & Planning — OFFICIALLY CLOSED

- Owner executed `pnpm exec vitest run server/tests/inventoryAnalyticsReportPhase6Step4.test.ts` → **1 test file passed / 8 tests passed**.
- Owner accepted Runtime behavior of 6.4 and confirmed **filters + export + Print** work correctly.
- Unified `/inventory/reports/analytics` remains the single analytics page with Slow Moving / Dead Moving / ABC / Aging / Turnover tabs.
- Turnover remains explicitly a **planning indicator** (`recorded outbound value / current stored value`) and is not claimed as accounting `COGS / Average Inventory` turnover.
- Read-only boundaries remain intact: no SQL/Migration/DB mutation, Auto-fix, Historical Backfill, Legacy Cleanup, Revaluation, `averageCost`/`totalCostValue` mutation, accounting/posting/workflow/numbering change, Batch Transfer semantic change, or Cutover.
- **6.4 = COMPLETE / TARGETED TESTS PASSED / RUNTIME UAT ACCEPTED / OFFICIALLY CLOSED.**
- **6.5 = NOT STARTED. Do not start automatically.**
- **Current stop:** after Main Phase 6.4 official closure / before Main Phase 6.5.
- Closure reference: `docs/CMMS_MAIN_PHASE6_STEP6_4_INVENTORY_ANALYTICS_PLANNING_RUNTIME_UAT_CLOSURE_2026-08-24.md`.


## 2026-08-24 — Main Phase 6.5 Final Runtime UAT & Closure — IN PROGRESS

- Owner explicitly approved executing 6.5 as one final closure pass after 6.4 official closure.
- Added `server/tests/mainPhase6FinalClosurePhase6Step5.test.ts` as the final regression/closure gate across 6.1–6.4 contracts.
- Added `docs/CMMS_MAIN_PHASE6_STEP6_5_FINAL_RUNTIME_UAT_CLOSURE_GATE_2026-08-24.md` with the final owner Runtime checklist and explicit exclusions.
- No new report/business feature, SQL, migration, DB mutation, backfill, cleanup, revaluation, numbering change, Batch Transfer semantic change, or accounting/workflow redesign is introduced by 6.5.
- **Status:** 6.5 = IN PROGRESS / FINAL REGRESSION + OWNER RUNTIME ACCEPTANCE PENDING. Main Phase 6 is not officially closed until both pass.


## 2026-08-24 — Main Phase 6.5 + Main Phase 6 — OFFICIALLY CLOSED

- Owner executed the corrected final regression gate `server/tests/mainPhase6FinalClosurePhase6Step5.test.ts` → **1 test file passed / 9 tests passed**.
- Final gate confirmed unified routes/Reports Center, shared report foundation, read-only DB-facing report services, stored `totalCostValue` valuation behavior, single-page five-tab 6.4 analytics, no project `receipt_number_counter`, and Batch Transfer per-item/partial-result semantics.
- Owner accepted the cleaned `/inventory/reports` Runtime UX and confirmed all five report-center cards open correctly and work.
- Previously accepted report Runtime evidence for filters / Excel / PDF / Print remains valid.
- No SQL/Migration/DB mutation, Revaluation, Auto-fix, Historical Backfill, Legacy Cleanup, historical renumbering, Centralized Numbering, accounting/workflow redesign, Batch Transfer all-or-nothing change, or Cutover was part of 6.5.
- **6.5 = COMPLETE / FINAL REGRESSION PASSED / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- **Main Phase 6 = COMPLETE / RUNTIME UAT PASSED / OFFICIALLY CLOSED.**
- **Main Phase 7 — Inventory Posting Engine = NOT STARTED.**
- **Current stop:** after Main Phase 6 official closure / before Main Phase 7. Do not start Main Phase 7 automatically.
- Closure reference: `docs/CMMS_MAIN_PHASE6_FINAL_RUNTIME_UAT_AND_OFFICIAL_CLOSURE_2026-08-24.md`.


## 2026-08-24 — Main Phase 7 deferred; future implementation direction = Option B

- صاحب المشروع قرر **تأجيل Main Phase 7** بعد مراجعة الحاجة الفعلية للمحرك؛ لم يبدأ أي Coding.
- عند العودة إلى Main Phase 7 مستقبلًا، الاتجاه المعتمد هو **Option B — Shared Posting Core صغير ومحافظ**، وليس Full Centralized Inventory Posting Engine.
- تبقى Workflow-specific business/costing rules داخل الخدمات المتخصصة؛ يتم توحيد primitives المشتركة فقط بعد إعادة الفحص والموافقة.
- Batch Transfer يبقى per-item/partial success؛ Centralized Numbering و`receipt_number_counter` يبقيان DEFERRED؛ لا Historical Cleanup/Backfill/Revaluation/Renumbering ولا Cutover ولا تغيير Workflow/Accounting behavior ضمن القرار.
- **Main Phase 7 = DEFERRED / NOT STARTED. Main Phase 8 = NOT STARTED / DO NOT AUTO-START.**
- المرجع: `docs/CMMS_MAIN_PHASE7_DEFERRAL_AND_OPTION_B_SHARED_POSTING_CORE_DECISION_2026-08-24.md`.

## 2026-08-24 — Main Phase 8 converted to Optional Operational Enhancements

- صاحب المشروع قرر **عدم تنفيذ Main Phase 8 كمرحلة كاملة إلزامية**؛ لم يبدأ أي Coding.
- Main Phase 8 تبقى **DEFERRED / OPTIONAL / NOT STARTED** وتتحول إلى قائمة تحسينات تشغيلية اختيارية.
- كل Candidate مثل Settlement/Disposal Approvals، Maker/Checker، Transfer In-Transit/Destination Receipt، repeated partial receive/issue، Rack/Bin/Location، Min/Max، Safety Stock، Reorder Point وغيرها يحتاج `Need / Don't Need` + تحليل أثر + موافقة صريحة منفصلة قبل التنفيذ.
- بقاء عنصر في القائمة لا يعني أنه Requirement معتمد أو نقصًا في النظام الحالي، ولا يجب تنفيذ جميع العناصر قبل Final Project Hardening / Closure.
- الـWorkflow الحالي يبقى كما هو ما لم يعتمد المالك تغييرًا محددًا.
- لا Batch Transfer all-or-nothing، ولا Centralized Numbering/`receipt_number_counter`، ولا Historical Cleanup/Backfill/Revaluation/Renumbering، ولا Cutover، ولا Accounting behavior change تلقائيًا.
- **Main Phase 7 = DEFERRED / NOT STARTED — future Option B only.**
- **Main Phase 8 = DEFERRED / OPTIONAL / NOT STARTED — no full-phase auto-execution.**
- المرجع: `docs/CMMS_MAIN_PHASE8_OPTIONAL_OPERATIONAL_ENHANCEMENTS_DECISION_2026-08-24.md`.



## 2026-08-24 — Inventory Module Development & Modernization current approved scope officially closed

- صاحب المشروع اعتمد إعلان انتهاء **بناء وتحديث وحدة المخزون ضمن النطاق الحالي المعتمد**.
- **Inventory Module Development & Modernization = COMPLETE / CURRENT APPROVED SCOPE CLOSED.**
- Main Phase 3 / 4 / 5 / 6 تبقى مغلقة حسب إغلاقاتها الرسمية السابقة.
- **Main Phase 7 = DEFERRED / NOT STARTED**؛ وإذا استؤنفت مستقبلًا فالقرار هو Option B — Shared Posting Core صغير ومحافظ بعد موافقة جديدة.
- **Main Phase 8 = DEFERRED / OPTIONAL / NOT STARTED**؛ ليست Gate إلزامية، وكل Candidate يحتاج Need/Don't Need + موافقة مستقلة.
- هذا الإغلاق لا يعني Final Project Hardening / Closure ولا Production/Inventory Cutover. `2B-10-2C` يبقى مؤجلًا إلى Final Hardening، والـCutover يبقى خطوة مستقلة لاحقة.
- لا Code/SQL/Schema/Live DB/Workflow/Accounting change، ولا Historical Cleanup/Backfill/Revaluation/Renumbering ضمن هذا القرار.
- **Official stop:** current approved inventory-development scope closed; do not auto-start Phase 7, Phase 8, Final Hardening, or Cutover.
- المرجع: `docs/CMMS_INVENTORY_MODULE_DEVELOPMENT_MODERNIZATION_CURRENT_SCOPE_OFFICIAL_CLOSURE_2026-08-24.md`.

## 2026-10-13 — تكلفة تنفيذ الصيانة مؤجلة

- طلب المستخدم إبقاء «تكلفة تنفيذ الصيانة» مؤجلة عند تطوير لوحة المالك والأدمن.
- البطاقة الحالية هي «قيمة المشتريات المستلمة»: actualTotalCost للأصناف المستلمة فقط، وليست تكلفة استهلاك/تنفيذ أو صافي مرتجعات.
- لا يبدأ احتساب التنفيذ أو العمالة أو الخدمات أو ربط تكلفة الصرف والمرتجع تلقائيًا. يلزم فحص مصادرها ومنع الازدواج وموافقة صريحة مستقلة قبل أي تطوير.
- الوقائي وPMV2 مستبعدان من اللوحة الحالية بقرار المستخدم. التقرير: docs/dashboard/IMPLEMENTATION_REPORT_AR.md.

## 2026-10-13 — تأجيل فحص بقاء طلب الشراء في «بانتظار إجرائي» للمندوب

- المستخدم قرر «تجاوز عن هذه المشكلة حاليا سننتقل الى جزء اخر». لا يبدأ إصلاحها تلقائيًا ضمن تطوير اختيار الكتالوج.
- الفحص في CMMSFINAL وجد أن computeActionablePOs يفحص أصناف المندوب نفسه؛ مثال أربعة أصناف أعاد طلبًا للمندوب صاحب الأصناف الثلاثة وصفرًا للمندوب الذي أكمل صنفه.
- وُجدت فجوة تحديث في الواجهة: تأكيد الشراء/التسليم يحدث التفاصيل أو دورة الشراء دون تحديث صريح لـactionableForMe/actionableItemsForMe. هذا سبب محتمل، ولم يُثبت سبب الحالة الحية أو تُفحص قاعدة المستخدم.
- عند العودة يحتاج الأمر التحقق من استمرار الظهور بعد تحديث الصفحة الكامل ومن نسخة التشغيل وحالات أصنافه، ثم موافقة صريحة على الإصلاح. تبقى partial_purchase للرأس صحيحة ما دامت أصناف أخرى غير مكتملة.
- **تحديث 2026-10-21:** وافق المستخدم صراحة على إصلاح تأخر تحديث حالة الشراء والتوريد المثبت في UAT للحزمة PB-2026-150001. عولجت هذه الجزئية محليًا بتحديث الحالة المؤكدة وإعادة التحقق من قوائم الإجراء والمتابعة والحزم؛ لم تتغير قواعد اختيار أصناف المندوب أو حالة الشراء الجزئي. يلزم نشر هذا الإصلاح وإعادة تجربته، ولا يُعد ذلك إغلاقًا تلقائيًا لكل سيناريوهات المشكلة القديمة. المرجع: docs/PURCHASE_PACKAGE_RECEIPT_FIX_2026_10_21.md.

## 2026-10-21 — مسودة RED3 وطلب التحسين: قبول حي بعد النشر

- أصلح محليًا اختفاء أصناف المسودة3840003 عن المندوب المنشئ في API والتفاصيل، مع بقاء نطاق الطلبات المرسلة كما هو. الاختبارات المعزولة ناجحة؛ النشر ثم فتح/تعديل/حفظ المسودة بحساب RED3 مطلوبان قبل الإغلاق الحي. المرجع: docs/DELEGATE_OWN_DRAFT_FIX_2026_10_21.md.
- PR-2026-240474/IMP-2026-00017: التسعير محفوظ؛ إرسال الحزمة والاعتماد والشراء والاستلام والتكلفة والتقييم/الإغلاق لم تثبت بالكامل حيًا بعد. لا تُسجّل مراحل غير منفذة كناجحة.
- نطاق PMV2 للتحويل والصرف وربط تكلفة اللوت اكتمل حيًا: TRB-2026-180003 ثم DLV-2026-510003، تكلفة اللوت1ريال على PMV2-20261011-P1-T1. لا يشمل إغلاق المهمة. الدليل: docs/runtime-uat/2026-10-21-pmv2-completion/REPORT_AR.md.
# 2026-10-21 — متابعة البنود الثلاثة: النشر والقبول الحي مطلوبان

- إلزام صورة الكتالوج نُفذ محليًا مع حفظ ذري للصنف والمرفق، واختبارات ناجحة. لا SQL. اختبار الواجهة المنشورة ينتظر النشر.
- مسودة3840003 ما زالت بلا أصناف في جلسة RED3 الحية، وصنفها ظاهر لـRED9؛ لم تثبت نسخة إصلاح المنشئ منشورة، ولم ترسل المسودة حتى لا نفقد عينة اختبار التاريخ قبل التحقق من الإصلاح.
- PR240474 انتقل فعليًا إلى بانتظار اعتماد الحسابات، ويظهر الأصل AST00047 والفكرة IMP00017. طُلب اعتماد المستخدم RED4 ثم RED8؛ الشراء والاستلام وتكلفة التنفيذ والإغلاق لا تزال غير مكتملة.
- المرجع: docs/runtime-uat/2026-10-21-improvement-date-catalog/REPORT_AR.md.

## 2026-10-21 — استكمال تكلفة الأصل لفكرة شراء: تعديل محلي ينتظر النشر
- بعد طلب المستخدم «أكمل»، أضيف خيار إنشاء بلاغ تنفيذ للفكرة قيد التنفيذ المرتبطة بطلب شراء مع إبقاء طلبها. لا صرف مستقل، ولا تغيير تقييم المخزون أو الصلاحيات. التحقق يحفظ سياق الموقع/القسم/الأصل ويمنع التكرار.
- استلام PR240474 وLOT784 اكتمل سابقًا؛ تكلفة الصرف على AST00047 وإغلاق IMP00017 لم تكتمل حيًا. يلزم نشر التعديل ثم تنفيذ الاختبار الموثق في docs/IMPROVEMENT_PURCHASE_EXECUTION_LINK_2026_10_21.md. لا SQL.

## 2026-10-28 — الصرف التشغيلي الجماعي: انتظار SQL اليدوي والقبول على copycmms2

- اكتمل الكود والتحقق المحلي: مخزون للمستودع، كتالوج للمالك/admin فقط، حتى20بندًا بسياق وفني لكل بند، معاينة FIFO، حفظ وإرسال، تأكيد جماعي، مستلم فعلي وملاحظات اختيارية، وتكاليف اللوت في الكاتب القائم.
- يلزم تنفيذ docs/operational-dispatch/01_copycmms2_manual.sql يدويًا ثم اختبار المتصفح والسندات والأرصدة على copycmms2. لم ينفذ اتصال/تعديل قاعدة أو نشر أو صرف من كشف الإكسل.
- 188اختبارًا للصرف و397اختبارًا للصلاحيات والقراءات ناجحة، والبناء ناجح. فحص TypeScript العام ليس نظيفًا؛ لا أخطاء في الملفات الجديدة. التفاصيل: docs/operational-dispatch/README.md.
- سجل تاريخي: كان تطوير مرتجع المورد وإدخال كشف الإكسل متوقفين عند كتابة هذا التحديث؛ استؤنف تطوير المرتجع لاحقًا، وبقي إدخال كشف الإكسل مؤجلًا.

## 2026-10-28 — استئناف المرتجعات بالخيار الثاني: التكامل المالي قيد التنفيذ

- استؤنف التطوير بعد الصرف التشغيلي. القرار المعتمد هو إعادة استخدام دورة الشراء/الحزم/الاعتمادات/الاستلام الحالية للبديل، مع عهدة الفرق فقط وربط الأصل والاحتياج؛ لا دورة مالية مستقلة جديدة.
- وصل إنشاء المتابعة والتسليم وقرار المندوب تجريبيًا، وأضيف اختيار الكمية الجزئية/الكاملة ومعاينة وحفظ قيمة فاتورة اللوت. 156اختبار مرتجعات و397اختبار صلاحيات/قراءات والبناء ناجحة. لا SQL إضافي لهذا الجزء، ولا اتصال قاعدة أو اختبار متصفح أو نشر بهذه الجولة.
- المتبقي: ربط البديل وحزمة الفرق واعتماداتها وPDF ومراجع الأصل ورصيد المورد والاستلام والاحتياج والصور، واختبار الدورة كاملة والشراء العادي على copycmms2. لا تطبيق على cmms قبل اكتمال التحقق. كشف الإكسل المؤجل لم يُصرف ضمن هذا العمل.
- المرجع: docs/SUPPLIER_RETURN_FOLLOWUP_2026_10_27.md، وتحديث2026-10-28 في CHANGELOG_TECHNICAL.

## 2026-10-29 — تعويض مرتجع المورد: ربط برمجي قيد اختبار المتصفح

- رُبط اختيار الصنف البديل بمنشئ الطلب والتحقق من مصدر المرتجع، ثم إنشاء طلب شراء مستقل مرتبط بخطة التعويض. التسعير يحجز رصيد المورد المثبت عند قبول المندوب، ويحسب عهدة الفرق على أساس سعر شامل الضريبة. الاعتمادات وPDF والشراء والاستلام تمر عبر الكتّاب الحاليين مع روابط التعويض، دون تعديل الفاتورة الأصلية.
- نجحت 178 حالة مرتجعات و398 حالة نطاق قراءات وصلاحيات، وبناء الإنتاج. لم تُجر دورة متصفح كاملة على copycmms2، ولا يجوز تطبيق الجداول أو الميزة على cmms بعد.

### تحديث اختبار copycmms2 — 2026-10-29

- اكتملت من المتصفح دورة تعويض تجريبية لمرتجع غير مرتبط ببلاغ: `RTN-2026-210004` ← طلب البديل `PR-2026-210471` ← حزمة `DPB-2026-000001` ← اعتماد الحسابات والإدارة لفرق عهدة 5.28 ر.س ← شراء المندوب ← استلام `RCV-2026-540018`/`LOT-2026-00838`. ظهرت مرحلة «تم استلام البديل» في متابعة المرتجع، وقيمة الأصل 14.72 ر.س والبديل 20.00 ر.س. صور الفاتورة والصنف تجريبية.
- أضيف فحص محصور بقاعدة `copycmms2` لاعتبار بند الشراء الأصلي معوّضًا في مسار B فقط بعد تسليم البديل إلى الفني، وعند تطابق الوحدة وتعويض كامل كمية البند؛ المرتجع الجزئي يبقى ضمن شروط التسليم المعتادة. نجحت 202 حالة مرتجعات ومسار B و399 حالة نطاق قراءات وصلاحيات، وبناء الإنتاج.
- **لم يُختبر حيًا بعد** تعويض صنف مرتبط ببلاغ صيانة، ولا سيناريو إعادة التسعير بعد الرفض أو استرداد النقد أو إلغاء الصنف من المتصفح. يجب إبقاء الميزة على `copycmms2` وعدم نقل الجداول أو تفعيلها على `cmms` حتى تكتمل هذه الاختبارات.
- ما يزال يلزم اختبار حقيقي للرفض وإعادة التسعير والاستلام واستكمال الاحتياج الأصلي، وتحديد وتنفيذ مسار الاسترداد النقدي وإلغاء الصنف غير المرتبط. كشف الإكسل ما زال مؤجلًا.
- في تحديث لاحق بتاريخ 2026-10-29 أضيف تأكيد المندوب لاستلام النقد/التحويل برقم مرجع، وربط اختيار البديل بعده؛ بقي اختبار هذا المسار حيًا، وإغلاق الرفض وإعادة التسعير وإلغاء الصنف ومزامنة الاحتياج. لا تطبيق على cmms.

### تحديث 2026-10-29 — التأسيس اليدوي ونتائج الرفض والاسترداد

- نفذ المستخدم يدويًا على `cmms` الجداول الخمسة للمرتجعات، متضمنة حقول منع التكرار، وعمود `operational_issue_items.dispatchContext` وجدول `operational_issue_batches`. روجعت نتائج SHOW CREATE/COLUMNS التي أرسلها؛ لم ينفذ الوكيل DDL أو اتصالًا مباشرًا بقاعدة الإنتاج.
- أضيف `SUPPLIER_RETURN_FOLLOWUP_ENABLED=true` كمفتاح صريح لدعم `cmms`، مع بقاء `copycmms2` متاحة افتراضيًا ورفض أي قاعدة أخرى. لم يُضبط المفتاح على الإنتاج ولم يُنشر الكود. اختيار مستودع GitHub حر للمستخدم ولا يوجد قيد مستودع في الميزة.
- نجح من المتصفح `RTN-2026-240002`: إنشاء من اللوت التجريبي `LOT-2026-00838`، قبول المندوب، اختيار الاسترداد، إثبات 20 ر.س بمرجع `TEST-COPYCMMS2-REFUND-20261029`، ثم إغلاق المتابعة بحساب المنشئ. أصلح استعلام ارتباط الصرف التشغيلي ليستعمل `SELECT 1` بدل عمود `id` غير الموجود، وأظهرت الواجهة نجاح الاسترداد والإغلاق.
- نجح من المتصفح `RTN-2026-240003`/`PR-2026-210472`: رفض الحسابات لسعر 20 ر.س في `DPB-2026-000002`، إعادة تسعير الصنف نفسه إلى 18 ر.س وإرساله في `DPB-2026-000003` مع فرق 3.28 ر.س، ثم اعتماد الحسابات وإعادته للمندوب من الإدارة. أضيف زر إعادة تسعير البديل للإدارة فقط عند دفعة التعويض المعلقة؛ الدفعات العادية لم تتغير.
- قرار المستخدم: النقد المسترد يبقى لدى المندوب لتمويل البديل؛ يُطلب فرق الزيادة فقط. يرتبط التخصيص بسجل `cash_refund` كرصيد مستقل عن رصيد المورد الذي استُهلك في الاسترداد، ويُمنع تخصيص المبلغ مرتين. لا SQL جديد لهذا الربط.
- احتساب اكتمال احتياج المسار B أصبح مبنيًا على كمية اللوت الأصلية وصافي سندات التسليم والتعويض النسبي من البديل، مع تحقق الوحدات وحد 500 معرف للاستعلام. لا يكفي علم حالة الصنف ولا استلام المستودع وحدهما. اختبارات المرتجعات 229 ناجحة، والمشتركة 399 ناجحة.
- **المتبقي قبل التفعيل:** قبول حي للتعويض المرتبط باحتياج صيانة، واستكمال adapters مصادر الفرق/PMV2/الصرف التشغيلي عند البديل المختلف؛ لا يُعد فحص Path B القديم إثباتًا لهذه المصادر. لا تفعيل `cmms` ولا نشر بواسطة الوكيل في هذه الجولة. الصرف التشغيلي وكشف الإكسل لهما قبول حي منفصل كما سبق.

### تحديث 2026-10-30 — قبول المصادر المرتبطة والصرف الجماعي على COPYCMMS2

- أُغلقت فجوة استلام/صرف البديل المختلف للفرق وPMV2 والتشغيل: يبقى الأصل باسمه وصنفه وكميته، وتُحمل لوتات البديل المعتمدة المستلمة فقط كتلبية له. كميات السند والاستخدام والمرتجع والتكلفة فعلية بوحدة البديل؛ نسبة الخطة تحسب تقدم الاحتياج فقط. لا SQL إضافي.
- نجحت الدورات الحية عبر RPC المصادق عليه على `localhost:4002`/`copycmms2`: تشغيل OPR-2026-000004/مرتجع240005؛ فريق MT-2026-00644-01/مرتجع240006؛ وPMV2 مهمة180052/مرتجع240007. في الفريق وPMV2: الأصل4 والبديل6، المستخدم5 والمرتجع1، والأصل محفوظ. أعيد إكمال العمليتين دون سندات أو حركات مكررة. التسعير والشراء وقبول المرتجع بحساب المندوب، والاعتمادان والاستلام باستثناء المالك القائم، لا بحسابَي محاسب وإدارة منفصلين.
- نجح صرف عادي جديد من متصفح المستودع OPR-2026-000003 ببندين وسياقين ومستلمين: FIFO، زر تأكيد واحد، المستلم الفعلي أو الافتراضي، وسندان بصافي5.40ر.س. ظهر البديل وتكلفته في قائمة الصرف، وظهر في البلاغ الأصل4 وتحته استخدام البديل5 ومرتجعه1. تم بدء إصلاح البلاغ القديم MT-2026-00571-01 بعد تعويضه وتسليمه فعليًا.
- عُطلت المجدولات وweb push في عملية الاختبار فقط، مع فحص اسم القاعدة قبل الإقلاع. أوقف البرنامجان التجريبيان60001 و60002 عبر API بعد القبول، وحُفظ التاريخ. لا DDL/SQL كتابة، ولا تعديل بيئة الإنتاج أو تفعيل المفتاح أو نشر. كشف الإكسل المؤجل لم يُصرف.
- التحقق النهائي: مجموعة المرتجعات274، التشغيل216، نطاق القراءات399، عرض المواد22، وبناء الإنتاج ناجح. أغلقت حالات المزج الدقيق بين الأصل والبديل وتعدد الخطط، ومنع حساب لوت البديل مرتين إن كان بنفس الصنف، وحماية حصة احتياج الفريق من الكمية الزائدة المشتراة للمستودع. TypeScript العام غير نظيف بتاريخ سابق؛ لا إعلان نظافة كل المشروع.
- قرار منفصل لا يزال معلقًا: هل تُدعم إعادة إرجاع البديل نفسه ثم تعويضه مجددًا على الاحتياج الأصلي؟ لا يُنسب قبول حي لهذا السيناريو ولا تُفعّل الميزة على `cmms` تلقائيًا. التفاصيل والأرقام وحدود الأدلة: `docs/runtime-uat/2026-10-30-compensation/RESULTS.md`.

### تحديث 2026-10-31 — إصلاح وحدة المواد الحالي

- نُفذ اختيار وحدة الكتالوج تلقائيًا للفني في الفرق/IT وPMV2، واعتماد المستودع للكمية بهذه الوحدة عند ربط المادة النصية، ومراجعة نفس الصنف عند وجود اختلاف وحدة قديم قبل أي حركة مواد. الوصف والكمية والوحدة الأصلية محفوظة في سجل الإجراءات. لا SQL جديد ولا تعديل لأرصدة أو فواتير سابقة.
- بقي تحويل عبوة المورد عند الاستلام كما هو. نجحت الاختبارات المعزولة للمسارات والواجهات والصرف والمرتجعات والصلاحيات؛ تقرير البناء والقبول الحي في `docs/runtime-uat/2026-10-31-material-units/RESULTS.md`. لا إعلان نشر أو تفعيل على الإنتاج.
- اكتمل بناء الإنتاج وقبول ربط مادة جديدة من متصفح المستودع على copycmms2 في MT-2026-00645-01: وحدةقطعة وكمية1 وانتقال لجاهزة للصرف مع أثر المراجعة. لم يُنفذ صرف تجريبي جديد ولم تعدل بيانات المستخدم القديمة؛ الصنف الذي لا توجد له وحدة بالكتالوج يحتاج استكمال تعريفه أولًا. مسار PMV2 وتصحيح الاختلاف السابق مغطّيان باختبارات معزولة.
- قرار المستخدم للمرتجعات المتتابعة: يؤجل تعويض البديل المرتجع مرة ثانية، ويُمنع برسالة واضحة عند استئناف هذا الجزء. فُحص الموضع فقط ثم أوقف المستخدم تطويره لحل مشكلة الوحدة الحالية؛ تنفيذ الحارس ما زال معلقًا، ولا يُستأنف تلقائيًا. كشف الإكسل أيضًا مؤجل.

### تحديث 2026-11-01 — دفاتر أصناف الكتالوج

- نُفذ محليًا الربط دون دمج مخزون قديم، وعرض الدفتر وأوراقه ولوتاته وإجماليات الوحدات، والبحث بالأسماء المرتبطة، والصرف العام FIFO/يدوي والتحويل العام واختيار لوت المرتجع مع المورد وتاريخ الشراء. لا توسعة للصلاحيات أو لدورة تعويض المرتجعات أو تحويلات احتياجات الفرق/PMV2 الخاصة.
- نجحت88حالة للدفاتر،399نطاق قراءات،274مرتجعات،216تشغيل،28استلام شراء وبناء الإنتاج. تمت معاينة معزولة ببيانات وهمية. لا SQL جديد مطلوب؛ لا اتصال أو تعديل بيانات قاعدة أو نشر في هذه الجولة.
- قبول التشغيل الحي لهذه الإضافة على قاعدة معتمدة لم يجرَ بعد؛ لا تُنسب المعاينة الوهمية إلى cmms أو copycmms2. راجع `docs/inventory-books/2026-11-01/RESULTS.md` للحدود. كشف الإكسل والتعويض المتتابع المعلّقان يبقيان متوقفين.

### تحديث 2026-11-01 — اعتماد حزمة DPB مرة واحدة

- نُفذ أصل اعتماد واحد للحزم المرسلة مستقبلًا عند التفعيل: الحسابات تسجل رصيد العهد الحر مرة واحدة، والإدارة تعتمد الحزمة نفسها؛ الرفض والأثر والشراء على مستوى الصنف مع بقاء المصادر الأصلية. PDF المالي مرتبط بالأصل النهائي، وملف المندوب المجمد محفوظ.
- نجحت351حالة DPB/مستندات/واجهة،401نطاق قراءات،274مرتجعات وبناء الإنتاج النهائي. مراجع الاختبار وحدود TypeScript والاختبارات القديمة غير القابلة للتشغيل في الحاضنة في `docs/unified-dpb-approval/2026-11-01/RESULTS.md`.
- **متبقٍ:** ينفذ المستخدم `drizzle/2026_11_01_dpb_unified_approval_copycmms2_manual.sql` يدويًا ثم يرسل SHOW CREATE. بعدها تفعيل خدمة التجربة فقط واختبار مندوب/حسابات/إدارة منفصلين والرفض الجزئي والشراء والاستلام وPDF والشراء العادي. لا قبول حي ولا تفعيل cmms أو نشر حتى ذلك؛ لا ترحيل للحزم القديمة. كشف الإكسل والتعويض المتتابع وقبول دفاتر المخزون خارج هذه الجولة.

### تحديث لاحق 2026-11-01 — نتائج تجربة المستخدم وتبسيط مراجعة DPB

- نفّذ المستخدم الجدول وأرسل SHOW CREATE المطابق وفُعّل المفتاح محليًا. ثم اختبر نسخة نشرها بنفسه على خدمة Railway مستقلة. قراءة بحساب الحسابات أثبتت خطأ تمثيل الوحدة الفارغة في DPB10 وخطأ متابعة اعتماد الحسابات في DPB11؛ لم ينفذ الوكيل قرارًا ماليًا في الموقع.
- بطلب المستخدم، صارت شاشة المراجعة للحزمة المختارة وحدها، مع زر اعتماد/إرسال واحد والرجوع للقائمة بعد النجاح، وإخفاء ما رفضته الحسابات من شاشة الإدارة فقط. أُصلح الخطآن واستئناف القرارات المحفوظة تلقائيًا لصاحب القرار نفسه، دون تعميم صلاحيات المحاسب أو تكرار التمويل. لا SQL جديد.
- اختبارات DPB366 ونطاق القراءة401 وبناء الإنتاج ناجحة. يلزم نشر هذا التصحيح ثم اختبار المستخدم للحزمتين10و11 ولحزمة جديدة حتى الشراء والاستلام والمستندات؛ لا يُنسب هذا التصحيح إلى نسخة Railway الحالية قبل نشره. التقرير: `docs/unified-dpb-approval/2026-11-01/FOCUSED_REVIEW.md`.
- نقص زر DPB في شاشة «دورة الشراء» منفصل ولم يُعدل الآن. يبقى كشف الإكسل وتعويض البديل المتتابع وقبول دفاتر المخزون ضمن البنود المؤجلة السابقة.

### تحديث 2026-11-01 — نموذج وثيقة DPB المعتمدة

- أصبح تنسيق وثيقة DPB المعتمدة يتبع نموذج PB المالي الذي أرفقه المستخدم، مع بقاء التجميع وأثر الرفض ونسخة المندوب وشرط اعتماد الإدارة دون تعديل. نجحت368 حالة معزولة والبناء، وروجعت معاينتا A4 بثلاثة و20صنفًا بصريًا. التفاصيل: `docs/pricing-bundle-approved-document/2026-11-01/REFERENCE_FORM.md`.
- **متبقٍ للنشر:** ينشر المستخدم النسخة ثم يختبر تنزيل وطباعة وثيقة معتمدة من مركز المستندات، ويتأكد من بيانات المعتمدين الفعلية وبقاء تنزيل المندوب الأصلي. لا SQL جديد، ولم يحصل نشر أو اختبار مستند حي في هذه الجولة. بقية البنود المؤجلة محفوظة.

### تحديث 2026-11-02 — قارئ الوثائق المعتمدة وتفاصيل التوقيع

- نُفذ تبويب «حزم التسعير المعتمدة» لحسابي `ANIS` و`ahmed1` وللأدمن والمالك بصلاحية قائمة/استعراض/طباعة فقط بعد اكتمال الإدارة، مع حارس مركزي وفحص الحساب الحالي وجميع أعضاء الوثيقة عند كل فتح. بقيت صلاحيات الأدوار والتبويبات السابقة. لا SQL أو متغير بيئة جديد.
- بتوجيه المستخدم أصبح توقيع الحسابات بلا عبارة/تاريخ إلكتروني في PDF، واسم الرئيس التنفيذي ثابتًا عريضًا وتوقيعه فارغًا، ومراجع الطلب بلا سطر أرقام PR. سجلات الاعتماد ونسخة المندوب لم تتغير.
- نجحت368حالة للقارئ/المستندات و401للنطاق المشترك وبناء الإنتاج، وروجعت معاينة PDF بصريًا. **المتبقي التشغيلي:** نشر المستخدم ثم تسجيل دخول الحسابين والأدمن/المالك وتجربة الاستعراض والطباعة لوثيقة معتمدة وحجب المعلقة. لم يتصل الوكيل بقاعدة ولم ينفذ SQL أو ينشر. التقرير: `docs/approved-pricing-documents/2026-11-02/RESULTS.md`. كشف الإكسل والتعويض المتتابع والقبولات المؤجلة السابقة لم تستأنف.

### تحديث 2026-11-02 — تنظيم مركز المستندات

- نُفذ تنظيم العرض المتفق عليه: ثلاث مجموعات رئيسية بحسب المتاح للدور، وقائمة نوع واحدة، وبحث واحد وتصفية مطوية وعدد فعلي وإجراءات متسقة. حسابا ANIS وahmed1 يبدآن بحزم DPB المعتمدة؛ يبقى المحاسب والإدارة على قارئهما وصلاحياتهما السابقة، ولا تضاف أي صلاحية خادمية. القوالب وقواعد الاعتماد والسندات الأصلية محفوظة.
- نجحت395حالة بالمشغل المعزول و401للنطاق المشترك والبناء، ومعاينة Chromium للمكونات الفعلية على الكمبيوتر والجوال ببيانات وهمية. **متبقٍ بعد النشر:** قبول المستخدم للتنظيم في الموقع بحساباته الفعلية، والاستعراض والتنزيل والطباعة. لا SQL أو تغيير بيئة أو بيانات أو نشر من الوكيل. التقرير: `docs/documents-center/2026-11-02/ORGANIZATION.md`. لا استئناف للأعمال المؤجلة الأخرى.
