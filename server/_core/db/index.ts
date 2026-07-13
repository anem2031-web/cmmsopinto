// ============================================================
// db/index.ts — نقطة التجميع: تعيد تصدير كل وحدات قاعدة البيانات
// كل الاستيرادات القديمة  import * as db from "../_core/db"  تعمل كما هي
// ============================================================
export * from "./client";
export * from "./users";
export * from "./purchase";
export * from "./org";
export * from "./tickets";
export * from "./inventory";
export * from "./notifications";
export * from "./audit";
export * from "./reports";
export * from "./attachments";
export * from "./deletes";
export * from "./backups";
export * from "./assets";
export * from "./preventive";
export * from "./warehouse-receipts";
export * from "./warehouse-returns";
export * from "./invoice-drafts";
