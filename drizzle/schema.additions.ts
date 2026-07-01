// ============================================================
// schema.additions.ts
// أضف هذه التعريفات في نهاية ملف drizzle/schema.ts
// ============================================================

import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, json, boolean, date, index } from "drizzle-orm/mysql-core";

// ── أنواع الأصناف ──────────────────────────────────────────
export const itemTypes = ["spare_part", "consumable", "tool", "food"] as const;
export type ItemType = typeof itemTypes[number];

// ── أنواع المخازن ───────────────────────────────────────────
export const warehouseTypes = ["main", "project", "branch", "kitchen"] as const;
export type WarehouseType = typeof warehouseTypes[number];

// ── أنواع حركات المخزون الموسّعة ────────────────────────────
export const transactionTypesV2 = [
  "purchase",
  "issue",
  "transfer",
  "disposal",
  "return_to_vendor",
  "return_internal",
  "adjustment",
  "delivery",
] as const;

// ============================================================
// WAREHOUSES - جدول المخازن الهرمي
// ============================================================
export const warehouses = mysqlTable("warehouses", {
  id:        int("id").autoincrement().primaryKey(),
  code:      varchar("code", { length: 20 }).notNull().unique(),
  nameAr:    varchar("nameAr", { length: 200 }).notNull(),
  nameEn:    varchar("nameEn", { length: 200 }),
  type:      mysqlEnum("type", [...warehouseTypes]).notNull().default("main"),
  parentId:  int("parentId"),
  siteId:    int("siteId"),
  projectId: int("projectId"),
  isActive:  boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Warehouse = typeof warehouses.$inferSelect;
export type InsertWarehouse = typeof warehouses.$inferInsert;

// ============================================================
// WAREHOUSE RECEIPT ITEMS - بنود فاتورة الاستلام
// ============================================================
export const warehouseReceiptItems = mysqlTable("warehouse_receipt_items", {
  id:                   int("id").autoincrement().primaryKey(),
  receiptId:            int("receiptId").notNull(),
  inventoryId:          int("inventoryId"),
  purchaseOrderItemId:  int("purchaseOrderItemId"),
  itemName:             varchar("itemName", { length: 300 }).notNull(),
  itemName_ar:          text("itemName_ar"),
  itemName_en:          text("itemName_en"),
  receivedQuantity:     decimal("receivedQuantity", { precision: 12, scale: 3 }).notNull(),
  purchaseUnit:         varchar("purchaseUnit", { length: 50 }),
  unitCost:             decimal("unitCost", { precision: 12, scale: 4 }).notNull().default("0"),
  taxRate:              decimal("taxRate", { precision: 5, scale: 2 }).notNull().default("15"),
  taxAmount:            decimal("taxAmount", { precision: 12, scale: 2 }).notNull().default("0"),
  lineTotal:            decimal("lineTotal", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedQuantity:     decimal("expectedQuantity", { precision: 12, scale: 3 }),
  quantityDiff:         decimal("quantityDiff", { precision: 12, scale: 3 }),
  expectedUnitCost:     decimal("expectedUnitCost", { precision: 12, scale: 4 }),
  priceDiff:            decimal("priceDiff", { precision: 12, scale: 4 }),
  ocrExtracted:         boolean("ocrExtracted").notNull().default(false),
  manuallyEdited:       boolean("manuallyEdited").notNull().default(false),
  createdAt:            timestamp("createdAt").defaultNow().notNull(),
});
export type WarehouseReceiptItem = typeof warehouseReceiptItems.$inferSelect;
export type InsertWarehouseReceiptItem = typeof warehouseReceiptItems.$inferInsert;

// ============================================================
// OCR JOBS - تتبع عمليات تحليل الفواتير بالذكاء الاصطناعي
// ============================================================
export const ocrJobStatuses = ["pending", "processing", "completed", "failed"] as const;

export const ocrJobs = mysqlTable("ocr_jobs", {
  id:              int("id").autoincrement().primaryKey(),
  receiptId:       int("receiptId"),
  purchaseOrderId: int("purchaseOrderId"),
  status:          mysqlEnum("status", [...ocrJobStatuses]).notNull().default("pending"),
  imageUrl:        text("imageUrl").notNull(),
  rawResponse:     json("rawResponse"),
  extractedData:   json("extractedData").$type<OcrExtractedData>(),
  confidence:      decimal("confidence", { precision: 5, scale: 2 }),
  errorMessage:    text("errorMessage"),
  processingMs:    int("processingMs"),
  createdById:     int("createdById").notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  completedAt:     timestamp("completedAt"),
});
export type OcrJob = typeof ocrJobs.$inferSelect;

// نوع البيانات المستخرجة من OCR
export interface OcrExtractedData {
  vendorName?:      string;
  vendorNameEn?:    string;
  vendorTaxNumber?: string;
  invoiceNumber?:   string;
  invoiceDate?:     string;
  subtotal?:        number;
  taxAmount?:       number;
  grandTotal?:      number;
  items: OcrExtractedItem[];
}

export interface OcrExtractedItem {
  itemName:         string;
  itemNameEn?:      string;
  quantity:         number;
  unit?:            string;
  unitPrice:        number;
  taxRate?:         number;
  taxAmount?:       number;
  lineTotal:        number;
  confidence?:      number;
  existsInSystem?:  boolean;
  matchedItemId?:   number;
  suggestedItemId?: number;
}
