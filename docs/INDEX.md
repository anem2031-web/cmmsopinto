# فهرس المشروع — نظام إدارة الصيانة (CMMS)

> تم تنظيم المشروع حسب **المجال الوظيفي (Domain)**: كل جزء يخدم نفس الهدف التجاري/الوظيفي مجمّع في مكان واحد، في الواجهة والخادم معاً.
> آخر تحديث للبنية: 2026-07-12

---

## 1) الخريطة العامة

| المسار | الوصف |
|---|---|
| `client/` | تطبيق الواجهة (React + Vite + Tailwind + tRPC client) |
| `server/` | الخادم (tRPC + Drizzle ORM + MySQL) |
| `shared/` | أنواع وثوابت مشتركة بين الواجهة والخادم (`@shared/*`) |
| `drizzle/` | مخطط قاعدة البيانات (`schema.ts`) وملفات الترحيل SQL |
| `scripts/` | سكربتات الصيانة والترحيل والتهيئة (seed) |
| `scanner-helper/` | أداة مساعدة سطح المكتب للماسح الضوئي |
| `docs/` | الوثائق والتقارير والأرشيف (هذا الملف هنا) |
| `.github/workflows/` | خطوط CI (فحص الأنواع + البناء) |

**أسماء الاستيراد (Aliases):** `@/*` → `client/src/*` — `@shared/*` → `shared/*`

---

## 2) المجالات الوظيفية (Domains)

كل مجال له — حيثما ينطبق — راوتر في الخادم، وصفحات ومكوّنات في الواجهة:

| المجال | الوصف | راوترات الخادم | صفحات الواجهة | مكوّنات الواجهة |
|---|---|---|---|---|
| **auth** | المصادقة والجلسات | `server/routers/auth/` | `pages/auth/` (Login) | `components/auth/` |
| **users** | إدارة المستخدمين والأدوار | `server/routers/users/` | `pages/admin/Users` | — |
| **tickets** | البلاغات/الصيانة التصحيحية ودورة عملها | `server/routers/tickets/` | `pages/tickets/` | `components/tickets/` (SLATimer, TechnicianCombobox) |
| **preventive** | الصيانة الوقائية (خطط PM وتنفيذها) | `server/routers/system/preventive.router.ts` | `pages/preventive/` | `components/preventive/` (BranchTree) |
| **assets** | الأصول: سجل، تصنيفات، تاريخ، NFC/مسح | `server/routers/assets/` | `pages/assets/` | — |
| **inventory** | المخزون والمستودعات: استلام، إرجاع، جرد، تحويلات | `server/routers/inventory/` | `pages/inventory/` | `components/inventory/` |
| **purchase** | المشتريات: أوامر الشراء، الموافقات، المورّدون | `server/routers/purchase/` | `pages/purchase/` | — |
| **catalog** | كتالوج الأصناف والوحدات والتصنيفات والمورّدين | `server/routers/catalog/` | `pages/catalog/` | `components/catalog/` |
| **construction** | مشاريع الإنشاءات: مراحل، مهام، Gantt/Kanban | `server/routers/construction/` | `pages/construction/` | `components/construction/` |
| **reports** | التقارير والتحليلات (تكلفة، دورات، أقسام…) | `server/routers/reports/` | `pages/reports/` | — |
| **notifications** | الإشعارات وWeb Push | `server/routers/notifications/` | `pages/admin/Notifications` | — |
| **ai** | المساعد الذكي، الصور، الصوت، LLM | `server/routers/ai/` | `pages/ai/` | `components/ai/` (AIChatBox) |
| **translation** | نظام الترجمة الآلية للمحتوى | `server/routers/translation/` | `pages/admin/TranslationMonitor` | — |
| **improvement** | مركز التحسين والتطوير (الأفكار) | `server/routers/improvement-ideas/` | `pages/improvement/` | — |
| **sites / sections / technicians** | المواقع والأقسام والفنيون | `server/routers/{sites,sections,technicians}/` | `pages/admin/` | — |
| **system** | لوحة التحكم، KPI، التدقيق، النسخ الاحتياطي | `server/routers/system/` | `pages/dashboard/`, `pages/admin/` | `components/dashboard/` |
| **uploads** | رفع الملفات والمرفقات | `server/routers/uploads/` | — | `components/common/DropZone` |

---

## 3) بنية الخادم `server/`

```
server/
├── _core/                  # البنية التحتية المشتركة (ليست مجالاً وظيفياً)
│   ├── index.ts            # نقطة تشغيل الخادم (Express + tRPC + مسارات PDF)
│   ├── db/                 # طبقة الوصول لقاعدة البيانات — مقسّمة حسب المجال:
│   │   ├── index.ts        #   نقطة التجميع (كل استيرادات ../_core/db القديمة تعمل كما هي)
│   │   ├── client.ts       #   الاتصال (Pool) + withTransaction + resetDb
│   │   ├── users.ts        #   المستخدمون + المصادقة الثنائية (2FA)
│   │   ├── org.ts          #   المواقع والأقسام والفنيون
│   │   ├── tickets.ts      #   البلاغات وسجل حالاتها وتأكيداتها
│   │   ├── purchase.ts     #   أوامر الشراء وبنودها ودفعات التسعير
│   │   ├── inventory.ts    #   المخزون والبحث بالباركود
│   │   ├── warehouse-receipts.ts / warehouse-returns.ts / invoice-drafts.ts
│   │   ├── assets.ts       #   الأصول: السجل، RFID، الفحوص، الفئات، المؤشرات
│   │   ├── preventive.ts   #   خطط PM والشجرة وأوامر العمل
│   │   ├── notifications.ts / audit.ts / reports.ts / attachments.ts
│   │   └── deletes.ts / backups.ts
│   ├── storage.ts          # التخزين السحابي للملفات (S3-متوافق)
│   ├── trpc.ts / context.ts / systemRouter.ts
│   ├── cache.ts / rateLimiter.ts / cookies.ts / env.ts / config.ts
│   ├── llm.ts / imageGeneration.ts / voiceTranscription.ts / map.ts
│   ├── oauth.ts / twoFactor.ts / twoFactorEnforcement.ts
│   └── notification.ts / sdk.ts / dataApi.ts / vite.ts
│
├── routers/                # واجهات tRPC مقسّمة حسب المجال
│   ├── index.ts            # تجميع كل الراوترات في appRouter
│   ├── _shared/            # middleware، صلاحيات، إجراءات، validators مشتركة
│   ├── auth/  users/  sites/  sections/  technicians/
│   ├── tickets/            # مقسّم داخلياً: workflow, approvals, closure, external…
│   ├── assets/             # assets, categories, history, documents, nfc, inspection
│   ├── inventory/          # stock, receipts(+v2), returns, transfers, disposal, count…
│   ├── purchase/           # purchase-orders, approvals, vendors, delivery-documents
│   ├── catalog/            # catalog.router + catalogImportExport.router
│   ├── construction/       # projects, phases, tasks, activities…
│   ├── reports/            # analytics + تقارير الصيانة/الشراء/المخزون
│   ├── notifications/  uploads/  ai/  translation/
│   ├── improvement-ideas/
│   └── system/             # dashboard, kpi, audit, backups, preventive
│
├── services/               # منطق الأعمال المعقد حسب المجال
│   ├── pdf/                # توليد PDF: تذاكر، أوامر عمل PM، سير العمل + محرك HTML→PDF
│   ├── export/             # exportService: تصدير البيانات (Excel/ملفات)
│   ├── translation/        # translationEngine + خدمة الترجمة
│   ├── notifications/      # webPush: إشعارات المتصفح
│   ├── catalog/            # استيراد/تصدير/تحقق الكتالوج
│   ├── ocr/                # OCR للفواتير
│   └── improvement-ideas/  # وصول قاعدة بيانات مركز التحسين
│
├── jobs/                   # المهام المجدولة (cron): pm-automation, sla-overdue-push…
├── tests/                  # كل اختبارات Vitest (كانت مبعثرة في جذر server/)
└── fonts/                  # خطوط توليد PDF
```

## 4) بنية الواجهة `client/src/`

```
client/src/
├── main.tsx / App.tsx      # نقطة الدخول + تعريف المسارات (wouter)
├── pages/                  # الصفحات حسب المجال
│   ├── auth/  dashboard/  tickets/  preventive/  assets/
│   ├── inventory/  purchase/  catalog/  construction/
│   ├── reports/  improvement/  ai/  admin/  dev/
│   └── NotFound.tsx        # صفحة 404 العامة
├── components/
│   ├── ui/                 # مكتبة shadcn/ui الأساسية (أزرار، جداول، نوافذ…)
│   ├── layout/             # DashboardLayout + الهيكل العام
│   ├── common/             # مكوّنات عامة: ErrorBoundary, Map, DropZone, BarcodeScanner…
│   └── {domain}/           # مكوّنات خاصة بكل مجال (catalog, construction, tickets…)
├── hooks/  _core/hooks/    # الخطافات المشتركة (useAuth, usePushNotifications…)
├── contexts/               # اللغة والثيم
├── i18n/                   # الترجمات: ar / en / ur
├── lib/                    # trpc client + أدوات مساعدة
└── types/                  # تعريفات أنواع إضافية
```

## 5) قاعدة البيانات والوثائق والسكربتات

- **المخطط:** `drizzle/schema.ts` (+ `schema.additions.ts`, `relations.ts`) — **الترحيلات:** `drizzle/00xx_*.sql` — التطبيق: `pnpm db:push`
- **الوثائق:** `docs/ARCHITECTURE.md` (المعمارية)، `docs/ROLLBACK.md`، `docs/INVENTORY_ROADMAP.md`، `docs/todo.md`، تقارير المراحل في `docs/reports/`، ملفات قديمة/مهملة في `docs/archive/`
- **السكربتات:** `scripts/` — تهيئة المدير (`seed-admin.mjs` القياسي، و`seed-admin.env.mjs` النسخة الآمنة بمتغير بيئة `ADMIN_SEED_PASSWORD`)، بذر البيانات `seed-db.mjs`، وسكربتات ترحيل/تحقق FK

## 6) أوامر التشغيل

| الأمر | الوظيفة |
|---|---|
| `pnpm dev` | تشغيل التطوير (خادم + واجهة) |
| `pnpm build` | بناء الإنتاج (vite + esbuild → `dist/`) |
| `pnpm start` | تشغيل نسخة الإنتاج |
| `pnpm check` | فحص أنواع TypeScript |
| `pnpm test` | تشغيل الاختبارات (`server/tests/`) |
| `pnpm db:push` | توليد وتطبيق ترحيلات قاعدة البيانات |

## 7) ملاحظات إعادة الهيكلة (2026-07-12)

- نُقلت 115 ملفاً وحُدّثت الاستيرادات في 130 ملفاً آلياً؛ تم التحقق ببناء كامل ناجح (`pnpm build`) ومقارنة أخطاء `tsc` مع النسخة الأصلية (لا أخطاء استيراد جديدة).
- `server/routers.ts.backup.ts` القديم نُقل إلى `docs/archive/` (كان يضيف 36 خطأ نوع للفحص).
- خطأ `server/_core/sdk.ts → ./types/manusTypes` **موجود قبل إعادة الهيكلة** (ملف مفقود أصلاً) ولم يُعالج.
- أخطاء الأنواع المتبقية في `pnpm check` (نحو 160) كلها موجودة في النسخة الأصلية وليست ناتجة عن النقل.

## 8) تقسيم طبقة قاعدة البيانات (2026-07-13)

- `server/_core/db.ts` (4714 سطراً، 233 دالة) قُسّم إلى **17 وحدة مجالية** داخل `server/_core/db/`.
- التوافق الخلفي كامل: `db/index.ts` يعيد تصدير كل شيء، فكل الملفات المستهلكة (55+ بنمط `import * as db` و19 بنمط `getDb`) تعمل **بدون أي تعديل**.
- الاعتماديات المتقاطعة بين الوحدات (9 معرّفات مثل `getDb` و`withTransaction` و`buildTicketsWhere`) حُوّلت لاستيرادات صريحة بين الوحدات.
- تم التحقق: بناء إنتاج ناجح + مقارنة أخطاء `tsc` قبل/بعد (لا فرق حقيقي).
