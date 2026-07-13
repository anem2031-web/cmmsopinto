// ============================================================
// db/client.ts — اتصال قاعدة البيانات (Pool) والمعاملات
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, purchaseOrders, purchaseOrderItems,
  inventory, inventoryTransactions, notifications, auditLogs,
  ticketStatusHistory, attachments, sites, backups,
  assets, preventivePlans, pmWorkOrders, assetSpareParts, pmJobs, assetMetrics,
  pmChecklistItems, pmWorkOrderBranches,
  twoFactorSecrets, twoFactorAuditLogs,
  pushSubscriptions, sections, technicians, inspectionResults,
  type InsertAsset, type InsertPreventivePlan, type PreventivePlan, type InsertPMWorkOrder,
  type InsertSection, type InsertInspectionResult,
  assetCategories,
  procurementComments,
  type InsertProcurementComment,
  warehouseReceipts,
  warehouseReturns,
  warehouseReceiptItems,
  ocrJobs,
  type InsertWarehouseReceipt,
  type InsertWarehouseReturn,
  ticketConfirmations,
  type InsertTicketConfirmation,
  deliveryDocuments,
  returnDocuments,
  deliveryNumberCounter,
  itemBarcodeCounter,
  disposalOperations,
  disposalItems,
  disposalNumberCounter,
  poPricingBatches,
  type InsertPOPricingBatch,
  inventoryCountOperations,
  inventoryCountItems,
  inventorySettlements,
  inventorySettlementItems,
  inventoryCountNumberCounter,
  inventorySettlementNumberCounter,
} from "../../../drizzle/schema";
import { ENV } from '../env';



let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // استخدام Pool بدل اتصال واحد — يعيد الاتصال تلقائياً عند الانقطاع
      _pool = mysql.createPool({
        uri:                process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit:    10,
        queueLimit:         0,
        enableKeepAlive:    true,
        keepAliveInitialDelay: 30000,
        connectTimeout:     60000,
      });
      _db = drizzle(_pool as any);
      console.log("[Database] Pool created successfully");
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db   = null;
      _pool = null;
    }
  }
  return _db;
}

// ─────────────────────────────────────────────────────────────
// تنفيذ مجموعة عمليات ضمن معاملة DB واحدة (Atomicity)
// أي دالة تُستدعى داخل fn يجب أن تستقبل ويستخدم نفس الـ tx الممرَّر
// (وإلا فهي تعمل على اتصال منفصل من الـ Pool ولا تكون جزءاً من المعاملة)
// عند فشل أي خطوة، تُلغى (rollback) كل الكتابات السابقة داخل نفس fn تلقائياً
// ─────────────────────────────────────────────────────────────
export async function withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const database = await getDb();
  if (!database) throw new Error("قاعدة البيانات غير متاحة");
  return database.transaction(fn);
}

// إعادة الاتصال عند انقطاع ECONNRESET
export async function resetDb() {
  console.warn("[Database] Resetting connection pool...");
  try { await _pool?.end(); } catch {}
  _db   = null;
  _pool = null;
  return getDb();
}

// معالجة أخطاء الاتصال تلقائياً
process.on("uncaughtException", async (err: any) => {
  if (err?.code === "ECONNRESET" || err?.cause?.code === "ECONNRESET") {
    console.warn("[Database] ECONNRESET detected — resetting pool...");
    await resetDb();
  }
});

