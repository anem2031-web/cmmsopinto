import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, json, boolean, date, index } from "drizzle-orm/mysql-core";

// ============================================================
// 1. USERS TABLE (extended with CMMS roles)
// ============================================================
export const userRoles = ["operator", "technician", "maintenance_manager", "supervisor", "purchase_manager", "purchase_requester", "delegate", "accountant", "senior_management", "executive_director", "warehouse", "gate_security", "owner", "food_warehouse_manager", "food_warehouse_assistant"] as const;
export type UserRole = typeof userRoles[number];

export const supportedLanguages = ["ar", "en", "ur"] as const;
export type SupportedLanguage = typeof supportedLanguages[number];

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 100 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", ...userRoles]).default("user").notNull(),
  department: varchar("department", { length: 100 }),
  preferredLanguage: mysqlEnum("preferredLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// 2. SITES / LOCATIONS
// ============================================================
export const sites = mysqlTable("sites", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  nameEn: varchar("nameEn", { length: 200 }),
  nameUr: varchar("nameUr", { length: 200 }),
  address: text("address"),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// 2b. SECTIONS (sub-divisions of sites)
// ============================================================
export const sections = mysqlTable("sections", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  nameEn: varchar("nameEn", { length: 200 }),
  nameUr: varchar("nameUr", { length: 200 }),
  description: text("description"),
  siteId: int("siteId").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Section = typeof sections.$inferSelect;
export type InsertSection = typeof sections.$inferInsert;

// ============================================================
// 2c. TECHNICIANS
// ============================================================
export const technicianStatuses = ["active", "inactive"] as const;
export const technicians = mysqlTable("technicians", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  nameEn: varchar("nameEn", { length: 200 }),
  nameUr: varchar("nameUr", { length: 200 }),
  specialty: varchar("specialty", { length: 200 }),
  specialtyEn: varchar("specialtyEn", { length: 200 }),
  specialtyUr: varchar("specialtyUr", { length: 200 }),
  status: mysqlEnum("status", [...technicianStatuses]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Technician = typeof technicians.$inferSelect;
export type InsertTechnician = typeof technicians.$inferInsert;

// ============================================================
// 3. MAINTENANCE TICKETS
// ============================================================
export const ticketStatuses = [
  "new",
  "pending_triage", "under_inspection", "work_approved",
  "ready_for_closure",
  "approved", "assigned", "in_progress",
  "needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting",
  "purchase_pending_management", "purchase_approved", "partial_purchase",
  "purchased", "received_warehouse",
  "out_for_repair",
  "repaired", "verified", "closed",
  "requester_confirmed"
] as const;
export type TicketStatus = typeof ticketStatuses[number];

export const ticketPriorities = ["low", "medium", "high", "critical"] as const;
export const ticketCategories = ["electrical", "plumbing", "hvac", "structural", "mechanical", "general", "safety", "cleaning"] as const;

export const tickets = mysqlTable("tickets", {
  id: int("id").autoincrement().primaryKey(),
  ticketNumber: varchar("ticketNumber", { length: 20 }).notNull().unique(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", [...ticketStatuses]).default("new").notNull(),
  priority: mysqlEnum("priority", [...ticketPriorities]).default("medium").notNull(),
  category: mysqlEnum("category", [...ticketCategories]).default("general").notNull(),
  siteId: int("siteId"),
  sectionId: int("sectionId"),
  assetId: int("assetId"),
  locationDetail: varchar("locationDetail", { length: 300 }),
  reportedById: int("reportedById").notNull(),
  assignedToId: int("assignedToId"),
  assignedTechnicianId: int("assignedTechnicianId"),
  assignedAt: timestamp("assignedAt"),
  approvedById: int("approvedById"),
  maintenancePath: mysqlEnum("maintenancePath", ["A", "B", "C"]),
  ticketType: mysqlEnum("ticketType", ["internal", "external", "procurement"]),
  supervisorId: int("supervisorId"),
  inspectionNotes: text("inspectionNotes"),
  justification: text("justification"),
  triageNotes: text("triageNotes"),
  gateExitApprovedById: int("gateExitApprovedById"),
  gateExitApprovedAt: timestamp("gateExitApprovedAt"),
  gateEntryApprovedById: int("gateEntryApprovedById"),
  gateEntryApprovedAt: timestamp("gateEntryApprovedAt"),
  externalRepairCompletedAt: timestamp("externalRepairCompletedAt"),
  externalRepairCompletedById: int("externalRepairCompletedById"),
  beforePhotoUrl: text("beforePhotoUrl"),
  afterPhotoUrl: text("afterPhotoUrl"),
  repairNotes: text("repairNotes"),
  materialsUsed: text("materialsUsed"),
  estimatedCost: decimal("estimatedCost", { precision: 12, scale: 2 }),
  actualCost: decimal("actualCost", { precision: 12, scale: 2 }),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  title_ar: text("title_ar"),
  title_en: text("title_en"),
  title_ur: text("title_ur"),
  description_ar: text("description_ar"),
  description_en: text("description_en"),
  description_ur: text("description_ur"),
  repairNotes_ar: text("repairNotes_ar"),
  repairNotes_en: text("repairNotes_en"),
  repairNotes_ur: text("repairNotes_ur"),
  closedAt: timestamp("closedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ============================================================
// 4. PURCHASE ORDERS
// ============================================================
export const poStatuses = [
  "draft", "pending_review", "pending_estimate", "pending_accounting", "pending_management",
  "approved", "partial_purchase", "purchased", "received", "closed", "rejected", "revision_needed"
] as const;

export const purchaseOrders = mysqlTable("purchase_orders", {
  id: int("id").autoincrement().primaryKey(),
  poNumber: varchar("poNumber", { length: 20 }).notNull().unique(),
  ticketId: int("ticketId"),
  siteId: int("siteId"),
  sectionId: int("sectionId"),
  requestedById: int("requestedById").notNull(),
  status: mysqlEnum("status", [...poStatuses]).default("draft").notNull(),
  totalEstimatedCost: decimal("totalEstimatedCost", { precision: 12, scale: 2 }),
  totalActualCost: decimal("totalActualCost", { precision: 12, scale: 2 }),
  totalEstimatedText: varchar("totalEstimatedText", { length: 500 }),
  accountingApprovedById: int("accountingApprovedById"),
  accountingApprovedAt: timestamp("accountingApprovedAt"),
  accountingNotes: text("accountingNotes"),
  custodyAmount: decimal("custodyAmount", { precision: 12, scale: 2 }),
  managementApprovedById: int("managementApprovedById"),
  managementApprovedAt: timestamp("managementApprovedAt"),
  managementNotes: text("managementNotes"),
  reviewedById: int("reviewedById"),
  reviewedAt: timestamp("reviewedAt"),
  rejectedById: int("rejectedById"),
  rejectedAt: timestamp("rejectedAt"),
  rejectionReason: text("rejectionReason"),
  notes: text("notes"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ============================================================
// 5. PURCHASE ORDER ITEMS
// ============================================================
export const poItemStatuses = ["pending", "estimated", "approved", "rejected", "funded", "purchased", "delivered_to_warehouse", "delivered_to_requester", "cancelled"] as const;

export const purchaseOrderItems = mysqlTable("purchase_order_items", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull(),
  itemName: varchar("itemName", { length: 300 }).notNull(),
  description: text("description"),
  quantity: int("quantity").default(1).notNull(),
  unit: varchar("unit", { length: 50 }),
  photoUrl: text("photoUrl"),
  photoUrls: json("photoUrls").$type<string[]>(),
  notes: text("notes"),
  delegateId: int("delegateId"),
  batchId: int("batchId"), // مرتبط بدفعة التسعير (po_pricing_batches) عند إرسال الصنف للحسابات — null قبل الإرسال
  managementRejectionReason: text("managementRejectionReason"),
  estimatedUnitCost: decimal("estimatedUnitCost", { precision: 12, scale: 2 }),
  estimatedTotalCost: decimal("estimatedTotalCost", { precision: 12, scale: 2 }),
  actualUnitCost: decimal("actualUnitCost", { precision: 12, scale: 2 }),
  actualTotalCost: decimal("actualTotalCost", { precision: 12, scale: 2 }),
  supplierName: varchar("supplierName", { length: 300 }),
  supplierInvoiceNumber: varchar("supplierInvoiceNumber", { length: 100 }),
  invoicePhotoUrl: text("invoicePhotoUrl"),
  purchasedPhotoUrl: text("purchasedPhotoUrl"),
  status: mysqlEnum("status", [...poItemStatuses]).default("pending").notNull(),
  purchasedAt: timestamp("purchasedAt"),
  purchasedById: int("purchasedById"),
  supplierItemName: varchar("supplierItemName", { length: 300 }),
  warehousePhotoUrl: text("warehousePhotoUrl"),
  receivedAt: timestamp("receivedAt"),
  receivedById: int("receivedById"),
  receivedQuantity: int("receivedQuantity"),
  deliveredQuantity: int("deliveredQuantity"),
  deliveryNumber: varchar("deliveryNumber", { length: 20 }),
  printCount: int("printCount").default(0).notNull(),
  deliveredAt: timestamp("deliveredAt"),
  deliveredById: int("deliveredById"),
  deliveredToId: int("deliveredToId"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  itemName_ar: text("itemName_ar"),
  itemName_en: text("itemName_en"),
  itemName_ur: text("itemName_ur"),
  description_ar: text("description_ar"),
  description_en: text("description_en"),
  description_ur: text("description_ur"),
  notes_ar: text("notes_ar"),
  notes_en: text("notes_en"),
  notes_ur: text("notes_ur"),
  returnedQuantity: int("returnedQuantity").default(0),
  returnReason: text("returnReason"),
  returnedAt: timestamp("returnedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ============================================================
// 5a. PO PRICING BATCHES (دفعات التسعير — كل دفعة تُرسل للحسابات وتُعتمد بشكل مستقل)
// ============================================================
export const poBatchStatuses = [
  "pending_accounting", "pending_management", "approved", "rejected"
] as const;

export const poPricingBatches = mysqlTable("po_pricing_batches", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull(),
  batchNumber: int("batchNumber").notNull(),
  submittedById: int("submittedById").notNull(),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
  itemCount: int("itemCount").default(0).notNull(),
  totalEstimatedCost: decimal("totalEstimatedCost", { precision: 12, scale: 2 }),
  status: mysqlEnum("status", [...poBatchStatuses]).default("pending_accounting").notNull(),
  accountingApprovedById: int("accountingApprovedById"),
  accountingApprovedAt: timestamp("accountingApprovedAt"),
  accountingNotes: text("accountingNotes"),
  custodyAmount: decimal("custodyAmount", { precision: 12, scale: 2 }),
  managementApprovedById: int("managementApprovedById"),
  managementApprovedAt: timestamp("managementApprovedAt"),
  managementNotes: text("managementNotes"),
  rejectedById: int("rejectedById"),
  rejectedAt: timestamp("rejectedAt"),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type POPricingBatch = typeof poPricingBatches.$inferSelect;
export type InsertPOPricingBatch = typeof poPricingBatches.$inferInsert;

// ============================================================
// 5b. PROCUREMENT COMMENTS
// ============================================================
export const procurementComments = mysqlTable("procurement_comments", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull(),
  userId: int("userId").notNull(),
  userName: text("userName").notNull(),
  userRole: varchar("userRole", { length: 50 }).notNull(),
  actionType: varchar("actionType", { length: 50 }).notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProcurementComment = typeof procurementComments.$inferSelect;
export type InsertProcurementComment = typeof procurementComments.$inferInsert;

// ============================================================
// 5b. TICKET CONFIRMATIONS (requester confirms completion after closure)
// ============================================================
export const ticketConfirmations = mysqlTable("ticket_confirmations", {
  id: int("id").autoincrement().primaryKey(),
  ticketId: int("ticketId").notNull(),
  confirmedById: int("confirmedById").notNull(),
  note: text("note").notNull(),
  photoUrls: json("photoUrls").$type<string[]>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TicketConfirmation = typeof ticketConfirmations.$inferSelect;
export type InsertTicketConfirmation = typeof ticketConfirmations.$inferInsert;

// ============================================================
// 6. INVENTORY
// ============================================================
export const inventory = mysqlTable("inventory", {
  id: int("id").autoincrement().primaryKey(),
  itemName: varchar("itemName", { length: 300 }).notNull(),
  description: text("description"),
  quantity: int("quantity").default(0).notNull(),
  unit: varchar("unit", { length: 50 }),
  minQuantity: int("minQuantity").default(0),
  location: varchar("location", { length: 200 }),
  siteId: int("siteId"),
  lastRestockedAt: timestamp("lastRestockedAt"),
  internalCode: varchar("internalCode", { length: 20 }),
  manufacturerBarcode: varchar("manufacturerBarcode", { length: 200 }),
  receiptId: int("receiptId"),
  averageCost: decimal("averageCost", { precision: 12, scale: 4 }).notNull().default("0"),
  totalCostValue: decimal("totalCostValue", { precision: 14, scale: 2 }).notNull().default("0"),
  // ── أعمدة موجودة فعلياً بالقاعدة الحية، أُضيفت هنا لمطابقة الواقع (0042) ──
  itemName_ar: varchar("itemName_ar", { length: 300 }),
  itemName_en: varchar("itemName_en", { length: 300 }),
  itemName_ur: varchar("itemName_ur", { length: 300 }),
  itemType: varchar("itemType", { length: 50 }),
  purchaseUnit: varchar("purchaseUnit", { length: 50 }),
  issueUnit: varchar("issueUnit", { length: 50 }),
  conversionFactor: decimal("conversionFactor", { precision: 10, scale: 4 }),
  expiryDate: date("expiryDate"),
  linkedItemId: int("linkedItemId"),
  assetId: int("assetId"),
  warehouseId: int("warehouseId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ============================================================
// 7. INVENTORY TRANSACTIONS
// ============================================================
export const inventoryTransactions = mysqlTable("inventory_transactions", {
  id: int("id").autoincrement().primaryKey(),
  inventoryId: int("inventoryId").notNull(),
  type: mysqlEnum("type", ["in", "out"]).notNull(),
  quantity: int("quantity").notNull(),
  reason: text("reason"),
  ticketId: int("ticketId"),
  purchaseOrderItemId: int("purchaseOrderItemId"),
  performedById: int("performedById").notNull(),
  transactionType: mysqlEnum("transactionType", ["purchase", "return", "delivery", "adjustment", "disposal"]).default("adjustment"),
  receiptId: int("receiptId"),
  returnId: int("returnId"),
  unitCost: decimal("unitCost", { precision: 12, scale: 4 }),
  totalCost: decimal("totalCost", { precision: 14, scale: 2 }),
  projectId: int("projectId"),
  departmentId: int("departmentId"),
  assetId: int("assetId"),
  documentUrl: text("documentUrl"),
  invoiceNumber: varchar("invoiceNumber", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // فهرس يسرّع البحث عن "آخر حركة توريد لكل صنف" — أساسي مع نمو عدد الأصناف والحركات
  itemTypeDateIdx: index("inventory_tx_item_type_date_idx").on(table.inventoryId, table.transactionType, table.createdAt),
}));

// ============================================================
// 8. NOTIFICATIONS
// ============================================================
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  message: text("message").notNull(),
  type: mysqlEnum("type", ["info", "warning", "error", "success", "critical", "ticket_updated", "ticket_deleted", "po_deleted", "po_updated", "low_stock"]).default("info").notNull(),
  relatedTicketId: int("relatedTicketId"),
  relatedPOId: int("relatedPOId"),
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// 9. AUDIT LOG
// ============================================================
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 50 }).notNull(),
  entityId: int("entityId"),
  oldValues: json("oldValues"),
  newValues: json("newValues"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// 10. TICKET STATUS HISTORY
// ============================================================
export const ticketStatusHistory = mysqlTable("ticket_status_history", {
  id: int("id").autoincrement().primaryKey(),
  ticketId: int("ticketId").notNull(),
  fromStatus: varchar("fromStatus", { length: 50 }),
  toStatus: varchar("toStatus", { length: 50 }).notNull(),
  changedById: int("changedById").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// 11. ATTACHMENTS
// ============================================================
export const attachments = mysqlTable("attachments", {
  id: int("id").autoincrement().primaryKey(),
  entityType: varchar("entityType", { length: 50 }).notNull(),
  entityId: int("entityId").notNull(),
  fileName: varchar("fileName", { length: 500 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  fileSize: int("fileSize"),
  uploadedById: int("uploadedById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  entityIdx: index("attachments_entity_type_id_idx").on(table.entityType, table.entityId),
}));

// ============================================================
// 12. DATABASE BACKUPS
// ============================================================
export const backups = mysqlTable("backups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileSize: int("fileSize"),
  tablesCount: int("tablesCount"),
  recordsCount: int("recordsCount"),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// 13. ENTITY TRANSLATIONS
// ============================================================
export const translationStatuses = ["pending", "processing", "completed", "failed", "approved"] as const;
export type TranslationStatus = typeof translationStatuses[number];

export const entityTranslations = mysqlTable("entity_translations", {
  id: int("id").autoincrement().primaryKey(),
  entityType: varchar("entityType", { length: 50 }).notNull(),
  entityId: int("entityId").notNull(),
  fieldName: varchar("fieldName", { length: 100 }).notNull(),
  languageCode: mysqlEnum("languageCode", ["ar", "en", "ur"]).notNull(),
  translatedText: text("translatedText"),
  translationStatus: mysqlEnum("translationStatus", [...translationStatuses]).default("pending").notNull(),
  versionNumber: int("versionNumber").default(1).notNull(),
  translationJobId: int("translationJobId"),
  lastAttemptAt: timestamp("lastAttemptAt"),
  errorMessage: text("errorMessage"),
  approvedById: int("approvedById"),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const translationJobs = mysqlTable("translation_jobs", {
  id: int("id").autoincrement().primaryKey(),
  entityType: varchar("entityType", { length: 50 }).notNull(),
  entityId: int("entityId").notNull(),
  fieldName: varchar("fieldName", { length: 100 }).notNull(),
  sourceLanguage: mysqlEnum("sourceLanguage", ["ar", "en", "ur"]).notNull(),
  targetLanguage: mysqlEnum("targetLanguage", ["ar", "en", "ur"]).notNull(),
  sourceText: text("sourceText").notNull(),
  translatedText: text("translatedText"),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  retryCount: int("retryCount").default(0).notNull(),
  maxRetries: int("maxRetries").default(3).notNull(),
  errorMessage: text("errorMessage"),
  previousTextHash: varchar("previousTextHash", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export const translationVersions = mysqlTable("translation_versions", {
  id: int("id").autoincrement().primaryKey(),
  entityTranslationId: int("entityTranslationId").notNull(),
  versionNumber: int("versionNumber").notNull(),
  translatedText: text("translatedText"),
  translationStatus: varchar("translationStatus", { length: 20 }).notNull(),
  changedById: int("changedById"),
  changeReason: varchar("changeReason", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// 15. ASSETS
// ============================================================
export const assetStatuses = ["active", "inactive", "under_maintenance", "disposed"] as const;
export type AssetStatus = typeof assetStatuses[number];

export const assets = mysqlTable("assets", {
  id: int("id").autoincrement().primaryKey(),
  assetNumber: varchar("assetNumber", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  brand: varchar("brand", { length: 100 }),
  model: varchar("model", { length: 100 }),
  serialNumber: varchar("serialNumber", { length: 100 }),
  siteId: int("siteId"),
  sectionId: int("sectionId"),
  locationDetail: varchar("locationDetail", { length: 200 }),
  status: mysqlEnum("status", ["active", "inactive", "under_maintenance", "disposed"]).default("active").notNull(),
  purchaseDate: timestamp("purchaseDate"),
  purchaseCost: decimal("purchaseCost", { precision: 12, scale: 2 }),
  warrantyExpiry: timestamp("warrantyExpiry"),
  warrantyNotes: text("warrantyNotes"),
  lastMaintenanceDate: timestamp("lastMaintenanceDate"),
  nextMaintenanceDate: timestamp("nextMaintenanceDate"),
  photoUrl: text("photoUrl"),
  qrCode: varchar("qrCode", { length: 200 }),
  rfidTag: varchar("rfidTag", { length: 100 }).unique(),
  notes: text("notes"),
  description_ar: text("description_ar"),
  description_en: text("description_en"),
  description_ur: text("description_ur"),
  notes_ar: text("notes_ar"),
  notes_en: text("notes_en"),
  notes_ur: text("notes_ur"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  createdById: int("createdById"),
  categoryId: int("categoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;
export type UpdateAsset = Partial<InsertAsset>;

// ============================================================
// 16. PREVENTIVE MAINTENANCE PLANS
// ============================================================
export const pmFrequencies = ["daily", "weekly", "monthly", "quarterly", "biannual", "annual"] as const;
export type PMFrequency = typeof pmFrequencies[number];

export const preventivePlans = mysqlTable("preventive_plans", {
  id: int("id").autoincrement().primaryKey(),
  planNumber: varchar("planNumber", { length: 50 }).notNull().unique(),
  // sectionId: يربط الفرع (عادة الفرع الجذر) بقسم حقيقي من جدول sections
  // (إدارة الأقسام) — اختياري، يُستخدم فقط لما يُنشأ الفرع من داخل موقع مختار
  // بشجرة الصيانة الوقائية. عنوان الفرع بهذي الحالة = اسم القسم المختار.
  sectionId: int("sectionId"),
  // parentId: يشير لفرع الأب في شجرة الصيانة الدورية (null = فرع جذر).
  // لا يوجد عمود "مستوى" ثابت بقصد — العمق خاصية طبيعية للشجرة (قائمة تجاور)
  // وليس قيداً مبرمجاً في قاعدة البيانات؛ الواجهة فقط تنصح بحد 4 مستويات.
  parentId: int("parentId"),
  // isGroupOnly: فرع تجميعي بحت (عادة الجذر) — لا يُنشأ منه أمر عمل ولا يدخل الأتمتة الدورية.
  isGroupOnly: boolean("isGroupOnly").default(false).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  assetId: int("assetId"),
  siteId: int("siteId"),
  // frequency/frequencyValue اختياريان الآن: الفروع التجميعية (isGroupOnly) ما تحتاج جدولة.
  // تبقى إلزامية منطقياً (تُتحقق في الـ router) لأي فرع تنفيذي (isGroupOnly = false).
  frequency: mysqlEnum("frequency", ["daily", "weekly", "monthly", "quarterly", "biannual", "annual"]),
  frequencyValue: int("frequencyValue").default(1),
  estimatedDurationMinutes: int("estimatedDurationMinutes"),
  assignedToId: int("assignedToId"),
  checklist: json("checklist"),
  isActive: boolean("isActive").default(true).notNull(),
  lastGeneratedAt: timestamp("lastGeneratedAt"),
  nextDueDate: timestamp("nextDueDate"),
  createdById: int("createdById"),
  title_ar: varchar("title_ar", { length: 200 }),
  title_en: varchar("title_en", { length: 200 }),
  title_ur: varchar("title_ur", { length: 200 }),
  description_ar: text("description_ar"),
  description_en: text("description_en"),
  description_ur: text("description_ur"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PreventivePlan = typeof preventivePlans.$inferSelect;
export type InsertPreventivePlan = typeof preventivePlans.$inferInsert;

// ============================================================
// 17. PREVENTIVE MAINTENANCE WORK ORDERS
// ============================================================
export const pmWorkOrderStatuses = ["scheduled", "in_progress", "completed", "overdue", "cancelled"] as const;

export const pmWorkOrders = mysqlTable("pm_work_orders", {
  id: int("id").autoincrement().primaryKey(),
  workOrderNumber: varchar("workOrderNumber", { length: 50 }).notNull().unique(),
  // planId: عمود قديم من التصميم السابق (الخطط كجزء من شجرة preventivePlans) —
  // لم يعد يُستخدم في التصميم الجديد، أُبقي بدون حذف فقط للتوافق أثناء الانتقال.
  planId: int("planId"),
  // subPlanId: المرجع الجديد والمعتمد — يشير لـ pm_sub_plans.id (الخطة الفرعية
  // المستقلة عن الشجرة). كل أمر عمل جديد في التصميم الجديد يُنشأ بهذا العمود.
  subPlanId: int("subPlanId"),
  assetId: int("assetId"),
  siteId: int("siteId"),
  title: varchar("title", { length: 200 }).notNull(),
  scheduledDate: timestamp("scheduledDate").notNull(),
  completedDate: timestamp("completedDate"),
  status: mysqlEnum("status", ["scheduled", "in_progress", "completed", "overdue", "cancelled"]).default("scheduled").notNull(),
  // hasPendingMaterials: علم مُحدَّث تلقائياً (denormalized) يبيّن إن فيه بند/بنود بانتظار
  // توريد مواد (rejected_to_purchase أو ready_for_pickup) حتى بعد اكتمال الأمر — يُستخدم
  // للفلترة السريعة وعرض شارة "معلّق" بدون الحاجة لـ JOIN مع جدول طلبات المواد كل مرة.
  hasPendingMaterials: boolean("hasPendingMaterials").default(false).notNull(),
  assignedToId: int("assignedToId"),
  checklistResults: json("checklistResults"),
  technicianNotes: text("technicianNotes"),
  completionPhotoUrl: text("completionPhotoUrl"),
  technicianNotes_ar: text("technicianNotes_ar"),
  technicianNotes_en: text("technicianNotes_en"),
  technicianNotes_ur: text("technicianNotes_ur"),
  title_ar: varchar("title_ar", { length: 200 }),
  title_en: varchar("title_en", { length: 200 }),
  title_ur: varchar("title_ur", { length: 200 }),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMWorkOrder = typeof pmWorkOrders.$inferSelect;
export type InsertPMWorkOrder = typeof pmWorkOrders.$inferInsert;

// ============================================================
// ASSET SPARE PARTS
// ============================================================
export const assetSpareParts = mysqlTable("asset_spare_parts", {
  id: int("id").autoincrement().primaryKey(),
  assetId: int("assetId").notNull(),
  inventoryItemId: int("inventoryItemId").notNull(),
  minStockLevel: int("minStockLevel").default(5).notNull(),
  preferredQuantity: int("preferredQuantity").default(10).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AssetSparePart = typeof assetSpareParts.$inferSelect;
export type InsertAssetSparePart = typeof assetSpareParts.$inferInsert;

// ============================================================
// PREVENTIVE MAINTENANCE JOBS
// ============================================================
export const pmJobs = mysqlTable("pm_jobs", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("planId").notNull(),
  assetId: int("assetId").notNull(),
  ticketId: int("ticketId"),
  dueDate: timestamp("dueDate").notNull(),
  executedDate: timestamp("executedDate"),
  status: mysqlEnum("status", ["pending", "executed", "skipped", "overdue"]).default("pending").notNull(),
  autoCreatedTicket: boolean("autoCreatedTicket").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMJob = typeof pmJobs.$inferSelect;
export type InsertPMJob = typeof pmJobs.$inferInsert;

// ============================================================
// ASSET PERFORMANCE METRICS
// ============================================================
export const assetMetrics = mysqlTable("asset_metrics", {
  id: int("id").autoincrement().primaryKey(),
  assetId: int("assetId").notNull().unique(),
  totalTickets: int("totalTickets").default(0).notNull(),
  closedTickets: int("closedTickets").default(0).notNull(),
  totalDowntime: int("totalDowntime").default(0).notNull(),
  mttr: decimal("mttr", { precision: 10, scale: 2 }).default("0").notNull(),
  mtbf: decimal("mtbf", { precision: 10, scale: 2 }).default("0").notNull(),
  availability: decimal("availability", { precision: 5, scale: 2 }).default("100").notNull(),
  lastFailureDate: timestamp("lastFailureDate"),
  lastRepairDate: timestamp("lastRepairDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AssetMetrics = typeof assetMetrics.$inferSelect;
export type InsertAssetMetrics = typeof assetMetrics.$inferInsert;

// ============================================================
// TWO-FACTOR AUTHENTICATION
// ============================================================
export const twoFactorSecrets = mysqlTable("two_factor_secrets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  secret: varchar("secret", { length: 255 }).notNull(),
  backupCodes: text("backupCodes").notNull(),
  isEnabled: boolean("isEnabled").default(false).notNull(),
  enabledAt: timestamp("enabledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TwoFactorSecret = typeof twoFactorSecrets.$inferSelect;
export type InsertTwoFactorSecret = typeof twoFactorSecrets.$inferInsert;

export const twoFactorAuditLogs = mysqlTable("two_factor_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  success: boolean("success").notNull(),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TwoFactorAuditLog = typeof twoFactorAuditLogs.$inferSelect;
export type InsertTwoFactorAuditLog = typeof twoFactorAuditLogs.$inferInsert;

// ============================================================
// WEB PUSH SUBSCRIPTIONS
// ============================================================
export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

// ============================================================
// PM CHECKLIST ITEMS
// ============================================================
export const pmChecklistItems = mysqlTable("pm_checklist_items", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("planId").notNull(),
  orderIndex: int("orderIndex").default(0).notNull(),
  text: text("text").notNull(),
  text_ar: text("text_ar"),
  text_en: text("text_en"),
  text_ur: text("text_ur"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  isRequired: boolean("isRequired").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMChecklistItem = typeof pmChecklistItems.$inferSelect;
export type InsertPMChecklistItem = typeof pmChecklistItems.$inferInsert;

// ============================================================
// PM EXECUTION RESULTS
// ============================================================
export const pmItemResultStatuses = ["ok", "fixed", "issue"] as const;
export type PMItemResultStatus = typeof pmItemResultStatuses[number];

export const pmExecutionResults = mysqlTable("pm_execution_results", {
  id: int("id").autoincrement().primaryKey(),
  workOrderId: int("workOrderId").notNull(),
  checklistItemId: int("checklistItemId").notNull(),
  status: mysqlEnum("status", ["ok", "fixed", "issue"]).notNull(),
  fixNotes: text("fixNotes"),
  fixNotes_ar: text("fixNotes_ar"),
  fixNotes_en: text("fixNotes_en"),
  fixNotes_ur: text("fixNotes_ur"),
  photoUrl: text("photoUrl"),
  linkedTicketId: int("linkedTicketId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMExecutionResult = typeof pmExecutionResults.$inferSelect;
export type InsertPMExecutionResult = typeof pmExecutionResults.$inferInsert;

// ============================================================
// PM EXECUTION SESSIONS
// ============================================================
export const pmExecutionSessionStatuses = ["in_progress", "completed", "paused"] as const;

export const pmExecutionSessions = mysqlTable("pm_execution_sessions", {
  id: int("id").autoincrement().primaryKey(),
  workOrderId: int("workOrderId").notNull().unique(),
  technicianId: int("technicianId").notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  durationSeconds: int("durationSeconds"),
  totalItems: int("totalItems").default(0).notNull(),
  okCount: int("okCount").default(0).notNull(),
  fixedCount: int("fixedCount").default(0).notNull(),
  issueCount: int("issueCount").default(0).notNull(),
  generalNotes: text("generalNotes"),
  generalNotes_ar: text("generalNotes_ar"),
  generalNotes_en: text("generalNotes_en"),
  generalNotes_ur: text("generalNotes_ur"),
  status: mysqlEnum("status", ["in_progress", "completed", "paused"]).default("in_progress").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMExecutionSession = typeof pmExecutionSessions.$inferSelect;
export type InsertPMExecutionSession = typeof pmExecutionSessions.$inferInsert;

// ============================================================
// INSPECTION RESULTS
// ============================================================
export const inspectionResults = mysqlTable("inspection_results", {
  id:                int("id").autoincrement().primaryKey(),
  ticketId:          int("ticketId").notNull(),
  assetId:           int("assetId"),
  inspectorId:       int("inspectorId").notNull(),
  inspectionType:    mysqlEnum("inspectionType", ["triage", "detailed"]).notNull(),
  severity:          mysqlEnum("severity", ["low", "medium", "high", "critical"]).notNull(),
  rootCause:         varchar("rootCause", { length: 500 }),
  findings:          text("findings"),
  recommendedAction: text("recommendedAction"),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
});
export type InspectionResult = typeof inspectionResults.$inferSelect;
export type InsertInspectionResult = typeof inspectionResults.$inferInsert;

// ============================================================
// ASSET CATEGORIES
// ============================================================
export const assetCategories = mysqlTable("asset_categories", {
  id:        int("id").primaryKey().autoincrement(),
  name:      varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AssetCategory = typeof assetCategories.$inferSelect;
export type InsertAssetCategory = typeof assetCategories.$inferInsert;

// ============================================================
// WAREHOUSE RECEIPTS
// ============================================================
export const warehouseReceipts = mysqlTable("warehouse_receipts", {
  id: int("id").autoincrement().primaryKey(),
  receiptNumber: varchar("receiptNumber", { length: 20 }).notNull(),
  purchaseOrderId: int("purchaseOrderId"), // اختياري: NULL = استلام مستقل بلا طلب شراء (0035)
  receivedById: int("receivedById").notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  notes: text("notes"),
  totalItems: int("totalItems").default(0),
  status: mysqlEnum("status", ["draft", "confirmed", "approved", "rejected"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  vendorName: varchar("vendorName", { length: 300 }),
  vendorNameEn: varchar("vendorNameEn", { length: 300 }),
  vendorTaxNumber: varchar("vendorTaxNumber", { length: 50 }),
  invoiceNumber: varchar("invoiceNumber", { length: 100 }),
  invoiceDate: date("invoiceDate"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }),
  taxAmount: decimal("taxAmount", { precision: 12, scale: 2 }),
  grandTotal: decimal("grandTotal", { precision: 12, scale: 2 }),
  invoicePhotoUrl: text("invoicePhotoUrl"),
  goodsPhotoUrl: text("goodsPhotoUrl"),
  ocrRawData: json("ocrRawData"),
  ocrConfidence: decimal("ocrConfidence", { precision: 5, scale: 2 }),
  isDuplicate: boolean("isDuplicate").default(false).notNull(),
  duplicateOfId: int("duplicateOfId"),
  hasDiscrepancy: boolean("hasDiscrepancy").default(false).notNull(),
  discrepancyNotes: text("discrepancyNotes"),
  isDraft: boolean("isDraft").default(true).notNull(),
  approvedById: int("approvedById"),
  approvedAt: timestamp("approvedAt"),
});
export type WarehouseReceipt = typeof warehouseReceipts.$inferSelect;
export type InsertWarehouseReceipt = typeof warehouseReceipts.$inferInsert;

// ============================================================
// WAREHOUSE RETURNS
// ============================================================
export const warehouseReturns = mysqlTable("warehouse_returns", {
  id: int("id").autoincrement().primaryKey(),
  returnNumber: varchar("returnNumber", { length: 20 }).notNull(),
  receiptId: int("receiptId"), // اختياري (0036): NULL = بلا سند استلام معروف
  purchaseOrderId: int("purchaseOrderId"), // اختياري (0036)
  purchaseOrderItemId: int("purchaseOrderItemId"), // اختياري (0036)
  inventoryId: int("inventoryId").notNull(),
  returnedQuantity: int("returnedQuantity").notNull(),
  reason: text("reason").notNull(),
  returnedById: int("returnedById").notNull(),
  returnedAt: timestamp("returnedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type WarehouseReturn = typeof warehouseReturns.$inferSelect;
export type InsertWarehouseReturn = typeof warehouseReturns.$inferInsert;

// ============================================================
// CATALOG MODULE — وحدة الكتالوج
// ============================================================

// 1. عقد التصنيف الهرمي
export const catalogNodes = mysqlTable("catalog_nodes", {
  id:          int("id").autoincrement().primaryKey(),
  code:        varchar("code", { length: 20 }).unique(),
  nameAr:      varchar("nameAr", { length: 255 }).notNull(),
  nameEn:      varchar("nameEn", { length: 255 }).notNull(),
  nameUr:      varchar("nameUr", { length: 255 }),
  parentId:    int("parentId"),
  level:       int("level").default(1).notNull(),
  isActive:    boolean("isActive").default(true).notNull(),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
  updatedAt:   timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CatalogNode = typeof catalogNodes.$inferSelect;
export type InsertCatalogNode = typeof catalogNodes.$inferInsert;

// 2. عناصر الكتالوج (الأصناف)
export const catalogItems = mysqlTable("catalog_items", {
  id:             int("id").autoincrement().primaryKey(),
  code:           varchar("code", { length: 100 }),
  nameAr:         varchar("nameAr", { length: 255 }).notNull(),
  nameEn:         varchar("nameEn", { length: 255 }).notNull(),
  nameUr:         varchar("nameUr", { length: 255 }),
  descriptionAr:  text("descriptionAr"),
  descriptionEn:  text("descriptionEn"),
  descriptionUr:  text("descriptionUr"),
  unit:           varchar("unit", { length: 50 }),
  manufacturer:   varchar("manufacturer", { length: 255 }),
  nodeId:         int("nodeId").notNull(),
  isActive:       boolean("isActive").default(true).notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  nodeIdIdx: index("catalog_items_node_id_idx").on(table.nodeId),
  isActiveIdx: index("catalog_items_is_active_idx").on(table.isActive),
  codeIdx: index("catalog_items_code_idx").on(table.code),
  nameArIdx: index("catalog_items_name_ar_idx").on(table.nameAr),
  nameEnIdx: index("catalog_items_name_en_idx").on(table.nameEn),
}));
export type CatalogItem = typeof catalogItems.$inferSelect;
export type InsertCatalogItem = typeof catalogItems.$inferInsert;

// 3. مواصفات الأصناف
export const catalogItemSpecs = mysqlTable("catalog_item_specs", {
  id:        int("id").autoincrement().primaryKey(),
  itemId:    int("itemId").notNull(),
  keyAr:     varchar("keyAr", { length: 255 }).notNull(),
  keyEn:     varchar("keyEn", { length: 255 }).notNull(),
  value:     text("value").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CatalogItemSpec = typeof catalogItemSpecs.$inferSelect;
export type InsertCatalogItemSpec = typeof catalogItemSpecs.$inferInsert;

// 4. ربط الأصناف بالعقد
export const catalogItemNodes = mysqlTable("catalog_item_nodes", {
  id:        int("id").autoincrement().primaryKey(),
  itemId:    int("itemId").notNull(),
  nodeId:    int("nodeId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CatalogItemNode = typeof catalogItemNodes.$inferSelect;
export type InsertCatalogItemNode = typeof catalogItemNodes.$inferInsert;

// 5. صور الأصناف
export const catalogItemImages = mysqlTable("catalog_item_images", {
  id:        int("id").autoincrement().primaryKey(),
  itemId:    int("itemId").notNull(),
  url:       text("url").notNull(),
  isPrimary: boolean("isPrimary").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CatalogItemImage = typeof catalogItemImages.$inferSelect;
export type InsertCatalogItemImage = typeof catalogItemImages.$inferInsert;

// ============================================================
// 6. الموردين — Supplier Master  ← مُحدَّث
// ============================================================
export const catalogSuppliers = mysqlTable("catalog_suppliers", {
  id:             int("id").autoincrement().primaryKey(),
  nameAr:         varchar("nameAr",      { length: 255 }).notNull(),
  nameEn:         varchar("nameEn",      { length: 255 }).notNull(),
  contactName:    varchar("contactName", { length: 255 }),
  phone:          varchar("phone",       { length: 50  }),
  email:          varchar("email",       { length: 255 }),
  address:        text("address"),
  country:        varchar("country",     { length: 100 }),  // ← جديد
  notes:          text("notes"),                            // ← جديد
  isManufacturer: boolean("isManufacturer").default(false).notNull(), // ← جديد
  isActive:       boolean("isActive").default(true).notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CatalogSupplier       = typeof catalogSuppliers.$inferSelect;
export type InsertCatalogSupplier = typeof catalogSuppliers.$inferInsert;

// ============================================================
// 7. ربط الموردين بالأصناف — Item-Supplier Relationship  ← مُحدَّث
// ============================================================
export const catalogSupplierPrices = mysqlTable("catalog_supplier_prices", {
  id:               int("id").autoincrement().primaryKey(),
  itemId:           int("itemId").notNull(),
  supplierId:       int("supplierId").notNull(),
  supplierItemCode: varchar("supplierItemCode", { length: 100 }),  // ← جديد
  price:            decimal("price", { precision: 12, scale: 2 }).notNull(),
  currency:         varchar("currency", { length: 10 }).default("SAR").notNull(),
  isPreferred:      boolean("isPreferred").default(false).notNull(),
  notes:            text("notes"),      // ← جديد
  isActive:         boolean("isActive").default(true).notNull(), // ← جديد
  createdAt:        timestamp("createdAt").defaultNow().notNull(), // ← جديد
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CatalogSupplierPrice       = typeof catalogSupplierPrices.$inferSelect;
export type InsertCatalogSupplierPrice = typeof catalogSupplierPrices.$inferInsert;

// 8. إعدادات الكتالوج
export const catalogSettings = mysqlTable("catalog_settings", {
  id:        int("id").autoincrement().primaryKey(),
  key:       varchar("key", { length: 100 }).notNull().unique(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CatalogSetting = typeof catalogSettings.$inferSelect;
export type InsertCatalogSetting = typeof catalogSettings.$inferInsert;

// 9. سجل تدقيق الكتالوج
export const catalogAuditLogs = mysqlTable("catalog_audit_logs", {
  id:         int("id").autoincrement().primaryKey(),
  userId:     int("userId").notNull(),
  action:     varchar("action", { length: 50 }).notNull(),
  entityType: varchar("entityType", { length: 50 }).notNull(),
  entityId:   int("entityId").notNull(),
  oldValues:  text("oldValues"),
  newValues:  text("newValues"),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
});
export type CatalogAuditLog = typeof catalogAuditLogs.$inferSelect;
export type InsertCatalogAuditLog = typeof catalogAuditLogs.$inferInsert;

// 10. وحدات القياس
export const catalogUnits = mysqlTable("catalog_units", {
  id:        int("id").autoincrement().primaryKey(),
  nameAr:    varchar("nameAr", { length: 100 }).notNull(),
  nameEn:    varchar("nameEn", { length: 100 }).notNull(),
  isActive:  boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CatalogUnit = typeof catalogUnits.$inferSelect;
export type InsertCatalogUnit = typeof catalogUnits.$inferInsert;

// ============================================================
// مركز التحسين والتطوير — IMPROVEMENT IDEAS
// ============================================================
export const improvementCategories = [
  "operational", "technical", "procedural", "safety", "quality",
  "cost_reduction", "productivity", "innovative", "work_note", "recurring_problem",
] as const;
// المجموعة/الملف — يحدّدها الفارز فقط أثناء "الفرز والتصنيف"
export const improvementGroups = [
  "maintenance_ops", "warehouse_assets", "purchasing_contracts", "safety_quality",
  "tech_digital", "restaurants_services", "hr_training", "customer_experience",
] as const;
// new → classified → approved → in_progress → completed | postponed | cancelled
export const improvementStatuses = [
  "new", "classified", "approved", "in_progress", "completed", "postponed", "cancelled",
] as const;

export const improvementIdeas = mysqlTable("improvement_ideas", {
  id: int("id").autoincrement().primaryKey(),
  requestNumber: varchar("requestNumber", { length: 20 }).notNull().unique(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  category: mysqlEnum("category", [...improvementCategories]).notNull(),
  groupCategory: varchar("groupCategory", { length: 50 }),
  priority: mysqlEnum("priority", [...ticketPriorities]).default("medium").notNull(),
  status: mysqlEnum("status", [...improvementStatuses]).default("new").notNull(),
  expectedBenefit: text("expectedBenefit"),
  siteId: int("siteId"),
  sectionId: int("sectionId"),
  assetId: int("assetId"),
  submittedById: int("submittedById").notNull(),
  // الفرز والتصنيف (مالك النظام / مدير النظام / مدير الصيانة فقط) — يصحّح التصنيف، يحدد المجموعة والأولوية
  triagedById: int("triagedById"),
  triagedAt: timestamp("triagedAt"),
  // قرار الإدارة العليا
  decidedById: int("decidedById"),
  decidedAt: timestamp("decidedAt"),
  decisionNotes: text("decisionNotes"),
  // التحويل إلى عمل فعلي بعد الموافقة (تذكرة أو طلب شراء)
  assignedToId: int("assignedToId"),
  linkedTicketId: int("linkedTicketId"),
  linkedPurchaseOrderId: int("linkedPurchaseOrderId"),
  postponedUntil: timestamp("postponedUntil"),
  cancelReason: text("cancelReason"),
  completedAt: timestamp("completedAt"),
  completionNotes: text("completionNotes"),
  // الترجمة (نفس نمط البلاغات)
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  title_ar: text("title_ar"),
  title_en: text("title_en"),
  title_ur: text("title_ur"),
  description_ar: text("description_ar"),
  description_en: text("description_en"),
  description_ur: text("description_ur"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ImprovementIdea = typeof improvementIdeas.$inferSelect;
export type InsertImprovementIdea = typeof improvementIdeas.$inferInsert;

// CONSTRUCTION MODULE — 16 TABLES
// ============================================================

// ── Enums ───────────────────────────────────────────────────
export const constructionProjectStatuses = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
export const constructionPriorities = ["low", "medium", "high", "critical"] as const;
export const constructionPhaseStatuses = ["pending", "active", "on_hold", "completed"] as const;
export const constructionTaskStatuses = ["new", "in_progress", "pending_approval", "pending_materials", "on_hold", "completed"] as const;
export const constructionHoldReasons = ["weather", "pending_approval", "subcontractor", "administrative", "other"] as const;
export const constructionMemberRoles = ["manager", "supervisor", "engineer", "technician", "subcontractor", "viewer"] as const;
export const constructionFieldTypes = ["text", "number", "date", "dropdown", "user", "file", "rating", "url"] as const;
export const constructionTriggerTypes = ["status_change", "date_passed", "task_completed", "phase_completed", "member_overloaded", "daily_schedule"] as const;
export const constructionActionTypes = ["create_purchase_order", "send_notification", "create_report", "update_status", "reassign_task", "check_inventory"] as const;
export const constructionGoalTypes = ["completion", "budget", "quality", "safety"] as const;
export const constructionGoalStatuses = ["on_track", "at_risk", "behind", "completed"] as const;
export const constructionWeatherTypes = ["sunny", "cloudy", "rainy", "stormy", "windy"] as const;
export const constructionDependencyTypes = ["finish_to_start", "start_to_start", "finish_to_finish", "start_to_finish"] as const;
export const constructionChangeReasons = ["design_change", "client_request", "site_condition", "error_correction", "other"] as const;
export const constructionChangeStatuses = ["pending", "approved", "rejected"] as const;
export const constructionIncidentTypes = ["near_miss", "minor_injury", "major_injury", "property_damage", "safety_violation", "inspection"] as const;
export const constructionSeverities = ["low", "medium", "high", "critical"] as const;
export const constructionTimeLogTypes = ["auto", "manual"] as const;

// ── 1. Projects ─────────────────────────────────────────────
export const constructionProjects = mysqlTable("construction_projects", {
  id: int("id").autoincrement().primaryKey(),
  projectNumber: varchar("projectNumber", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 300 }).notNull(),
  nameEn: varchar("nameEn", { length: 300 }),
  description: text("description"),
  status: mysqlEnum("status", [...constructionProjectStatuses]).default("planning").notNull(),
  priority: mysqlEnum("priority", [...constructionPriorities]).default("medium").notNull(),
  siteId: int("siteId"),
  sectionId: int("sectionId"),
  ownerId: int("ownerId").notNull(),
  managerId: int("managerId"),
  budgetPlanned: decimal("budgetPlanned", { precision: 15, scale: 2 }),
  budgetActual: decimal("budgetActual", { precision: 15, scale: 2 }),
  startDatePlanned: varchar("startDatePlanned", { length: 10 }),
  endDatePlanned: varchar("endDatePlanned", { length: 10 }),
  startDateActual: varchar("startDateActual", { length: 10 }),
  endDateActual: varchar("endDateActual", { length: 10 }),
  progressPercent: decimal("progressPercent", { precision: 5, scale: 2 }).default("0"),
  coverImageUrl: text("coverImageUrl"),
  laborCost: decimal("laborCost", { precision: 15, scale: 2 }),
  issueLevel: mysqlEnum("issueLevel", ["low", "medium", "high", "critical"]),
  tags: json("tags").$type<string[]>(),
  checklist: json("checklist").$type<{ id: string; text: string; done: boolean }[]>(),
  attachments: json("attachments").$type<{ name: string; url: string; uploadedAt: string }[]>(),
  isArchived: boolean("isArchived").default(false).notNull(),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cp_status").on(t.status),
  index("idx_cp_siteId").on(t.siteId),
  index("idx_cp_managerId").on(t.managerId),
]);
export type ConstructionProject = typeof constructionProjects.$inferSelect;
export type InsertConstructionProject = typeof constructionProjects.$inferInsert;

// ── 2. Phases ───────────────────────────────────────────────
export const constructionPhases = mysqlTable("construction_phases", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  nameEn: varchar("nameEn", { length: 300 }),
  description: text("description"),
  orderIndex: int("orderIndex").default(0).notNull(),
  status: mysqlEnum("status", [...constructionPhaseStatuses]).default("pending").notNull(),
  progressPercent: decimal("progressPercent", { precision: 5, scale: 2 }).default("0"),
  startDatePlanned: varchar("startDatePlanned", { length: 10 }),
  endDatePlanned: varchar("endDatePlanned", { length: 10 }),
  startDateActual: varchar("startDateActual", { length: 10 }),
  endDateActual: varchar("endDateActual", { length: 10 }),
  budgetPlanned: decimal("budgetPlanned", { precision: 15, scale: 2 }),
  budgetActual: decimal("budgetActual", { precision: 15, scale: 2 }),
  laborCost: decimal("laborCost", { precision: 15, scale: 2 }),
  issueLevel: mysqlEnum("issueLevel", ["low", "medium", "high", "critical"]),
  tags: json("tags").$type<string[]>(),
  checklist: json("checklist").$type<{ id: string; text: string; done: boolean }[]>(),
  attachments: json("attachments").$type<{ name: string; url: string; uploadedAt: string }[]>(),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cph_projectId").on(t.projectId),
  index("idx_cph_status").on(t.status),
  index("idx_cph_orderIndex").on(t.orderIndex),
]);
export type ConstructionPhase = typeof constructionPhases.$inferSelect;
export type InsertConstructionPhase = typeof constructionPhases.$inferInsert;

// ── 3. Activities ───────────────────────────────────────────
export const constructionActivities = mysqlTable("construction_activities", {
  id: int("id").autoincrement().primaryKey(),
  phaseId: int("phaseId").notNull(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  nameEn: varchar("nameEn", { length: 300 }),
  description: text("description"),
  orderIndex: int("orderIndex").default(0).notNull(),
  status: mysqlEnum("status", [...constructionPhaseStatuses]).default("pending").notNull(),
  progressPercent: decimal("progressPercent", { precision: 5, scale: 2 }).default("0"),
  startDatePlanned: varchar("startDatePlanned", { length: 10 }),
  endDatePlanned: varchar("endDatePlanned", { length: 10 }),
  startDateActual: varchar("startDateActual", { length: 10 }),
  endDateActual: varchar("endDateActual", { length: 10 }),
  budgetPlanned: decimal("budgetPlanned", { precision: 15, scale: 2 }),
  budgetActual: decimal("budgetActual", { precision: 15, scale: 2 }),
  laborCost: decimal("laborCost", { precision: 15, scale: 2 }),
  issueLevel: mysqlEnum("issueLevel", ["low", "medium", "high", "critical"]),
  tags: json("tags").$type<string[]>(),
  checklist: json("checklist").$type<{ id: string; text: string; done: boolean }[]>(),
  attachments: json("attachments").$type<{ name: string; url: string; uploadedAt: string }[]>(),
  responsibleId: int("responsibleId"),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ca_phaseId").on(t.phaseId),
  index("idx_ca_projectId").on(t.projectId),
  index("idx_ca_status").on(t.status),
]);
export type ConstructionActivity = typeof constructionActivities.$inferSelect;
export type InsertConstructionActivity = typeof constructionActivities.$inferInsert;

// ── 4. Tasks ────────────────────────────────────────────────
export const constructionTasks = mysqlTable("construction_tasks", {
  id: int("id").autoincrement().primaryKey(),
  taskNumber: varchar("taskNumber", { length: 20 }).notNull().unique(),
  activityId: int("activityId").notNull(),
  phaseId: int("phaseId").notNull(),
  projectId: int("projectId").notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", [...constructionTaskStatuses]).default("new").notNull(),
  priority: mysqlEnum("priority", [...constructionPriorities]).default("medium").notNull(),
  holdReason: mysqlEnum("holdReason", [...constructionHoldReasons]),
  holdNote: text("holdNote"),
  progressPercent: decimal("progressPercent", { precision: 5, scale: 2 }).default("0"),
  startDatePlanned: varchar("startDatePlanned", { length: 10 }),
  endDatePlanned: varchar("endDatePlanned", { length: 10 }),
  startDateActual: varchar("startDateActual", { length: 10 }),
  endDateActual: varchar("endDateActual", { length: 10 }),
  assignedToId: int("assignedToId"),
  assignedById: int("assignedById"),
  assignedAt: timestamp("assignedAt"),
  estimatedHours: decimal("estimatedHours", { precision: 8, scale: 2 }),
  actualHours: decimal("actualHours", { precision: 8, scale: 2 }),
  estimatedCost: decimal("estimatedCost", { precision: 15, scale: 2 }),
  actualCost: decimal("actualCost", { precision: 15, scale: 2 }),
  laborCost: decimal("laborCost", { precision: 15, scale: 2 }),
  sprintPoints: int("sprintPoints").default(0),
  locationLat: decimal("locationLat", { precision: 10, scale: 8 }),
  locationLng: decimal("locationLng", { precision: 11, scale: 8 }),
  locationDetail: varchar("locationDetail", { length: 300 }),
  isCriticalPath: boolean("isCriticalPath").default(false).notNull(),
  issueLevel: mysqlEnum("issueLevel", ["low", "medium", "high", "critical"]),
  tags: json("tags").$type<string[]>(),
  checklist: json("checklist").$type<{ id: string; text: string; done: boolean }[]>(),
  attachments: json("attachments").$type<{ name: string; url: string; uploadedAt: string }[]>(),
  inventoryRequestId: int("inventoryRequestId"),
  completedAt: timestamp("completedAt"),
  completedById: int("completedById"),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ct_projectId").on(t.projectId),
  index("idx_ct_phaseId").on(t.phaseId),
  index("idx_ct_activityId").on(t.activityId),
  index("idx_ct_status").on(t.status),
  index("idx_ct_assignedToId").on(t.assignedToId),
  index("idx_ct_priority").on(t.priority),
  index("idx_ct_endDatePlanned").on(t.endDatePlanned),
]);
export type ConstructionTask = typeof constructionTasks.$inferSelect;
export type InsertConstructionTask = typeof constructionTasks.$inferInsert;

// ── 5. Task Comments ────────────────────────────────────────
export const constructionTaskComments = mysqlTable("construction_task_comments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  userName: varchar("userName", { length: 200 }).notNull(),
  userRole: varchar("userRole", { length: 50 }).notNull(),
  comment: text("comment").notNull(),
  attachmentUrls: json("attachmentUrls"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ctc_taskId").on(t.taskId),
  index("idx_ctc_projectId").on(t.projectId),
]);
export type ConstructionTaskComment = typeof constructionTaskComments.$inferSelect;
export type InsertConstructionTaskComment = typeof constructionTaskComments.$inferInsert;

// ── 6. Task Dependencies ────────────────────────────────────
export const constructionTaskDependencies = mysqlTable("construction_task_dependencies", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  dependsOnTaskId: int("dependsOnTaskId").notNull(),
  dependencyType: mysqlEnum("dependencyType", [...constructionDependencyTypes]).default("finish_to_start").notNull(),
  lagDays: int("lagDays").default(0),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_ctd_taskId").on(t.taskId),
  index("idx_ctd_dependsOnTaskId").on(t.dependsOnTaskId),
]);
export type ConstructionTaskDependency = typeof constructionTaskDependencies.$inferSelect;
export type InsertConstructionTaskDependency = typeof constructionTaskDependencies.$inferInsert;

// ── 7. Project Members ──────────────────────────────────────
export const constructionProjectMembers = mysqlTable("construction_project_members", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", [...constructionMemberRoles]).default("viewer").notNull(),
  canEdit: boolean("canEdit").default(false).notNull(),
  canDelete: boolean("canDelete").default(false).notNull(),
  canApprove: boolean("canApprove").default(false).notNull(),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  addedById: int("addedById").notNull(),
}, (t) => [
  index("idx_cpm_projectId").on(t.projectId),
  index("idx_cpm_userId").on(t.userId),
]);
export type ConstructionProjectMember = typeof constructionProjectMembers.$inferSelect;
export type InsertConstructionProjectMember = typeof constructionProjectMembers.$inferInsert;

// ── 8. Time Logs ────────────────────────────────────────────
export const constructionTimeLogs = mysqlTable("construction_time_logs", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  startTime: timestamp("startTime"),
  endTime: timestamp("endTime"),
  durationMinutes: int("durationMinutes"),
  description: text("description"),
  logType: mysqlEnum("logType", [...constructionTimeLogTypes]).default("manual").notNull(),
  hourlyRate: decimal("hourlyRate", { precision: 10, scale: 2 }),
  totalCost: decimal("totalCost", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ctl_taskId").on(t.taskId),
  index("idx_ctl_projectId").on(t.projectId),
  index("idx_ctl_userId").on(t.userId),
]);
export type ConstructionTimeLog = typeof constructionTimeLogs.$inferSelect;
export type InsertConstructionTimeLog = typeof constructionTimeLogs.$inferInsert;

// ── 9. Custom Fields ────────────────────────────────────────
export const constructionCustomFields = mysqlTable("construction_custom_fields", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  fieldType: mysqlEnum("fieldType", [...constructionFieldTypes]).notNull(),
  options: json("options"),
  isRequired: boolean("isRequired").default(false).notNull(),
  orderIndex: int("orderIndex").default(0).notNull(),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ccf_projectId").on(t.projectId),
]);
export type ConstructionCustomField = typeof constructionCustomFields.$inferSelect;
export type InsertConstructionCustomField = typeof constructionCustomFields.$inferInsert;

// ── 10. Field Values ────────────────────────────────────────
export const constructionFieldValues = mysqlTable("construction_field_values", {
  id: int("id").autoincrement().primaryKey(),
  fieldId: int("fieldId").notNull(),
  taskId: int("taskId").notNull(),
  value: text("value"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cfv_taskId").on(t.taskId),
  index("idx_cfv_fieldId").on(t.fieldId),
]);
export type ConstructionFieldValue = typeof constructionFieldValues.$inferSelect;
export type InsertConstructionFieldValue = typeof constructionFieldValues.$inferInsert;

// ── 11. Automations ─────────────────────────────────────────
export const constructionAutomations = mysqlTable("construction_automations", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  triggerType: mysqlEnum("triggerType", [...constructionTriggerTypes]).notNull(),
  triggerCondition: json("triggerCondition"),
  actionType: mysqlEnum("actionType", [...constructionActionTypes]).notNull(),
  actionConfig: json("actionConfig"),
  lastRunAt: timestamp("lastRunAt"),
  runCount: int("runCount").default(0),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_caut_projectId").on(t.projectId),
  index("idx_caut_isActive").on(t.isActive),
  index("idx_caut_triggerType").on(t.triggerType),
]);
export type ConstructionAutomation = typeof constructionAutomations.$inferSelect;
export type InsertConstructionAutomation = typeof constructionAutomations.$inferInsert;

// ── 12. Goals ───────────────────────────────────────────────
export const constructionGoals = mysqlTable("construction_goals", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  goalType: mysqlEnum("goalType", [...constructionGoalTypes]).default("completion").notNull(),
  targetValue: decimal("targetValue", { precision: 10, scale: 2 }),
  currentValue: decimal("currentValue", { precision: 10, scale: 2 }).default("0"),
  unit: varchar("unit", { length: 50 }),
  dueDate: varchar("dueDate", { length: 10 }),
  status: mysqlEnum("status", [...constructionGoalStatuses]).default("on_track").notNull(),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cg_projectId").on(t.projectId),
  index("idx_cg_status").on(t.status),
]);
export type ConstructionGoal = typeof constructionGoals.$inferSelect;
export type InsertConstructionGoal = typeof constructionGoals.$inferInsert;

// ── 13. Daily Reports ───────────────────────────────────────
export const constructionDailyReports = mysqlTable("construction_daily_reports", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  reportDate: varchar("reportDate", { length: 10 }).notNull(),
  weather: mysqlEnum("weather", [...constructionWeatherTypes]).default("sunny").notNull(),
  workerCount: int("workerCount").default(0),
  workCompleted: text("workCompleted"),
  obstacles: text("obstacles"),
  materialsUsed: text("materialsUsed"),
  safetyNotes: text("safetyNotes"),
  tomorrowPlan: text("tomorrowPlan"),
  photoUrls: json("photoUrls"),
  submittedById: int("submittedById").notNull(),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
  approvedById: int("approvedById"),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cdr_projectId").on(t.projectId),
  index("idx_cdr_reportDate").on(t.reportDate),
]);
export type ConstructionDailyReport = typeof constructionDailyReports.$inferSelect;
export type InsertConstructionDailyReport = typeof constructionDailyReports.$inferInsert;

// ── 14. Quantity Tracking ───────────────────────────────────
export const constructionQuantityTracking = mysqlTable("construction_quantity_tracking", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  projectId: int("projectId").notNull(),
  materialName: varchar("materialName", { length: 300 }).notNull(),
  unit: varchar("unit", { length: 50 }).notNull(),
  quantityPlanned: decimal("quantityPlanned", { precision: 12, scale: 3 }).default("0"),
  quantityActual: decimal("quantityActual", { precision: 12, scale: 3 }).default("0"),
  unitCostPlanned: decimal("unitCostPlanned", { precision: 12, scale: 2 }),
  unitCostActual: decimal("unitCostActual", { precision: 12, scale: 2 }),
  // TODO: Connect to inventory module later
  inventoryItemId: int("inventoryItemId"),
  notes: text("notes"),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cqt_taskId").on(t.taskId),
  index("idx_cqt_projectId").on(t.projectId),
]);
export type ConstructionQuantityTracking = typeof constructionQuantityTracking.$inferSelect;
export type InsertConstructionQuantityTracking = typeof constructionQuantityTracking.$inferInsert;

// ── 15. Change Orders ───────────────────────────────────────
export const constructionChangeOrders = mysqlTable("construction_change_orders", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  phaseId: int("phaseId"),
  activityId: int("activityId"),
  changeNumber: varchar("changeNumber", { length: 20 }).notNull().unique(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description").notNull(),
  reason: mysqlEnum("reason", [...constructionChangeReasons]).notNull(),
  impactDays: int("impactDays").default(0),
  impactCost: decimal("impactCost", { precision: 15, scale: 2 }).default("0"),
  status: mysqlEnum("status", [...constructionChangeStatuses]).default("pending").notNull(),
  requestedById: int("requestedById").notNull(),
  approvedById: int("approvedById"),
  approvedAt: timestamp("approvedAt"),
  rejectionReason: text("rejectionReason"),
  attachmentUrls: json("attachmentUrls"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cco_projectId").on(t.projectId),
  index("idx_cco_status").on(t.status),
]);
export type ConstructionChangeOrder = typeof constructionChangeOrders.$inferSelect;
export type InsertConstructionChangeOrder = typeof constructionChangeOrders.$inferInsert;

// ── 16. Safety Logs ─────────────────────────────────────────
export const constructionSafetyLogs = mysqlTable("construction_safety_logs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  logDate: varchar("logDate", { length: 10 }).notNull(),
  incidentType: mysqlEnum("incidentType", [...constructionIncidentTypes]).notNull(),
  severity: mysqlEnum("severity", [...constructionSeverities]).default("low").notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description").notNull(),
  location: varchar("location", { length: 300 }),
  involvedPersons: text("involvedPersons"),
  immediateAction: text("immediateAction"),
  correctiveAction: text("correctiveAction"),
  photoUrls: json("photoUrls"),
  reportedById: int("reportedById").notNull(),
  investigatedById: int("investigatedById"),
  isClosed: boolean("isClosed").default(false).notNull(),
  closedAt: timestamp("closedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_csl_projectId").on(t.projectId),
  index("idx_csl_logDate").on(t.logDate),
  index("idx_csl_severity").on(t.severity),
  index("idx_csl_incidentType").on(t.incidentType),
]);
export type ConstructionSafetyLog = typeof constructionSafetyLogs.$inferSelect;
export type InsertConstructionSafetyLog = typeof constructionSafetyLogs.$inferInsert;

export const deliveryDocuments = mysqlTable("delivery_documents", {
  id: int("id").autoincrement().primaryKey(),
  deliveryNumber: varchar("deliveryNumber", { length: 20 }).notNull(),
  poItemId: int("poItemId").notNull(),
  itemName: varchar("itemName", { length: 300 }).notNull(),
  deliveredByName: varchar("deliveredByName", { length: 200 }).notNull(),
  deliveredToName: varchar("deliveredToName", { length: 200 }).notNull(),
  quantity: int("quantity").notNull(),
  unit: varchar("unit", { length: 50 }),
  supplierName: varchar("supplierName", { length: 300 }),
  actualUnitCost: varchar("actualUnitCost", { length: 50 }),
  poNumber: varchar("poNumber", { length: 100 }),
  warehousePhotoUrl: text("warehousePhotoUrl"),
  notes: text("notes"),
  pdfKey: text("pdfKey"),
  pdfUrl: text("pdfUrl"),
  printCount: int("printCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ── وثائق المرتجعات — تُنشأ تلقائياً بالخادم مع كل مرتجع (0037) ──
export const returnDocuments = mysqlTable("return_documents", {
  id: int("id").autoincrement().primaryKey(),
  returnNumber: varchar("returnNumber", { length: 20 }).notNull(),
  returnId: int("returnId").notNull(),
  itemName: varchar("itemName", { length: 300 }).notNull(),
  internalCode: varchar("internalCode", { length: 50 }), // رقم الصنف الداخلي (0039)
  manufacturerBarcode: varchar("manufacturerBarcode", { length: 100 }), // لتوليد QR الوثيقة (0039)
  returnedQuantity: int("returnedQuantity").notNull(),
  unit: varchar("unit", { length: 50 }),
  reason: text("reason").notNull(),
  returnedByName: varchar("returnedByName", { length: 200 }).notNull(),
  recipientName: varchar("recipientName", { length: 200 }), // من استلم الصنف المرتجَع (0038)
  receiptNumber: varchar("receiptNumber", { length: 20 }),
  invoiceNumber: varchar("invoiceNumber", { length: 100 }), // رقم فاتورة المورد الأصلية (0040)
  vendorName: varchar("vendorName", { length: 300 }),
  poNumber: varchar("poNumber", { length: 100 }),
  printCount: int("printCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const deliveryNumberCounter = mysqlTable("delivery_number_counter", {
  id: int("id").autoincrement().primaryKey(),
  year: int("year").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// DISPOSAL OPERATIONS — عمليات الاستبعاد
// ============================================================
export const disposalOperations = mysqlTable("disposal_operations", {
  id:              int("id").autoincrement().primaryKey(),
  operationNumber: varchar("operationNumber", { length: 30 }).notNull().unique(),
  operationDate:   date("operationDate").notNull(),
  warehouseId:     int("warehouseId"),
  status:          mysqlEnum("status", ["COMPLETED", "PENDING", "APPROVED", "REJECTED", "CANCELLED"]).notNull().default("COMPLETED"),
  notes:           text("notes"),
  createdBy:       int("createdBy").notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const disposalItems = mysqlTable("disposal_items", {
  id:          int("id").autoincrement().primaryKey(),
  operationId: int("operationId").notNull(),
  inventoryId: int("inventoryId").notNull(),
  quantity:    decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  reason:      mysqlEnum("reason", ["damaged", "expired", "missing", "other"]).notNull(),
  unitCost:    decimal("unitCost", { precision: 12, scale: 4 }).notNull().default("0"),
  totalCost:   decimal("totalCost", { precision: 14, scale: 2 }).notNull().default("0"),
  attachments: json("attachments"),
  notes:       text("notes"),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
});

export const disposalNumberCounter = mysqlTable("disposal_number_counter", {
  id:   int("id").autoincrement().primaryKey(),
  year: int("year").notNull(),
});

export const itemBarcodeCounter = mysqlTable("item_barcode_counter", {
  id: int("id").autoincrement().primaryKey(),
  year: int("year").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
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

// ══════════════════════════════════════════════════════════════════════════
// وحدة الجرد وتسوية المخزون
// ══════════════════════════════════════════════════════════════════════════
export const inventoryCountScopes = ["full", "partial"] as const;
export const inventoryCountStatuses = ["in_progress", "completed"] as const;
export const inventorySettlementSourceTypes = ["from_count", "manual"] as const;

export const inventoryCountOperations = mysqlTable("inventory_count_operations", {
  id:                 int("id").autoincrement().primaryKey(),
  operationNumber:    varchar("operationNumber", { length: 30 }).notNull().unique(),
  operationTitle:     varchar("operationTitle", { length: 200 }),   // عنوان الجرد (افتراضي: "جرد يوم <اليوم> بتاريخ <التاريخ>")
  operationDate:      date("operationDate").notNull(),             // تاريخ اليوم بتوقيت الرياض وقت الإنشاء — غير قابل للتعديل
  riyadhDayName:      varchar("riyadhDayName", { length: 20 }),     // اسم اليوم (الأربعاء...) بتوقيت الرياض — غير قابل للتعديل
  riyadhStartTime:    varchar("riyadhStartTime", { length: 8 }),    // ساعة بدء الجرد HH:MM:SS بتوقيت الرياض — غير قابل للتعديل
  scope:              mysqlEnum("scope", [...inventoryCountScopes]).notNull().default("full"),
  warehouseId:        int("warehouseId"),
  status:             mysqlEnum("status", [...inventoryCountStatuses]).notNull().default("in_progress"),
  totalItemsCounted:  int("totalItemsCounted").notNull().default(0),
  totalDiscrepancies: int("totalDiscrepancies").notNull().default(0),
  createdById:        int("createdById").notNull(),
  completedAt:        timestamp("completedAt"),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const inventoryCountItems = mysqlTable("inventory_count_items", {
  id:              int("id").autoincrement().primaryKey(),
  operationId:     int("operationId").notNull(),
  inventoryId:      int("inventoryId").notNull(),
  systemQuantity:   decimal("systemQuantity", { precision: 12, scale: 3 }).notNull(),
  countedQuantity:  decimal("countedQuantity", { precision: 12, scale: 3 }),
  diffQuantity:     decimal("diffQuantity", { precision: 12, scale: 3 }),
  lotNumber:        varchar("lotNumber", { length: 50 }),
  expiryDate:       date("expiryDate"),
  notes:            text("notes"),
  countedById:      int("countedById"),
  countedAt:        timestamp("countedAt"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
});

export const inventorySettlements = mysqlTable("inventory_settlements", {
  id:                     int("id").autoincrement().primaryKey(),
  settlementNumber:       varchar("settlementNumber", { length: 30 }).notNull().unique(),
  sourceType:             mysqlEnum("sourceType", [...inventorySettlementSourceTypes]).notNull().default("manual"),
  sourceCountOperationId: int("sourceCountOperationId"),
  status:                 mysqlEnum("status", ["applied"]).notNull().default("applied"),
  reason:                 text("reason").notNull(),
  appliedById:            int("appliedById").notNull(),
  appliedAt:              timestamp("appliedAt").defaultNow().notNull(),
  createdAt:              timestamp("createdAt").defaultNow().notNull(),
});

export const inventorySettlementItems = mysqlTable("inventory_settlement_items", {
  id:             int("id").autoincrement().primaryKey(),
  settlementId:   int("settlementId").notNull(),
  inventoryId:    int("inventoryId").notNull(),
  beforeQuantity: decimal("beforeQuantity", { precision: 12, scale: 3 }).notNull(),
  afterQuantity:  decimal("afterQuantity", { precision: 12, scale: 3 }).notNull(),
  diffQuantity:   decimal("diffQuantity", { precision: 12, scale: 3 }).notNull(),
  lotNumber:      varchar("lotNumber", { length: 50 }),
  expiryDate:     date("expiryDate"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export const inventoryCountNumberCounter = mysqlTable("inventory_count_number_counter", {
  id:   int("id").autoincrement().primaryKey(),
  year: int("year").notNull(),
});

export const inventorySettlementNumberCounter = mysqlTable("inventory_settlement_number_counter", {
  id:   int("id").autoincrement().primaryKey(),
  year: int("year").notNull(),
});

// ============================================================
// PM TREE — أمر العمل متعدد الفروع (الحل الهجين)
// ============================================================
// يربط أمر عمل وقائي واحد بواحد أو أكثر من فروع preventivePlans المُختارة
// عند إنشائه (تنفيذ مباشر / كل الفروع / اختيار جزئي). لكل فرع هنا نسخة
// مستقلة من "بنود الفحص" تُشتق من pmChecklistItems الخاصة بذاك الفرع.
export const pmWorkOrderBranches = mysqlTable("pm_work_order_branches", {
  id:          int("id").autoincrement().primaryKey(),
  workOrderId: int("workOrderId").notNull(),
  planId:      int("planId").notNull(), // الفرع (preventivePlans.id)
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  workOrderPlanIdx: index("pm_wo_branches_wo_plan_idx").on(table.workOrderId, table.planId),
}));
export type PMWorkOrderBranch = typeof pmWorkOrderBranches.$inferSelect;
export type InsertPMWorkOrderBranch = typeof pmWorkOrderBranches.$inferInsert;

// ============================================================
// PM MATERIAL REQUESTS — طلب مواد يمر إلزامياً عبر المستودع
// ============================================================
// الحالة الإجمالية للطلب (ملخّص مبني على بنوده — التفاصيل الفعلية والقرارات
// تكون على مستوى كل بند في pm_material_request_items لأن أمين المستودع قد
// يعتمد صنفاً ويرفض آخر ضمن نفس الطلب).
export const pmMaterialRequestStatuses = ["pending", "processed"] as const;
export type PMMaterialRequestStatus = typeof pmMaterialRequestStatuses[number];

export const pmMaterialRequests = mysqlTable("pm_material_requests", {
  id:               int("id").autoincrement().primaryKey(),
  workOrderId:      int("workOrderId").notNull(),
  checklistItemId:  int("checklistItemId"), // البند الذي استدعى طلب المواد (اختياري)
  requestedById:    int("requestedById").notNull(), // الفني
  requestNote:      text("requestNote"),
  status:           mysqlEnum("status", [...pmMaterialRequestStatuses]).default("pending").notNull(),
  reviewedById:     int("reviewedById"), // أمين المستودع
  reviewedAt:       timestamp("reviewedAt"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMMaterialRequest = typeof pmMaterialRequests.$inferSelect;
export type InsertPMMaterialRequest = typeof pmMaterialRequests.$inferInsert;

// حالات كل صنف ضمن الطلب — تمثّل دورة الحياة الكاملة المتفق عليها:
// pending → (approved | approved_partial | rejected_to_purchase) →
//   [rejected_to_purchase] → arrived_at_warehouse → delivered
//   [approved / approved_partial] → delivered (تسليم مباشر من المخزون الموجود)
export const pmMaterialRequestItemStatuses = [
  "pending",
  "approved",
  "approved_partial",
  "rejected_to_purchase",
  "arrived_at_warehouse",
  "ready_for_pickup",
  "delivered",
] as const;
export type PMMaterialRequestItemStatus = typeof pmMaterialRequestItemStatuses[number];

export const pmMaterialRequestItems = mysqlTable("pm_material_request_items", {
  id:                   int("id").autoincrement().primaryKey(),
  requestId:            int("requestId").notNull(),
  inventoryItemId:      int("inventoryItemId"),
  itemNameSnapshot:     varchar("itemNameSnapshot", { length: 300 }).notNull(), // نسخة من الاسم وقت الطلب (يبقى صحيحاً حتى لو تغيّر/حُذف الصنف لاحقاً)
  unit:                 varchar("unit", { length: 50 }),
  requestedQuantity:    decimal("requestedQuantity", { precision: 12, scale: 3 }).notNull(),
  approvedQuantity:     decimal("approvedQuantity", { precision: 12, scale: 3 }),
  status:               mysqlEnum("status", [...pmMaterialRequestItemStatuses]).default("pending").notNull(),
  warehouseNote:        text("warehouseNote"),
  linkedPurchaseOrderId: int("linkedPurchaseOrderId"), // عند التحويل لطلب شراء (rejected_to_purchase)
  deliveredById:        int("deliveredById"),
  deliveredAt:          timestamp("deliveredAt"),
  createdAt:            timestamp("createdAt").defaultNow().notNull(),
  updatedAt:            timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMMaterialRequestItem = typeof pmMaterialRequestItems.$inferSelect;
export type InsertPMMaterialRequestItem = typeof pmMaterialRequestItems.$inferInsert;

// ============================================================
// PM PLANS (NEW ARCHITECTURE) — خطط الصيانة الدورية منفصلة عن الشجرة
// ============================================================
// الشجرة (preventivePlans) تبقى هيكلاً تنظيمياً بحتاً (موقع ← قسم تشغيلي ←
// أقسام صيانة) ولا تتأثر أبداً بإنشاء/تعديل/حذف أي خطة. الجداول التالية
// مستقلة تماماً، وتشير لعقد الشجرة بحقول عادية (بدون قيود FK فعلية بقاعدة
// البيانات، اتساقاً مع بقية المشروع) لأغراض القراءة فقط.

// pm_main_plans: البطاقة الرئيسية — واحدة فقط لكل فرع تشغيلي (فرع جذري في
// preventivePlans، parentId IS NULL). العنوان لا يُخزَّن هنا؛ يُشتق دائماً
// وقت العرض من اسم الفرع + اسم الموقع (مصدر حقيقة واحد لا يتكرر).
export const pmMainPlans = mysqlTable("pm_main_plans", {
  id:            int("id").autoincrement().primaryKey(),
  branchId:      int("branchId").notNull(), // preventivePlans.id (فرع تشغيلي جذري) — فريد
  createdById:   int("createdById").notNull(),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
  updatedAt:     timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMMainPlan = typeof pmMainPlans.$inferSelect;
export type InsertPMMainPlan = typeof pmMainPlans.$inferInsert;

// pm_sub_plans: الخطة الفرعية الفعلية (تكرار + قسم صيانة مسؤول + مسؤول
// التنفيذ + وصف). عنوانها يُولَّد تلقائياً في الراوتر من "التكرار + قسم
// الصيانة" ويُخزَّن هنا (مع نسخ الترجمة) لأنه فعلياً بيانات الخطة لا مجرد عرض.
export const pmSubPlans = mysqlTable("pm_sub_plans", {
  id:                       int("id").autoincrement().primaryKey(),
  mainPlanId:               int("mainPlanId").notNull(),
  sectionBranchId:          int("sectionBranchId").notNull(), // preventivePlans.id (قسم الصيانة، عادة ابن مباشر للفرع الجذري)
  title:                    varchar("title", { length: 300 }).notNull(),
  title_ar:                 varchar("title_ar", { length: 300 }),
  title_en:                 varchar("title_en", { length: 300 }),
  title_ur:                 varchar("title_ur", { length: 300 }),
  originalLanguage:         mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  frequency:                mysqlEnum("frequency", ["daily", "weekly", "monthly", "quarterly", "biannual", "annual"]).notNull(),
  frequencyValue:           int("frequencyValue").default(1).notNull(),
  estimatedDurationMinutes: int("estimatedDurationMinutes"),
  assignedToId:             int("assignedToId"),
  description:              text("description"),
  description_ar:           text("description_ar"),
  description_en:           text("description_en"),
  description_ur:           text("description_ur"),
  isActive:                 boolean("isActive").default(true).notNull(),
  nextDueDate:              timestamp("nextDueDate"),
  lastGeneratedAt:          timestamp("lastGeneratedAt"),
  createdById:              int("createdById").notNull(),
  createdAt:                timestamp("createdAt").defaultNow().notNull(),
  updatedAt:                timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMSubPlan = typeof pmSubPlans.$inferSelect;
export type InsertPMSubPlan = typeof pmSubPlans.$inferInsert;

// pm_sub_plan_checklist_items: قائمة التحقق الخاصة بكل خطة فرعية — مستقلة
// عن pm_checklist_items القديم (المرتبط بالشجرة). لا قوالب مشتركة؛ كل خطة
// فرعية تملك بنودها الخاصة.
export const pmSubPlanChecklistItems = mysqlTable("pm_sub_plan_checklist_items", {
  id:               int("id").autoincrement().primaryKey(),
  subPlanId:        int("subPlanId").notNull(),
  orderIndex:       int("orderIndex").default(0).notNull(),
  text:             text("text").notNull(),
  text_ar:          text("text_ar"),
  text_en:          text("text_en"),
  text_ur:          text("text_ur"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  isRequired:       boolean("isRequired").default(true).notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PMSubPlanChecklistItem = typeof pmSubPlanChecklistItems.$inferSelect;
export type InsertPMSubPlanChecklistItem = typeof pmSubPlanChecklistItems.$inferInsert;

