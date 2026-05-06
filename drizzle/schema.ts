import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, json, boolean } from "drizzle-orm/mysql-core";

// ============================================================
// 1. USERS TABLE (extended with CMMS roles)
// ============================================================
export const userRoles = ["operator", "technician", "maintenance_manager", "supervisor", "purchase_manager", "delegate", "accountant", "senior_management", "warehouse", "gate_security", "owner"] as const;
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
  // Phase 1: Technician preparation layer — specialty fields (additive, nullable, backward-compatible)
  specialty: varchar("specialty", { length: 200 }),
  specialtyEn: varchar("specialtyEn", { length: 200 }),
  specialtyUr: varchar("specialtyUr", { length: 200 }),
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
// 2c. TECHNICIANS (External technicians without system accounts)
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
  // New Workflow statuses
  "pending_triage", "under_inspection", "work_approved",
  // Path A (Internal Direct)
  "ready_for_closure",
  // Path B (Internal with Procurement)
  "approved", "assigned", "in_progress",
  "needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting",
  "purchase_pending_management", "purchase_approved", "partial_purchase",
  "purchased", "received_warehouse",
  // Path C (External)
  "out_for_repair",
  // Final
  "repaired", "verified", "closed"
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
  assignedTechnicianId: int("assignedTechnicianId"),  // External technician (no system account)
  assignedAt: timestamp("assignedAt"),  // When technician was assigned
  approvedById: int("approvedById"),
  // Workflow fields
  maintenancePath: mysqlEnum("maintenancePath", ["A", "B", "C"]),  // A=Internal Direct, B=Internal+Procurement, C=External
  ticketType: mysqlEnum("ticketType", ["internal", "external", "procurement"]),
  supervisorId: int("supervisorId"),  // Eng. Khaled
  inspectionNotes: text("inspectionNotes"),
  justification: text("justification"),  // Required for Path C
  triageNotes: text("triageNotes"),
  // Gate/Security fields (Path C)
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
  // Auto-translation fields
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
  "approved", "partial_purchase", "purchased", "received", "closed", "rejected"
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
  rejectedById: int("rejectedById"),
  rejectedAt: timestamp("rejectedAt"),
  rejectionReason: text("rejectionReason"),
  notes: text("notes"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ============================================================
// 5. PURCHASE ORDER ITEMS (per-item tracking)
// ============================================================
export const poItemStatuses = ["pending", "estimated", "approved", "rejected", "funded", "purchased", "delivered_to_warehouse", "delivered_to_requester"] as const;

export const purchaseOrderItems = mysqlTable("purchase_order_items", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull(),
  itemName: varchar("itemName", { length: 300 }).notNull(),
  description: text("description"),
  quantity: int("quantity").default(1).notNull(),
  unit: varchar("unit", { length: 50 }),
  photoUrl: text("photoUrl"),
  notes: text("notes"),
  delegateId: int("delegateId"),
  rejectionReason: text("rejectionReason"),
  estimatedUnitCost: decimal("estimatedUnitCost", { precision: 12, scale: 2 }),
  estimatedTotalCost: decimal("estimatedTotalCost", { precision: 12, scale: 2 }),
  actualUnitCost: decimal("actualUnitCost", { precision: 12, scale: 2 }),
  actualTotalCost: decimal("actualTotalCost", { precision: 12, scale: 2 }),
  supplierName: varchar("supplierName", { length: 300 }),
  invoicePhotoUrl: text("invoicePhotoUrl"),
  purchasedPhotoUrl: text("purchasedPhotoUrl"),
  status: mysqlEnum("status", [...poItemStatuses]).default("pending").notNull(),
  purchasedAt: timestamp("purchasedAt"),
  purchasedById: int("purchasedById"),
  // Warehouse receiving (delivery to company)
  supplierItemName: varchar("supplierItemName", { length: 300 }),
  warehousePhotoUrl: text("warehousePhotoUrl"),
  receivedAt: timestamp("receivedAt"),
  receivedById: int("receivedById"),
  // Final delivery to requester/technician
  deliveredAt: timestamp("deliveredAt"),
  deliveredById: int("deliveredById"),
  deliveredToId: int("deliveredToId"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// 8. NOTIFICATIONS
// ============================================================
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  message: text("message").notNull(),
  type: mysqlEnum("type", ["info", "warning", "error", "success", "critical"]).default("info").notNull(),
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
// 11. ATTACHMENTS (generic file storage)
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
});

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
// 13. ENTITY TRANSLATIONS (Central Multilingual Engine)
// ============================================================
export const translationStatuses = ["pending", "processing", "completed", "failed", "approved"] as const;
export type TranslationStatus = typeof translationStatuses[number];

export const entityTranslations = mysqlTable("entity_translations", {
  id: int("id").autoincrement().primaryKey(),
  entityType: varchar("entityType", { length: 50 }).notNull(), // TICKET, PO, PO_ITEM, INVENTORY, etc
  entityId: int("entityId").notNull(),
  fieldName: varchar("fieldName", { length: 100 }).notNull(), // title, description, notes, etc
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

// ============================================================
// 13. TRANSLATION JOBS (Async Queue)
// ============================================================
export const translationJobStatuses = ["pending", "processing", "completed", "failed"] as const;

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

// ============================================================
// 14. TRANSLATION VERSIONS (History)
// ============================================================
export const translationVersions = mysqlTable("translation_versions", {
  id: int("id").autoincrement().primaryKey(),
  entityTranslationId: int("entityTranslationId").notNull(),
  versionNumber: int("versionNumber").notNull(),
  translatedText: text("translatedText"),
  translationStatus: varchar("translationStatus", { length: 20 }).notNull(),
  changedById: int("changedById"),
  changeReason: varchar("changeReason", { length: 50 }), // auto_translate, manual_edit, re_translate
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================
// 15. ASSETS (إدارة الأصول)
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
  // Auto-translation fields
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

// RFID Tag type


// ============================================================
// 16. PREVENTIVE MAINTENANCE PLANS (خطط الصيانة الوقائية)
// ============================================================
export const pmFrequencies = ["daily", "weekly", "monthly", "quarterly", "biannual", "annual"] as const;
export type PMFrequency = typeof pmFrequencies[number];

export const preventivePlans = mysqlTable("preventive_plans", {
  id: int("id").autoincrement().primaryKey(),
  planNumber: varchar("planNumber", { length: 50 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  assetId: int("assetId"),
  siteId: int("siteId"),
  frequency: mysqlEnum("frequency", ["daily", "weekly", "monthly", "quarterly", "biannual", "annual"]).notNull(),
  frequencyValue: int("frequencyValue").default(1).notNull(), // e.g. every 2 months
  estimatedDurationMinutes: int("estimatedDurationMinutes"),
  assignedToId: int("assignedToId"), // default technician
  checklist: json("checklist"), // array of {id, text, required}
  isActive: boolean("isActive").default(true).notNull(),
  lastGeneratedAt: timestamp("lastGeneratedAt"),
  nextDueDate: timestamp("nextDueDate"),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PreventivePlan = typeof preventivePlans.$inferSelect;
export type InsertPreventivePlan = typeof preventivePlans.$inferInsert;

// ============================================================
// 17. PREVENTIVE MAINTENANCE WORK ORDERS (أوامر العمل الوقائية)
// ============================================================
export const pmWorkOrderStatuses = ["scheduled", "in_progress", "completed", "overdue", "cancelled"] as const;

export const pmWorkOrders = mysqlTable("pm_work_orders", {
  id: int("id").autoincrement().primaryKey(),
  workOrderNumber: varchar("workOrderNumber", { length: 50 }).notNull().unique(),
  planId: int("planId").notNull(),
  assetId: int("assetId"),
  siteId: int("siteId"),
  title: varchar("title", { length: 200 }).notNull(),
  scheduledDate: timestamp("scheduledDate").notNull(),
  completedDate: timestamp("completedDate"),
  status: mysqlEnum("status", ["scheduled", "in_progress", "completed", "overdue", "cancelled"]).default("scheduled").notNull(),
  assignedToId: int("assignedToId"),
  checklistResults: json("checklistResults"), // array of {id, text, done, notes}
  technicianNotes: text("technicianNotes"),
  completionPhotoUrl: text("completionPhotoUrl"),
  // Auto-translation fields
  technicianNotes_ar: text("technicianNotes_ar"),
  technicianNotes_en: text("technicianNotes_en"),
  technicianNotes_ur: text("technicianNotes_ur"),
  originalLanguage: mysqlEnum("originalLanguage", ["ar", "en", "ur"]).default("ar").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PMWorkOrder = typeof pmWorkOrders.$inferSelect;
export type InsertPMWorkOrder = typeof pmWorkOrders.$inferInsert;

// ============================================================
// ASSET SPARE PARTS - ربط الأصول بالأجزاء (M:M)
// ============================================================
export const assetSpareParts = mysqlTable("asset_spare_parts", {
  id: int("id").autoincrement().primaryKey(),
  assetId: int("assetId").notNull(),
  inventoryItemId: int("inventoryItemId").notNull(),
  minStockLevel: int("minStockLevel").default(5).notNull(), // الحد الأدنى للتنبيه
  preferredQuantity: int("preferredQuantity").default(10).notNull(), // الكمية المفضلة للطلب
  notes: text("notes"), // ملاحظات خاصة بهذا الجزء للأصل
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AssetSparePart = typeof assetSpareParts.$inferSelect;
export type InsertAssetSparePart = typeof assetSpareParts.$inferInsert;

// ============================================================
// PREVENTIVE MAINTENANCE JOBS - وظائف الصيانة الوقائية التلقائية
// ============================================================
export const pmJobs = mysqlTable("pm_jobs", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("planId").notNull(),
  assetId: int("assetId").notNull(),
  ticketId: int("ticketId"), // البلاغ المُنشأ تلقائياً
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
// ASSET PERFORMANCE METRICS - مؤشرات أداء الأصول
// ============================================================
export const assetMetrics = mysqlTable("asset_metrics", {
  id: int("id").autoincrement().primaryKey(),
  assetId: int("assetId").notNull().unique(),
  totalTickets: int("totalTickets").default(0).notNull(),
  closedTickets: int("closedTickets").default(0).notNull(),
  totalDowntime: int("totalDowntime").default(0).notNull(), // بالدقائق
  mttr: decimal("mttr", { precision: 10, scale: 2 }).default("0").notNull(), // Mean Time To Repair (بالساعات)
  mtbf: decimal("mtbf", { precision: 10, scale: 2 }).default("0").notNull(), // Mean Time Between Failures (بالساعات)
  availability: decimal("availability", { precision: 5, scale: 2 }).default("100").notNull(), // النسبة المئوية
  lastFailureDate: timestamp("lastFailureDate"),
  lastRepairDate: timestamp("lastRepairDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AssetMetrics = typeof assetMetrics.$inferSelect;
export type InsertAssetMetrics = typeof assetMetrics.$inferInsert;


// ============================================================
// 14. TWO-FACTOR AUTHENTICATION (2FA)
// ============================================================
export const twoFactorSecrets = mysqlTable("two_factor_secrets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  secret: varchar("secret", { length: 255 }).notNull(), // Base32 encoded secret
  backupCodes: text("backupCodes").notNull(), // JSON array of hashed backup codes
  isEnabled: boolean("isEnabled").default(false).notNull(),
  enabledAt: timestamp("enabledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TwoFactorSecret = typeof twoFactorSecrets.$inferSelect;
export type InsertTwoFactorSecret = typeof twoFactorSecrets.$inferInsert;

// ============================================================
// 15. TWO-FACTOR AUTHENTICATION AUDIT LOG
// ============================================================
export const twoFactorAuditLogs = mysqlTable("two_factor_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 50 }).notNull(), // "setup", "verify_success", "verify_failed", "disable", "backup_code_used"
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  success: boolean("success").notNull(),
  details: text("details"), // JSON with additional info
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TwoFactorAuditLog = typeof twoFactorAuditLogs.$inferSelect;
export type InsertTwoFactorAuditLog = typeof twoFactorAuditLogs.$inferInsert;

// ============================================================
// 18. WEB PUSH SUBSCRIPTIONS
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
// 19. PM CHECKLIST ITEMS (بنود قائمة الفحص المنفصلة)
// ============================================================
// Each preventive plan can have multiple checklist items stored as rows
export const pmChecklistItems = mysqlTable("pm_checklist_items", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("planId").notNull(), // FK → preventive_plans.id
  orderIndex: int("orderIndex").default(0).notNull(), // ترتيب البند
  text: text("text").notNull(), // نص البند
  text_ar: text("text_ar"),
  text_en: text("text_en"),
  isRequired: boolean("isRequired").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PMChecklistItem = typeof pmChecklistItems.$inferSelect;
export type InsertPMChecklistItem = typeof pmChecklistItems.$inferInsert;

// ============================================================
// 20. PM EXECUTION RESULTS (نتائج تنفيذ بنود الفحص)
// ============================================================
// Each work order execution stores per-item results
export const pmItemResultStatuses = ["ok", "fixed", "issue"] as const;
export type PMItemResultStatus = typeof pmItemResultStatuses[number];

export const pmExecutionResults = mysqlTable("pm_execution_results", {
  id: int("id").autoincrement().primaryKey(),
  workOrderId: int("workOrderId").notNull(), // FK → pm_work_orders.id
  checklistItemId: int("checklistItemId").notNull(), // FK → pm_checklist_items.id
  status: mysqlEnum("status", ["ok", "fixed", "issue"]).notNull(), // ✅ سليم | 🛠️ إصلاح فوري | ⚠️ يوجد خلل
  fixNotes: text("fixNotes"), // ملاحظة الإصلاح الفوري
  photoUrl: text("photoUrl"), // صورة توثيق
  linkedTicketId: int("linkedTicketId"), // FK → tickets.id (إذا تم فتح بلاغ)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PMExecutionResult = typeof pmExecutionResults.$inferSelect;
export type InsertPMExecutionResult = typeof pmExecutionResults.$inferInsert;

// ============================================================
// 21. PM EXECUTION SESSIONS (جلسات تنفيذ الفحص)
// ============================================================
// Tracks the overall execution session (start/end time, duration)
export const pmExecutionSessionStatuses = ["in_progress", "completed", "paused"] as const;

export const pmExecutionSessions = mysqlTable("pm_execution_sessions", {
  id: int("id").autoincrement().primaryKey(),
  workOrderId: int("workOrderId").notNull().unique(), // FK → pm_work_orders.id
  technicianId: int("technicianId").notNull(), // FK → users.id
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  durationSeconds: int("durationSeconds"), // مدة التنفيذ بالثواني
  totalItems: int("totalItems").default(0).notNull(),
  okCount: int("okCount").default(0).notNull(),
  fixedCount: int("fixedCount").default(0).notNull(),
  issueCount: int("issueCount").default(0).notNull(),
  generalNotes: text("generalNotes"), // ملاحظات عامة
  status: mysqlEnum("status", ["in_progress", "completed", "paused"]).default("in_progress").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PMExecutionSession = typeof pmExecutionSessions.$inferSelect;
export type InsertPMExecutionSession = typeof pmExecutionSessions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Inspection Results — structured corrective maintenance inspection records
// ─────────────────────────────────────────────────────────────────────────────
export const inspectionResults = mysqlTable("inspection_results", {
  id:                int("id").autoincrement().primaryKey(),
  ticketId:          int("ticketId").notNull(),           // FK → tickets.id
  assetId:           int("assetId"),                      // FK → assets.id (nullable)
  inspectorId:       int("inspectorId").notNull(),        // FK → users.id
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
// ASSET CATEGORIES TABLE
// ============================================================
export const assetCategories = mysqlTable("asset_categories", {
  id:        int("id").primaryKey().autoincrement(),
  name:      varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AssetCategory = typeof assetCategories.$inferSelect;
export type InsertAssetCategory = typeof assetCategories.$inferInsert;
