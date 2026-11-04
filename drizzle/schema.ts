import { mysqlTable, mysqlSchema, AnyMySqlColumn, int, varchar, timestamp, decimal, text, mysqlEnum, index, uniqueIndex, json, foreignKey, date, smallint, tinyint } from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"

export const assetCategories = mysqlTable("asset_categories", {
	id: int().autoincrement().notNull(),
	name: varchar({ length: 255 }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const centerCategories = mysqlTable("center_categories", {
	id: int().autoincrement().notNull(),
	name: varchar({ length: 255 }).notNull(),
	// Internal immutable key for categories that drive system behavior.
	// Currently only `it` is reserved; ordinary categories keep this NULL.
	systemKey: varchar({ length: 50 }),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("center_categories_name_uq").on(table.name),
	uniqueIndex("center_categories_system_key_uq").on(table.systemKey),
	index("center_categories_active_idx").on(table.isActive),
]);

export const assetMetrics = mysqlTable("asset_metrics", {
	id: int().autoincrement().notNull(),
	assetId: int().notNull(),
	totalTickets: int().default(0).notNull(),
	closedTickets: int().default(0).notNull(),
	totalDowntime: int().default(0).notNull(),
	mttr: decimal({ precision: 10, scale: 2 }).default('0').notNull(),
	mtbf: decimal({ precision: 10, scale: 2 }).default('0').notNull(),
	availability: decimal({ precision: 5, scale: 2 }).default('100').notNull(),
	lastFailureDate: timestamp({ mode: 'string' }),
	lastRepairDate: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const assetSpareParts = mysqlTable("asset_spare_parts", {
	id: int().autoincrement().notNull(),
	assetId: int().notNull(),
	inventoryItemId: int().notNull(),
	minStockLevel: int().default(5).notNull(),
	preferredQuantity: int().default(10).notNull(),
	notes: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const assets = mysqlTable("assets", {
	id: int().autoincrement().notNull(),
	assetNumber: varchar({ length: 50 }).notNull(),
	name: varchar({ length: 200 }).notNull(),
	description: text(),
	category: varchar({ length: 100 }),
	brand: varchar({ length: 100 }),
	model: varchar({ length: 100 }),
	serialNumber: varchar({ length: 100 }),
	siteId: int(),
	locationDetail: varchar({ length: 200 }),
	status: mysqlEnum(['active','inactive','under_maintenance','disposed']).default('active').notNull(),
	purchaseDate: timestamp({ mode: 'string' }),
	purchaseCost: decimal({ precision: 12, scale: 2 }),
	warrantyExpiry: timestamp({ mode: 'string' }),
	warrantyNotes: text(),
	lastMaintenanceDate: timestamp({ mode: 'string' }),
	nextMaintenanceDate: timestamp({ mode: 'string' }),
	photoUrl: text(),
	qrCode: varchar({ length: 200 }),
	notes: text(),
	createdById: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	rfidTag: varchar({ length: 100 }),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	descriptionUr: text("description_ur"),
	notesAr: text("notes_ar"),
	notesEn: text("notes_en"),
	notesUr: text("notes_ur"),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	sectionId: int(),
	categoryId: int(),
});

export const attachments = mysqlTable("attachments", {
	id: int().autoincrement().notNull(),
	entityType: varchar({ length: 50 }).notNull(),
	entityId: int().notNull(),
	fileName: varchar({ length: 500 }).notNull(),
	fileUrl: text().notNull(),
	fileKey: varchar({ length: 500 }).notNull(),
	mimeType: varchar({ length: 100 }),
	fileSize: int(),
	uploadedById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("attachments_entity_type_id_idx").on(table.entityType, table.entityId),
]);

export const auditLogs = mysqlTable("audit_logs", {
	id: int().autoincrement().notNull(),
	userId: int(),
	action: varchar({ length: 100 }).notNull(),
	entityType: varchar({ length: 50 }).notNull(),
	entityId: int(),
	oldValues: json(),
	newValues: json(),
	ipAddress: varchar({ length: 45 }),
	userAgent: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// AI response cache — phase 1 zero-quality-loss optimization (2026-08-25).
// Stores only parsed AI results for exact, versioned inputs. It does not store API keys
// and does not replace confirmed supplier-item aliases. Cache misses always fall back to
// the existing DeepSeek flow.
export const aiResponseCache = mysqlTable("ai_response_cache", {
	id: int().autoincrement().notNull(),
	cacheKey: varchar({ length: 64 }).notNull(),
	feature: varchar({ length: 100 }).notNull(),
	operation: varchar({ length: 100 }).notNull(),
	cacheVersion: varchar({ length: 50 }).notNull(),
	responsePayload: json().notNull(),
	hitCount: int({ unsigned: true }).default(0).notNull(),
	expiresAt: timestamp({ mode: 'string' }).notNull(),
	lastHitAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_ai_response_cache_key").on(table.cacheKey),
	index("idx_ai_response_cache_feature").on(table.feature),
	index("idx_ai_response_cache_expires").on(table.expiresAt),
]);

export const backups = mysqlTable("backups", {
	id: int().autoincrement().notNull(),
	name: varchar({ length: 200 }).notNull(),
	description: text(),
	fileUrl: text().notNull(),
	fileKey: varchar({ length: 500 }).notNull(),
	fileSize: int(),
	tablesCount: int(),
	recordsCount: int(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const catalogAuditLogs = mysqlTable("catalog_audit_logs", {
	id: int().autoincrement().notNull(),
	userId: int(),
	action: varchar({ length: 100 }).notNull(),
	entityType: varchar({ length: 50 }).notNull(),
	entityId: int(),
	oldValues: text(),
	newValues: text(),
	ipAddress: varchar({ length: 45 }),
	userAgent: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const catalogCodeAliases = mysqlTable("catalog_code_aliases", {
	id: int().autoincrement().notNull(),
	entityType: mysqlEnum(['node','item']).notNull(),
	entityId: int().notNull(),
	oldCode: varchar({ length: 100 }).notNull(),
	newCode: varchar({ length: 100 }).notNull(),
	createdById: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("uq_catalog_code_alias_entity_id_old").on(table.entityType, table.entityId, table.oldCode),
	index("idx_catalog_code_alias_entity_id").on(table.entityType, table.entityId),
]);

export const catalogBusiness = mysqlTable("catalog_business", {
	id: int().autoincrement().notNull(),
	itemId: int().notNull(),
	supplierId: int(),
	supplierPartNumber: varchar({ length: 100 }),
	supplierNameAr: varchar({ length: 255 }),
	supplierNameEn: varchar({ length: 255 }),
	supplierNameUr: varchar({ length: 255 }),
	supplierContact: varchar({ length: 255 }),
	supplierEmail: varchar({ length: 255 }),
	supplierPhone: varchar({ length: 20 }),
	unitPrice: decimal({ precision: 12, scale: 4 }),
	currency: varchar({ length: 10 }).default('USD'),
	minimumOrderQuantity: int().default(1),
	leadTimeDays: int(),
	stockQuantity: int().default(0),
	reorderLevel: int().default(0),
	reorderQuantity: int().default(0),
	lastRestockDate: timestamp({ mode: 'string' }),
	costCenterAr: varchar({ length: 100 }),
	costCenterEn: varchar({ length: 100 }),
	costCenterUr: varchar({ length: 100 }),
	isPreferred: tinyint().default(0),
	isActive: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const catalogItemAlternatives = mysqlTable("catalog_item_alternatives", {
	id: int().autoincrement().notNull(),
	itemId: int().notNull(),
	alternativeItemId: int().notNull(),
	reasonAr: varchar({ length: 255 }),
	reasonEn: varchar({ length: 255 }),
	reasonUr: varchar({ length: 255 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const catalogItemCompatibility = mysqlTable("catalog_item_compatibility", {
	id: int().autoincrement().notNull(),
	itemId: int().notNull(),
	compatibleWithItemId: int().notNull(),
	compatibilityTypeAr: varchar({ length: 100 }),
	compatibilityTypeEn: varchar({ length: 100 }),
	compatibilityTypeUr: varchar({ length: 100 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const catalogItemImages = mysqlTable("catalog_item_images", {
	id: int().autoincrement().notNull(),
	itemId: int().notNull(),
	imageUrl: text().notNull(),
	imageType: mysqlEnum(['main','gallery','technical','supplier']).default('gallery'),
	sortOrder: int().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const catalogItemNodes = mysqlTable("catalog_item_nodes", {
	id: int().autoincrement().notNull(),
	itemId: int().notNull(),
	nodeId: int().notNull(),
	isPrimary: tinyint().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const catalogItemSpecs = mysqlTable("catalog_item_specs", {
	id: int().autoincrement().notNull(),
	itemId: int().notNull(),
	specKeyAr: varchar({ length: 255 }).notNull(),
	specKeyEn: varchar({ length: 255 }).notNull(),
	specKeyUr: varchar({ length: 255 }).notNull(),
	specValue: varchar({ length: 500 }),
	specUnit: varchar({ length: 50 }),
	sortOrder: int().default(0),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const catalogItems = mysqlTable("catalog_items", {
	id: int().autoincrement().notNull(),
	code: varchar({ length: 100 }),
	nameAr: varchar({ length: 255 }).notNull(),
	nameEn: varchar({ length: 255 }).notNull(),
	nameUr: varchar({ length: 255 }),
	descriptionAr: text(),
	descriptionEn: text(),
	descriptionUr: text(),
	unit: varchar({ length: 50 }),
	manufacturer: varchar({ length: 255 }),
	nodeId: int().notNull(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("catalog_items_name_en_idx").on(table.nameEn),
	index("catalog_items_node_id_idx").on(table.nodeId),
	index("catalog_items_name_ar_idx").on(table.nameAr),
	index("catalog_items_is_active_idx").on(table.isActive),
	index("catalog_items_code_idx").on(table.code),
]);

export const catalogItemsBackup20260601 = mysqlTable("catalog_items_backup_20260601", {
	id: int().autoincrement().notNull(),
	itemCode: varchar({ length: 100 }).notNull(),
	nameAr: varchar({ length: 255 }).notNull(),
	nameEn: varchar({ length: 255 }).notNull(),
	nameUr: varchar({ length: 255 }).notNull(),
	descriptionAr: text(),
	descriptionEn: text(),
	descriptionUr: text(),
	unit: varchar({ length: 50 }),
	manufacturer: varchar({ length: 255 }),
	manufacturerPartNumber: varchar({ length: 100 }),
	categoryId: int(),
	primaryImageUrl: text(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	code: varchar({ length: 100 }),
});

export const catalogKnowledge = mysqlTable("catalog_knowledge", {
	id: int().autoincrement().notNull(),
	itemId: int().notNull(),
	titleAr: varchar({ length: 255 }).notNull(),
	titleEn: varchar({ length: 255 }).notNull(),
	titleUr: varchar({ length: 255 }).notNull(),
	contentAr: text(),
	contentEn: text(),
	contentUr: text(),
	typeAr: varchar({ length: 100 }),
	typeEn: varchar({ length: 100 }),
	typeUr: varchar({ length: 100 }),
	documentUrl: text(),
	linkedAssetId: varchar({ length: 100 }),
	linkedEquipmentId: varchar({ length: 100 }),
	sparePartsList: text(),
	maintenanceInstructions: text(),
	isPublished: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const catalogNodes = mysqlTable("catalog_nodes", {
	id: int().autoincrement().notNull(),
	parentId: int(),
	nameAr: varchar({ length: 255 }).notNull(),
	nameEn: varchar({ length: 255 }).notNull(),
	nameUr: varchar({ length: 255 }),
	descriptionAr: text(),
	descriptionEn: text(),
	descriptionUr: text(),
	level: int().default(1).notNull(),
	sortOrder: int().default(0),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	code: varchar({ length: 50 }),
},
(table) => [
	uniqueIndex("catalog_nodes_code_unique").on(table.code),
]);

export const catalogSettings = mysqlTable("catalog_settings", {
	id: int().autoincrement().notNull(),
	settingKey: varchar({ length: 100 }).notNull(),
	settingValue: text(),
	settingType: mysqlEnum(['boolean','string','number','json']).default('string'),
	descriptionAr: text(),
	descriptionEn: text(),
	descriptionUr: text(),
	isActive: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const catalogSupplierPrices = mysqlTable("catalog_supplier_prices", {
	id: int().autoincrement().notNull(),
	itemId: int().notNull(),
	supplierId: int().notNull(),
	price: decimal({ precision: 12, scale: 2 }).notNull(),
	currency: varchar({ length: 10 }).default('SAR').notNull(),
	isPreferred: tinyint().default(0).notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	supplierItemCode: varchar({ length: 100 }),
	notes: text(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("uq_item_supplier").on(table.itemId, table.supplierId),
	index("idx_isp_item").on(table.itemId),
	index("idx_isp_supplier").on(table.supplierId),
	index("idx_isp_preferred").on(table.isPreferred),
]);

export const catalogSuppliers = mysqlTable("catalog_suppliers", {
	id: int().autoincrement().notNull(),
	nameAr: varchar({ length: 255 }).notNull(),
	nameEn: varchar({ length: 255 }).notNull(),
	contactName: varchar({ length: 255 }),
	phone: varchar({ length: 50 }),
	email: varchar({ length: 255 }),
	address: text(),
	taxNumber: varchar({ length: 50 }),
	commercialRegistration: varchar({ length: 100 }),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	country: varchar({ length: 100 }),
	notes: text(),
	isManufacturer: tinyint().default(0).notNull(),
},
(table) => [
	index("idx_suppliers_active").on(table.isActive),
	index("idx_suppliers_name").on(table.nameAr),
	index("idx_catalog_suppliers_tax_number").on(table.taxNumber),
	index("idx_catalog_suppliers_cr").on(table.commercialRegistration),
]);

// 2B-2: أسماء المورد البديلة كما تظهر في الفواتير أو الإدخال اليدوي.
// تبقى هوية المورد المركزية في catalog_suppliers، بينما هذه الأسماء تساعد
// المطابقة المستقبلية بدون إنشاء مورد مكرر بسبب اختلاف طريقة الكتابة.
export const catalogSupplierAliases = mysqlTable("catalog_supplier_aliases", {
	id: int().autoincrement().notNull(),
	supplierId: int().notNull(),
	aliasName: varchar({ length: 300 }).notNull(),
	normalizedAlias: varchar({ length: 300 }).notNull(),
	source: mysqlEnum(['invoice','manual','import']).default('invoice').notNull(),
	createdById: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("uq_catalog_supplier_alias").on(table.supplierId, table.normalizedAlias),
	index("idx_catalog_supplier_alias_normalized").on(table.normalizedAlias),
]);

// 2B-2: المورد الجديد لا يوقف الفاتورة أو الاستلام. ينشأ كمرشح
// Master Data، ثم يربطه مسؤول الكتالوج بمورد موجود أو يعتمد مورداً جديداً.
export const catalogSupplierCandidates = mysqlTable("catalog_supplier_candidates", {
	id: int().autoincrement().notNull(),
	receiptId: int(),
	purchaseOrderId: int(),
	invoiceNumber: varchar({ length: 100 }),
	invoicePhotoUrl: text(),
	extractedName: varchar({ length: 300 }).notNull(),
	extractedNameEn: varchar({ length: 300 }),
	taxNumber: varchar({ length: 50 }),
	commercialRegistration: varchar({ length: 100 }),
	phone: varchar({ length: 50 }),
	email: varchar({ length: 255 }),
	address: text(),
	status: mysqlEnum(['pending','linked_existing','approved_new','rejected']).default('pending').notNull(),
	resolvedSupplierId: int(),
	createdById: int().notNull(),
	resolvedById: int(),
	resolvedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_catalog_supplier_candidates_status").on(table.status),
	index("idx_catalog_supplier_candidates_receipt").on(table.receiptId),
	index("idx_catalog_supplier_candidates_po").on(table.purchaseOrderId),
]);

// 2B-3: ذاكرة أسماء وأكواد الصنف كما يستخدمها كل مورد.
// لا تستبدل Catalog Item المركزي ولا جدول الأسعار؛ تسمح بعدة aliases/SKU
// لنفس الصنف والمورد وتدعم المطابقة المستقبلية أثناء تحليل الفاتورة.
export const catalogSupplierItemAliases = mysqlTable("catalog_supplier_item_aliases", {
	id: int().autoincrement().notNull(),
	supplierId: int().notNull(),
	catalogItemId: int().notNull(),
	supplierItemName: varchar({ length: 300 }).notNull(),
	normalizedName: varchar({ length: 300 }).notNull(),
	supplierItemCode: varchar({ length: 100 }),
	normalizedItemCode: varchar({ length: 100 }),
	normalizedMeasurements: json(),
	source: mysqlEnum(['invoice','manual','import']).default('invoice').notNull(),
	confirmationCount: int().default(1).notNull(),
	lastConfirmedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	createdById: int(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_supplier_item_alias_supplier").on(table.supplierId),
	index("idx_supplier_item_alias_catalog_item").on(table.catalogItemId),
	index("idx_supplier_item_alias_name").on(table.supplierId, table.normalizedName),
	index("idx_supplier_item_alias_code").on(table.supplierId, table.normalizedItemCode),
]);

// 2B-5: Queue غير معطلة للأصناف التي استُلمت تشغيلياً قبل اعتماد Catalog Master.
// السجل يمثل هوية Inventory واحدة تنتظر مراجعة الكتالوج، وليس فاتورة واحدة؛
// لذلك inventoryId فريد لمنع تكرار نفس مهمة Master Data مع كل استلام لاحق.
export const catalogItemCandidates = mysqlTable("catalog_item_candidates", {
	id: int().autoincrement().notNull(),
	inventoryId: int().notNull(),
	sourceReceiptId: int().notNull(),
	sourceReceiptItemId: int().notNull(),
	purchaseOrderId: int(),
	purchaseOrderItemId: int(),
	catalogSupplierId: int(),
	supplierCandidateId: int(),
	invoiceNumber: varchar({ length: 100 }),
	itemName: varchar({ length: 300 }).notNull(),
	itemNameAr: text(),
	itemNameEn: text(),
	supplierItemCode: varchar({ length: 100 }),
	purchaseUnit: varchar({ length: 50 }),
	manufacturerBarcode: varchar({ length: 200 }),
	status: mysqlEnum(['pending','linked_existing','approved_new','rejected']).default('pending').notNull(),
	resolvedCatalogItemId: int(),
	createdById: int().notNull(),
	resolvedById: int(),
	resolvedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_catalog_item_candidates_inventory").on(table.inventoryId),
	index("idx_catalog_item_candidates_status").on(table.status),
	index("idx_catalog_item_candidates_receipt").on(table.sourceReceiptId),
	index("idx_catalog_item_candidates_receipt_item").on(table.sourceReceiptItemId),
	index("idx_catalog_item_candidates_po").on(table.purchaseOrderId),
	index("idx_catalog_item_candidates_supplier").on(table.catalogSupplierId),
	index("idx_catalog_item_candidates_resolved_item").on(table.resolvedCatalogItemId),
]);

// 2B-6: قرار مسؤول Master Data حول تشابه مرشحين جديدين.
// same_item يربط المرشح التابع بمرشح أساسي حتى يُحسما لاحقاً بنفس Catalog Item،
// وnot_same_item يمنع إعادة اقتراح نفس الزوج كتكرار بعد تأكيد المستخدم أنهما مختلفان.
export const catalogItemCandidateDuplicateDecisions = mysqlTable("catalog_item_candidate_duplicate_decisions", {
	id: int().autoincrement().notNull(),
	candidateLowId: int().notNull(),
	candidateHighId: int().notNull(),
	decision: mysqlEnum(['same_item','not_same_item']).notNull(),
	primaryCandidateId: int(),
	decidedById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_catalog_item_candidate_duplicate_pair").on(table.candidateLowId, table.candidateHighId),
	index("idx_catalog_item_candidate_duplicate_low").on(table.candidateLowId),
	index("idx_catalog_item_candidate_duplicate_high").on(table.candidateHighId),
	index("idx_catalog_item_candidate_duplicate_primary").on(table.primaryCandidateId),
]);

export const catalogUnits = mysqlTable("catalog_units", {
	id: int().autoincrement().notNull(),
	nameAr: varchar({ length: 100 }).notNull(),
	nameEn: varchar({ length: 100 }).notNull(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const constructionActivities = mysqlTable("construction_activities", {
	id: int().autoincrement().notNull(),
	phaseId: int().notNull().references(() => constructionPhases.id, { onDelete: "cascade" } ),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	name: varchar({ length: 300 }).notNull(),
	nameEn: varchar({ length: 300 }),
	description: text(),
	orderIndex: int().default(0).notNull(),
	status: mysqlEnum(['pending','active','on_hold','completed']).default('pending').notNull(),
	progressPercent: decimal({ precision: 5, scale: 2 }).default('0'),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	startDatePlanned: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	endDatePlanned: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	startDateActual: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	endDateActual: date({ mode: 'string' }),
	budgetPlanned: decimal({ precision: 15, scale: 2 }),
	budgetActual: decimal({ precision: 15, scale: 2 }),
	responsibleId: int(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	laborCost: decimal({ precision: 15, scale: 2 }),
	issueLevel: mysqlEnum(['low','medium','high','critical']),
	tags: json(),
	checklist: json(),
	attachments: json(),
},
(table) => [
	index("idx_ca_phaseId").on(table.phaseId),
	index("idx_ca_projectId").on(table.projectId),
	index("idx_ca_status").on(table.status),
	index("idx_ca_orderIndex").on(table.orderIndex),
]);

export const constructionAutomations = mysqlTable("construction_automations", {
	id: int().autoincrement().notNull(),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	name: varchar({ length: 200 }).notNull(),
	isActive: tinyint().default(1).notNull(),
	triggerType: mysqlEnum(['status_change','date_passed','task_completed','phase_completed','member_overloaded','daily_schedule']).notNull(),
	triggerCondition: json(),
	actionType: mysqlEnum(['create_purchase_order','send_notification','create_report','update_status','reassign_task','check_inventory']).notNull(),
	actionConfig: json(),
	lastRunAt: timestamp({ mode: 'string' }),
	runCount: int().default(0),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_caut_projectId").on(table.projectId),
	index("idx_caut_isActive").on(table.isActive),
	index("idx_caut_triggerType").on(table.triggerType),
]);

export const constructionChangeOrders = mysqlTable("construction_change_orders", {
	id: int().autoincrement().notNull(),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	phaseId: int(),
	activityId: int(),
	changeNumber: varchar({ length: 20 }).notNull(),
	title: varchar({ length: 300 }).notNull(),
	description: text().notNull(),
	reason: mysqlEnum(['design_change','client_request','site_condition','error_correction','other']).notNull(),
	impactDays: int().default(0),
	impactCost: decimal({ precision: 15, scale: 2 }).default('0'),
	status: mysqlEnum(['pending','approved','rejected']).default('pending').notNull(),
	requestedById: int().notNull(),
	approvedById: int(),
	approvedAt: timestamp({ mode: 'string' }),
	rejectionReason: text(),
	attachmentUrls: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_cco_projectId").on(table.projectId),
	index("idx_cco_status").on(table.status),
	index("changeNumber").on(table.changeNumber),
]);

export const constructionCustomFields = mysqlTable("construction_custom_fields", {
	id: int().autoincrement().notNull(),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	name: varchar({ length: 200 }).notNull(),
	fieldType: mysqlEnum(['text','number','date','dropdown','user','file','rating','url']).notNull(),
	options: json(),
	isRequired: tinyint().default(0).notNull(),
	orderIndex: int().default(0).notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_ccf_projectId").on(table.projectId),
]);

export const constructionDailyReports = mysqlTable("construction_daily_reports", {
	id: int().autoincrement().notNull(),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	reportDate: date({ mode: 'string' }).notNull(),
	weather: mysqlEnum(['sunny','cloudy','rainy','stormy','windy']).default('sunny').notNull(),
	workerCount: int().default(0),
	workCompleted: text(),
	obstacles: text(),
	materialsUsed: text(),
	safetyNotes: text(),
	tomorrowPlan: text(),
	photoUrls: json(),
	submittedById: int().notNull(),
	submittedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	approvedById: int(),
	approvedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("uq_project_report_date").on(table.projectId, table.reportDate),
	index("idx_cdr_projectId").on(table.projectId),
	index("idx_cdr_reportDate").on(table.reportDate),
]);

export const constructionFieldValues = mysqlTable("construction_field_values", {
	id: int().autoincrement().notNull(),
	fieldId: int().notNull().references(() => constructionCustomFields.id, { onDelete: "cascade" } ),
	taskId: int().notNull().references(() => constructionTasks.id, { onDelete: "cascade" } ),
	value: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("uq_field_task").on(table.fieldId, table.taskId),
	index("idx_cfv_taskId").on(table.taskId),
	index("idx_cfv_fieldId").on(table.fieldId),
]);

export const constructionGoals = mysqlTable("construction_goals", {
	id: int().autoincrement().notNull(),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	title: varchar({ length: 300 }).notNull(),
	description: text(),
	goalType: mysqlEnum(['completion','budget','quality','safety']).default('completion').notNull(),
	targetValue: decimal({ precision: 10, scale: 2 }),
	currentValue: decimal({ precision: 10, scale: 2 }).default('0'),
	unit: varchar({ length: 50 }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	dueDate: date({ mode: 'string' }),
	status: mysqlEnum(['on_track','at_risk','behind','completed']).default('on_track').notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_cg_projectId").on(table.projectId),
	index("idx_cg_status").on(table.status),
]);

export const constructionPhases = mysqlTable("construction_phases", {
	id: int().autoincrement().notNull(),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	name: varchar({ length: 300 }).notNull(),
	nameEn: varchar({ length: 300 }),
	description: text(),
	orderIndex: int().default(0).notNull(),
	status: mysqlEnum(['pending','active','on_hold','completed']).default('pending').notNull(),
	progressPercent: decimal({ precision: 5, scale: 2 }).default('0'),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	startDatePlanned: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	endDatePlanned: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	startDateActual: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	endDateActual: date({ mode: 'string' }),
	budgetPlanned: decimal({ precision: 15, scale: 2 }),
	budgetActual: decimal({ precision: 15, scale: 2 }),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	laborCost: decimal({ precision: 15, scale: 2 }),
	issueLevel: mysqlEnum(['low','medium','high','critical']),
	tags: json(),
	checklist: json(),
	attachments: json(),
},
(table) => [
	index("idx_cph_projectId").on(table.projectId),
	index("idx_cph_status").on(table.status),
	index("idx_cph_orderIndex").on(table.orderIndex),
]);

export const constructionProjectMembers = mysqlTable("construction_project_members", {
	id: int().autoincrement().notNull(),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	userId: int().notNull(),
	role: mysqlEnum(['manager','supervisor','engineer','technician','subcontractor','viewer']).default('viewer').notNull(),
	canEdit: tinyint().default(0).notNull(),
	canDelete: tinyint().default(0).notNull(),
	canApprove: tinyint().default(0).notNull(),
	joinedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	addedById: int().notNull(),
},
(table) => [
	index("uq_project_member").on(table.projectId, table.userId),
	index("idx_cpm_projectId").on(table.projectId),
	index("idx_cpm_userId").on(table.userId),
]);

export const constructionProjects = mysqlTable("construction_projects", {
	id: int().autoincrement().notNull(),
	projectNumber: varchar({ length: 20 }).notNull(),
	name: varchar({ length: 300 }).notNull(),
	nameEn: varchar({ length: 300 }),
	description: text(),
	status: mysqlEnum(['planning','active','on_hold','completed','cancelled']).default('planning').notNull(),
	priority: mysqlEnum(['low','medium','high','critical']).default('medium').notNull(),
	siteId: int(),
	sectionId: int(),
	ownerId: int().notNull(),
	managerId: int(),
	budgetPlanned: decimal({ precision: 15, scale: 2 }),
	budgetActual: decimal({ precision: 15, scale: 2 }),
	startDatePlanned: varchar({ length: 10 }),
	endDatePlanned: varchar({ length: 10 }),
	startDateActual: varchar({ length: 10 }),
	endDateActual: varchar({ length: 10 }),
	progressPercent: decimal({ precision: 5, scale: 2 }).default('0'),
	coverImageUrl: text(),
	isArchived: tinyint().default(0).notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	laborCost: decimal({ precision: 15, scale: 2 }),
	issueLevel: mysqlEnum(['low','medium','high','critical']),
	tags: json(),
	checklist: json(),
	attachments: json(),
},
(table) => [
	index("idx_cp_status").on(table.status),
	index("idx_cp_siteId").on(table.siteId),
	index("idx_cp_managerId").on(table.managerId),
	index("idx_cp_createdAt").on(table.createdAt),
	index("projectNumber").on(table.projectNumber),
]);

export const constructionQuantityTracking = mysqlTable("construction_quantity_tracking", {
	id: int().autoincrement().notNull(),
	taskId: int().notNull().references(() => constructionTasks.id, { onDelete: "cascade" } ),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	materialName: varchar({ length: 300 }).notNull(),
	unit: varchar({ length: 50 }).notNull(),
	quantityPlanned: decimal({ precision: 12, scale: 3 }).default('0'),
	quantityActual: decimal({ precision: 12, scale: 3 }).default('0'),
	unitCostPlanned: decimal({ precision: 12, scale: 2 }),
	unitCostActual: decimal({ precision: 12, scale: 2 }),
	inventoryItemId: int(),
	notes: text(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_cqt_taskId").on(table.taskId),
	index("idx_cqt_projectId").on(table.projectId),
]);

export const constructionSafetyLogs = mysqlTable("construction_safety_logs", {
	id: int().autoincrement().notNull(),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	logDate: varchar({ length: 10 }).notNull(),
	incidentType: mysqlEnum(['near_miss','minor_injury','major_injury','property_damage','safety_violation','inspection']).notNull(),
	severity: mysqlEnum(['low','medium','high','critical']).default('low').notNull(),
	title: varchar({ length: 300 }).notNull(),
	description: text().notNull(),
	location: varchar({ length: 300 }),
	involvedPersons: text(),
	immediateAction: text(),
	correctiveAction: text(),
	photoUrls: json(),
	reportedById: int().notNull(),
	investigatedById: int(),
	isClosed: tinyint().default(0).notNull(),
	closedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_csl_projectId").on(table.projectId),
	index("idx_csl_logDate").on(table.logDate),
	index("idx_csl_severity").on(table.severity),
	index("idx_csl_incidentType").on(table.incidentType),
]);

export const constructionTaskComments = mysqlTable("construction_task_comments", {
	id: int().autoincrement().notNull(),
	taskId: int().notNull().references(() => constructionTasks.id, { onDelete: "cascade" } ),
	projectId: int().notNull(),
	userId: int().notNull(),
	userName: varchar({ length: 200 }).notNull(),
	userRole: varchar({ length: 50 }).notNull(),
	comment: text().notNull(),
	attachmentUrls: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_ctc_taskId").on(table.taskId),
	index("idx_ctc_projectId").on(table.projectId),
]);

export const constructionTaskDependencies = mysqlTable("construction_task_dependencies", {
	id: int().autoincrement().notNull(),
	taskId: int().notNull().references(() => constructionTasks.id, { onDelete: "cascade" } ),
	dependsOnTaskId: int().notNull().references(() => constructionTasks.id, { onDelete: "cascade" } ),
	dependencyType: mysqlEnum(['finish_to_start','start_to_start','finish_to_finish','start_to_finish']).default('finish_to_start').notNull(),
	lagDays: int().default(0),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("uq_task_dependency").on(table.taskId, table.dependsOnTaskId),
	index("idx_ctd_taskId").on(table.taskId),
	index("idx_ctd_dependsOnTaskId").on(table.dependsOnTaskId),
]);

export const constructionTasks = mysqlTable("construction_tasks", {
	id: int().autoincrement().notNull(),
	taskNumber: varchar({ length: 20 }).notNull(),
	activityId: int().notNull().references(() => constructionActivities.id, { onDelete: "cascade" } ),
	phaseId: int().notNull().references(() => constructionPhases.id, { onDelete: "cascade" } ),
	projectId: int().notNull().references(() => constructionProjects.id, { onDelete: "cascade" } ),
	title: varchar({ length: 300 }).notNull(),
	description: text(),
	status: mysqlEnum(['new','in_progress','pending_approval','pending_materials','on_hold','completed']).default('new').notNull(),
	priority: mysqlEnum(['low','medium','high','critical']).default('medium').notNull(),
	holdReason: mysqlEnum(['weather','pending_approval','subcontractor','administrative','other']),
	holdNote: text(),
	progressPercent: decimal({ precision: 5, scale: 2 }).default('0'),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	startDatePlanned: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	endDatePlanned: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	startDateActual: date({ mode: 'string' }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	endDateActual: date({ mode: 'string' }),
	assignedToId: int(),
	assignedById: int(),
	assignedAt: timestamp({ mode: 'string' }),
	estimatedHours: decimal({ precision: 8, scale: 2 }),
	actualHours: decimal({ precision: 8, scale: 2 }),
	estimatedCost: decimal({ precision: 15, scale: 2 }),
	actualCost: decimal({ precision: 15, scale: 2 }),
	sprintPoints: int().default(0),
	locationLat: decimal({ precision: 10, scale: 8 }),
	locationLng: decimal({ precision: 11, scale: 8 }),
	locationDetail: varchar({ length: 300 }),
	isCriticalPath: tinyint().default(0).notNull(),
	inventoryRequestId: int(),
	completedAt: timestamp({ mode: 'string' }),
	completedById: int(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	laborCost: decimal({ precision: 15, scale: 2 }),
	issueLevel: mysqlEnum(['low','medium','high','critical']),
	tags: json(),
	checklist: json(),
	attachments: json(),
},
(table) => [
	index("idx_ct_projectId").on(table.projectId),
	index("idx_ct_phaseId").on(table.phaseId),
	index("idx_ct_activityId").on(table.activityId),
	index("idx_ct_status").on(table.status),
	index("idx_ct_assignedToId").on(table.assignedToId),
	index("idx_ct_priority").on(table.priority),
	index("idx_ct_endDatePlanned").on(table.endDatePlanned),
	index("idx_ct_status_createdAt").on(table.status, table.createdAt),
	index("taskNumber").on(table.taskNumber),
]);

export const constructionTimeLogs = mysqlTable("construction_time_logs", {
	id: int().autoincrement().notNull(),
	taskId: int().notNull().references(() => constructionTasks.id, { onDelete: "cascade" } ),
	projectId: int().notNull(),
	userId: int().notNull(),
	startTime: timestamp({ mode: 'string' }),
	endTime: timestamp({ mode: 'string' }),
	durationMinutes: int(),
	description: text(),
	logType: mysqlEnum(['auto','manual']).default('manual').notNull(),
	hourlyRate: decimal({ precision: 10, scale: 2 }),
	totalCost: decimal({ precision: 10, scale: 2 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_ctl_taskId").on(table.taskId),
	index("idx_ctl_projectId").on(table.projectId),
	index("idx_ctl_userId").on(table.userId),
	index("idx_ctl_startTime").on(table.startTime),
]);

export const deliveryDocuments = mysqlTable("delivery_documents", {
	id: int().autoincrement().notNull(),
	deliveryNumber: varchar({ length: 20 }).notNull(),
	poItemId: int().notNull(),
	inventoryId: int(),
	// 2B-8: الدفعة الفعلية التي صُرف منها هذا المستند. Nullable للتوافق التاريخي.
	lotId: int(),
	// 2B-8: ربط صريح بحركة المخزون الناتجة عن مستند الصرف.
	inventoryTransactionId: int(),
	ticketId: int(),
	ticketNumber: varchar({ length: 50 }),
	assignedTechnicianId: int(),
	assignedTechnicianName: varchar({ length: 200 }),
	deliveredToId: int(),
	itemName: varchar({ length: 300 }).notNull(),
	deliveredByName: varchar({ length: 200 }).notNull(),
	deliveredBySignatureSnapshot: text(),
	deliveredToName: varchar({ length: 200 }).notNull(),
	quantity: int().notNull(),
	unit: varchar({ length: 50 }),
	supplierName: varchar({ length: 300 }),
	actualUnitCost: varchar({ length: 50 }),
	poNumber: varchar({ length: 100 }),
	warehousePhotoUrl: text(),
	notes: text(),
	pdfKey: text(),
	pdfUrl: text(),
	printCount: int().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_delivery_documents_inventory").on(table.inventoryId),
	index("idx_delivery_documents_lotId").on(table.lotId),
	index("idx_delivery_documents_inventoryTransactionId").on(table.inventoryTransactionId),
	index("idx_delivery_documents_ticket").on(table.ticketId),
]);

// ══════════════════════════════════════════════════════════════════════
// warehouse_issue_batches — سند صرف مخزني تجميعي (WIS)
// طبقة تجميع فقط فوق مسار delivery_documents الحالي. لا تستبدل DLV ولا
// تغيّر ارتباطاته؛ كل بند WIS يحتفظ بهوية DLV/Inventory/Lot الناتجة فعلياً.
// ══════════════════════════════════════════════════════════════════════
export const warehouseIssueBatches = mysqlTable("warehouse_issue_batches", {
	id: int().autoincrement().primaryKey().notNull(),
	issueNumber: varchar({ length: 30 }).notNull(),
	warehouseId: int().notNull(),
	warehouseName: varchar({ length: 200 }).notNull(),
	deliveredToId: int().notNull(),
	deliveredToName: varchar({ length: 200 }).notNull(),
	issuedById: int().notNull(),
	issuedByName: varchar({ length: 200 }).notNull(),
	notes: text(),
	itemsCount: int().default(0).notNull(),
	status: mysqlEnum(['completed','cancelled']).default('completed').notNull(),
	printCount: int().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("uq_warehouse_issue_batches_number").on(table.issueNumber),
	index("idx_warehouse_issue_batches_warehouse").on(table.warehouseId),
	index("idx_warehouse_issue_batches_recipient").on(table.deliveredToId),
	index("idx_warehouse_issue_batches_created_by").on(table.issuedById),
]);

export const warehouseIssueBatchItems = mysqlTable("warehouse_issue_batch_items", {
	id: int().autoincrement().primaryKey().notNull(),
	// Patch 125: مطابق للجدول الفعلي الذي أُنشئ يدوياً في الإنتاج.
	// WIS يبقى طبقة تجميع؛ لا نضيف FK فعلياً إلى DLV/Inventory/Lot أو حتى
	// إلى الرأس حتى لا نفرض سياسة حذف جديدة على دورة الصرف الحالية.
	batchId: int().notNull(),
	deliveryDocumentId: int().notNull(),
	deliveryNumber: varchar({ length: 30 }).notNull(),
	inventoryTransactionId: int().notNull(),
	inventoryLotId: int().notNull(),
	lotCode: varchar({ length: 100 }).notNull(),
	inventoryId: int().notNull(),
	catalogItemId: int(),
	itemName: varchar({ length: 255 }).notNull(),
	itemCode: varchar({ length: 100 }),
	quantity: decimal({ precision: 12, scale: 3 }).notNull(),
	unit: varchar({ length: 50 }),
	referenceType: varchar({ length: 50 }),
	referenceId: int(),
	referenceNumber: varchar({ length: 100 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_warehouse_issue_batch_items_batch").on(table.batchId),
	index("idx_warehouse_issue_batch_items_delivery").on(table.deliveryDocumentId),
	index("idx_warehouse_issue_batch_items_lot").on(table.inventoryLotId),
]);

export const warehouseIssueBatchNumberCounter = mysqlTable("warehouse_issue_batch_number_counter", {
	id: int().autoincrement().primaryKey().notNull(),
	year: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const externalMaintenanceJobs = mysqlTable("external_maintenance_jobs", {
	id: int().autoincrement().notNull(),
	ticketId: int().notNull(),
	// بند البلاغ الذي يخص سجل الصيانة الخارجية هذا — الخطوة 5 من ميزة البلاغ
	// متعدد الجهات (2026-08-08). NULL للسجلات القديمة (تُملأ رجعيًا بترحيل
	// الخطوة نحو بند البلاغ الأول). بلا مفتاح خارجي فعلي، بنفس اتفاقية
	// ticketId ذاته غير المفروضة بقاعدة البيانات أصلًا بهذا المشروع.
	ticketItemId: int(),
	status: mysqlEnum([
		'waiting_warehouse_preparation',
		'waiting_gate_exit',
		'purchase_cycle',
		'waiting_gate_entry',
		'waiting_warehouse_receipt',
		'waiting_technician_handover',
		'delivered_for_reinstall',
		'reinstall_in_progress',
		'ready_for_closure',
		'closed',
	]).default('waiting_warehouse_preparation').notNull(),
	assetName: varchar({ length: 300 }),
	assetBeforePhotoUrl: text(),
	assetBeforeCondition: text(),
	delegateId: int(),
	warehousePreparedById: int(),
	warehousePreparedAt: timestamp({ mode: 'string' }),
	warehouseNotes: text(),
	exitDocumentNumber: varchar({ length: 40 }),
	gateExitApprovedById: int(),
	gateExitApprovedAt: timestamp({ mode: 'string' }),
	gateExitCarrierName: varchar({ length: 255 }),
	gateExitNotes: text(),
	purchaseOrderId: int(),
	delegateReadyForReturnById: int(),
	delegateReadyForReturnAt: timestamp({ mode: 'string' }),
	gateEntryApprovedById: int(),
	gateEntryApprovedAt: timestamp({ mode: 'string' }),
	gateEntryCarrierName: varchar({ length: 255 }),
	gateEntryNotes: text(),
	warehouseReceivedById: int(),
	warehouseReceivedAt: timestamp({ mode: 'string' }),
	assetAfterReturnPhotoUrl: text(),
	returnCondition: text(),
	workshopReportUrl: text(),
	warehouseReturnNotes: text(),
	returnDocumentNumber: varchar({ length: 40 }),
	assignedTechnicianId: int(),
	actualRecipientId: int(),
	handoverById: int(),
	handoverAt: timestamp({ mode: 'string' }),
	handoverNotes: text(),
	handoverDocumentNumber: varchar({ length: 40 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	// ⚠️ 2026-08-08 — الخطوة 5: الفهرس الفريد انتقل من ticketId (يمنع أكثر من
	// سجل صيانة خارجية واحد لكل *بلاغ*) إلى ticketItemId (يمنع أكثر من سجل
	// واحد لكل *بند* — NULL يُعامَل بتفرّد بـMySQL/TiDB فلا يمنع تكرار NULL،
	// بنفس نمط warehouseTransfers.batchId المعتمد بالمشروع). هذا يسمح لبلاغ
	// متعدد البنود أن يملك أكثر من سجل صيانة خارجية، بند لكل سجل.
	uniqueIndex("uq_external_maintenance_ticket_item").on(table.ticketItemId),
	index("idx_external_maintenance_ticket").on(table.ticketId),
	index("idx_external_maintenance_status").on(table.status),
	index("idx_external_maintenance_delegate").on(table.delegateId),
	index("idx_external_maintenance_po").on(table.purchaseOrderId),
]);

export const deliveryNumberCounter = mysqlTable("delivery_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const disposalItems = mysqlTable("disposal_items", {
	id: int().autoincrement().notNull(),
	operationId: int().notNull(),
	inventoryId: int().notNull(),
	// 2B-8: الدفعة المحددة التي أُتلفت/استُبعدت منها الكمية.
	lotId: int(),
	quantity: decimal({ precision: 12, scale: 3 }).notNull(),
	reason: mysqlEnum(['damaged','expired','missing','other']).notNull(),
	unitCost: decimal({ precision: 12, scale: 4 }).default('0').notNull(),
	totalCost: decimal({ precision: 14, scale: 2 }).default('0').notNull(),
	attachments: json(),
	notes: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_disposal_items_op").on(table.operationId),
	index("idx_disposal_items_inv").on(table.inventoryId),
	index("idx_disposal_items_lotId").on(table.lotId),
]);

export const disposalNumberCounter = mysqlTable("disposal_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
});

export const disposalOperations = mysqlTable("disposal_operations", {
	id: int().autoincrement().notNull(),
	operationNumber: varchar({ length: 30 }).notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	operationDate: date({ mode: 'string' }).notNull(),
	warehouseId: int(),
	status: mysqlEnum(['COMPLETED','PENDING','APPROVED','REJECTED','CANCELLED']).default('COMPLETED').notNull(),
	notes: text(),
	createdBy: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_disposal_ops_number").on(table.operationNumber),
	index("idx_disposal_ops_date").on(table.operationDate),
	index("idx_disposal_ops_created").on(table.createdBy),
	index("operationNumber").on(table.operationNumber),
]);

export const entityTranslations = mysqlTable("entity_translations", {
	id: int().autoincrement().notNull(),
	entityType: varchar({ length: 50 }).notNull(),
	entityId: int().notNull(),
	fieldName: varchar({ length: 100 }).notNull(),
	languageCode: mysqlEnum(['ar','en','ur']).notNull(),
	translatedText: text(),
	translationStatus: mysqlEnum(['pending','processing','completed','failed','approved']).default('pending').notNull(),
	versionNumber: int().default(1).notNull(),
	translationJobId: int(),
	lastAttemptAt: timestamp({ mode: 'string' }),
	errorMessage: text(),
	approvedById: int(),
	approvedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const improvementIdeas = mysqlTable("improvement_ideas", {
	id: int().autoincrement().notNull(),
	requestNumber: varchar({ length: 20 }).notNull(),
	title: varchar({ length: 300 }).notNull(),
	description: text(),
	category: mysqlEnum(['operational','technical','procedural','safety','quality','cost_reduction','productivity','innovative','work_note','recurring_problem']).notNull(),
	groupCategory: varchar({ length: 50 }),
	priority: mysqlEnum(['low','medium','high','critical']).default('medium').notNull(),
	status: mysqlEnum(['new','classified','approved','in_progress','completed','postponed','cancelled']).default('new').notNull(),
	expectedBenefit: text(),
	// Improvement workflow v3: legacy records retain costStudyRequired=0.
	executionTrackingVersion: tinyint().default(0).notNull(),
	currentSituation: text(),
	targetOutcome: text(),
	successMetric: text(),
	baselineValue: decimal({ precision: 14, scale: 2, mode: 'number' }),
	targetValue: decimal({ precision: 14, scale: 2, mode: 'number' }),
	costStudyRequired: tinyint().default(0).notNull(),
	estimatedMaterialsCost: decimal({ precision: 14, scale: 2, mode: 'number' }),
	estimatedLaborCost: decimal({ precision: 14, scale: 2, mode: 'number' }),
	estimatedServicesCost: decimal({ precision: 14, scale: 2, mode: 'number' }),
	costStudyNotes: text(),
	costStudyById: int(),
	costStudiedAt: timestamp({ mode: 'string' }),
	implementationOwner: varchar({ length: 200 }),
	implementationStartDate: date({ mode: 'string' }),
	implementationDueDate: date({ mode: 'string' }),
	implementationProgress: int().default(0).notNull(),
	implementationNotes: text(),
	actualCost: decimal({ precision: 14, scale: 2, mode: 'number' }),
	achievedValue: decimal({ precision: 14, scale: 2, mode: 'number' }),
	resultRating: mysqlEnum(['achieved','partial','not_achieved']),
	resultNotes: text(),
	evaluatedAt: timestamp({ mode: 'string' }),
	evaluatedById: int(),
	siteId: int(),
	sectionId: int(),
	assetId: int(),
	submittedById: int().notNull(),
	triagedById: int(),
	triagedAt: timestamp({ mode: 'string' }),
	decidedById: int(),
	decidedAt: timestamp({ mode: 'string' }),
	decisionNotes: text(),
	assignedToId: int(),
	linkedTicketId: int(),
	linkedPurchaseOrderId: int(),
	postponedUntil: timestamp({ mode: 'string' }),
	cancelReason: text(),
	completedAt: timestamp({ mode: 'string' }),
	completionNotes: text(),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	titleAr: text("title_ar"),
	titleEn: text("title_en"),
	titleUr: text("title_ur"),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	descriptionUr: text("description_ur"),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_improvement_ideas_requestNumber").on(table.requestNumber),
	index("idx_improvement_ideas_status").on(table.status),
	index("idx_improvement_ideas_submittedById").on(table.submittedById),
	index("idx_improvement_ideas_siteId").on(table.siteId),
	index("idx_improvement_ideas_sectionId").on(table.sectionId),
	index("idx_improvement_ideas_groupCategory").on(table.groupCategory),
]);

export const inspectionResults = mysqlTable("inspection_results", {
	id: int().autoincrement().notNull(),
	ticketId: int().notNull(),
	assetId: int(),
	// Kept for backward compatibility; new workflow also stores performed/recorded actors separately.
	inspectorId: int().notNull(),
	performedById: int(),
	recordedById: int(),
	inspectionType: mysqlEnum(['triage','detailed']).notNull(),
	severity: mysqlEnum(['low','medium','high','critical']).notNull(),
	rootCause: varchar({ length: 500 }),
	findings: text(),
	recommendedAction: text(),
	inspectionNotes: text(),
	workflowStatus: mysqlEnum([
		'maintenance_inspection_result_draft',
		'maintenance_inspection_result_submitted',
		'maintenance_inspection_result_returned',
		'maintenance_inspection_result_approved',
		'maintenance_inspection_result_superseded',
	]).default('maintenance_inspection_result_draft').notNull(),
	revisionNumber: int().default(1).notNull(),
	submittedAt: timestamp({ mode: 'string' }),
	approvedAt: timestamp({ mode: 'string' }),
	approvedById: int(),
	returnedAt: timestamp({ mode: 'string' }),
	returnedById: int(),
	returnReason: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_inspection_results_ticket_revision").on(table.ticketId, table.revisionNumber),
	index("idx_inspection_results_workflow_status").on(table.workflowStatus),
]);

export const inventory = mysqlTable("inventory", {
	id: int().autoincrement().notNull(),
	itemName: varchar({ length: 300 }).notNull(),
	description: text(),
	quantity: decimal({ precision: 12, scale: 3, mode: 'number' }).default(0).notNull(),
	unit: varchar({ length: 50 }),
	minQuantity: decimal({ precision: 12, scale: 3, mode: 'number' }).default(0),
	location: varchar({ length: 200 }),
	siteId: int(),
	lastRestockedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	internalCode: varchar({ length: 20 }),
	manufacturerBarcode: varchar({ length: 200 }),
	receiptId: int(),
	itemNameAr: text("itemName_ar"),
	itemNameEn: text("itemName_en"),
	itemNameUr: text("itemName_ur"),
	itemType: mysqlEnum(['spare_part','consumable','tool','food']).default('consumable').notNull(),
	averageCost: decimal({ precision: 12, scale: 4 }).default('0').notNull(),
	totalCostValue: decimal({ precision: 14, scale: 2 }).default('0').notNull(),
	purchaseUnit: varchar({ length: 50 }),
	issueUnit: varchar({ length: 50 }),
	conversionFactor: decimal({ precision: 10, scale: 4 }).default('1').notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	expiryDate: date({ mode: 'string' }),
	linkedItemId: int(),
	assetId: int(),
	warehouseId: int(),
	// أصناف قديمة مجمَّدة يدوياً (بدون Lot) — تُستبعد من قائمة المخزون الرئيسية
	// عبر getInventoryItems() فقط. راجع: docs/CMMS_INVENTORY_FROZEN_ITEMS_2026-08-29.md
	isFrozen: tinyint().default(0).notNull(),
});

// ══════════════════════════════════════════════════════════════════════
// 2B-8 — Inventory Lots / Receipt traceability
// Inventory remains the aggregate balance for Catalog Item + warehouse.
// inventory_lots identifies the physical/source lot; inventory_lot_balances
// tells where the remaining quantity of that same lot currently exists.
// No FK rollout here by design; governance remains deferred to 2B-10.
// ══════════════════════════════════════════════════════════════════════
// inventory_lot_number_counter — عداد مستقل خاص بأرقام LOT فقط (2026-08-25)
//
// لا يشارك في ترقيم المستندات ولا يغيّر قرار Centralized Document Numbering.
// الأرقام الجديدة فقط تأخذ LOT-YYYY-NNNNN، بينما LOTs التاريخية تبقى كما هي.
// ══════════════════════════════════════════════════════════════════════
export const inventoryLotNumberCounter = mysqlTable("inventory_lot_number_counter", {
	year: smallint({ unsigned: true }).notNull().primaryKey(),
	lastNumber: int({ unsigned: true }).default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

// ══════════════════════════════════════════════════════════════════════
export const inventoryLots = mysqlTable("inventory_lots", {
	id: int().autoincrement().notNull(),
	lotCode: varchar({ length: 50 }).notNull(),
	trackingToken: varchar({ length: 100 }).notNull(),
	sourceType: mysqlEnum(['receipt','opening_balance']).notNull(),
	catalogItemId: int(),
	receiptId: int(),
	receiptItemId: int(),
	purchaseOrderId: int(),
	purchaseOrderItemId: int(),
	catalogSupplierId: int(),
	supplierCandidateId: int(),
	sourceCountOperationId: int(),
	sourceSettlementId: int(),
	sourceSettlementItemId: int(),
	originalQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	remainingQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	purchaseUnit: varchar({ length: 50 }),
	issueUnit: varchar({ length: 50 }),
	conversionFactor: decimal({ precision: 10, scale: 4 }).default('1.0000').notNull(),
	purchaseUnitCost: decimal({ precision: 12, scale: 4 }),
	issueUnitCost: decimal({ precision: 12, scale: 4 }).default('0.0000').notNull(),
	supplierItemName: varchar({ length: 300 }),
	supplierItemCode: varchar({ length: 100 }),
	batchNumber: varchar({ length: 100 }),
	expiryDate: date({ mode: 'string' }),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_inventory_lots_lotCode").on(table.lotCode),
	uniqueIndex("uq_inventory_lots_trackingToken").on(table.trackingToken),
	index("idx_inventory_lots_catalogItemId").on(table.catalogItemId),
	index("idx_inventory_lots_receiptId").on(table.receiptId),
	index("idx_inventory_lots_receiptItemId").on(table.receiptItemId),
	index("idx_inventory_lots_purchaseOrderItemId").on(table.purchaseOrderItemId),
	index("idx_inventory_lots_catalogSupplierId").on(table.catalogSupplierId),
	index("idx_inventory_lots_sourceCountOperationId").on(table.sourceCountOperationId),
	index("idx_inventory_lots_sourceSettlementId").on(table.sourceSettlementId),
]);

export const inventoryLotBalances = mysqlTable("inventory_lot_balances", {
	id: int().autoincrement().notNull(),
	lotId: int().notNull(),
	inventoryId: int().notNull(),
	quantity: decimal({ precision: 12, scale: 3 }).default('0.000').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_inventory_lot_balances_lot_inventory").on(table.lotId, table.inventoryId),
	index("idx_inventory_lot_balances_inventoryId").on(table.inventoryId),
	index("idx_inventory_lot_balances_lotId").on(table.lotId),
]);

export const inventoryBackup20260704 = mysqlTable("inventory_backup_20260704", {
	id: int().autoincrement().notNull(),
	itemName: varchar({ length: 300 }).notNull(),
	description: text(),
	quantity: int().default(0).notNull(),
	unit: varchar({ length: 50 }),
	minQuantity: int().default(0),
	location: varchar({ length: 200 }),
	siteId: int(),
	lastRestockedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	internalCode: varchar({ length: 20 }),
	manufacturerBarcode: varchar({ length: 200 }),
	receiptId: int(),
	itemNameAr: text("itemName_ar"),
	itemNameEn: text("itemName_en"),
	itemNameUr: text("itemName_ur"),
	itemType: mysqlEnum(['spare_part','consumable','tool','food']).default('consumable').notNull(),
	averageCost: decimal({ precision: 12, scale: 4 }).default('0').notNull(),
	totalCostValue: decimal({ precision: 14, scale: 2 }).default('0').notNull(),
	purchaseUnit: varchar({ length: 50 }),
	issueUnit: varchar({ length: 50 }),
	conversionFactor: decimal({ precision: 10, scale: 4 }).default('1').notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	expiryDate: date({ mode: 'string' }),
	linkedItemId: int(),
	assetId: int(),
	warehouseId: int(),
});

// Main Phase 3 / Step 1 — immutable opening snapshot for periodic counts.
// This table is deliberately separate from inventory_count_items so a manual/QR partial
// count can preserve the warehouse state at operation opening without turning every
// snapshotted Lot into a mandatory count target.
export const inventoryCountSnapshots = mysqlTable("inventory_count_snapshots", {
	id: int().autoincrement().notNull(),
	operationId: int().notNull(),
	inventoryId: int().notNull(),
	lotId: int(),
	systemQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	averageCostSnapshot: decimal({ precision: 12, scale: 4 }).notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	expiryDate: date({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("inventory_count_snapshots_operation_idx").on(table.operationId),
	index("inventory_count_snapshots_inventory_idx").on(table.inventoryId),
	index("inventory_count_snapshots_lot_idx").on(table.lotId),
]);

export const inventoryCountItems = mysqlTable("inventory_count_items", {
	id: int().autoincrement().notNull(),
	operationId: int().notNull(),
	inventoryId: int().notNull(),
	// 2B-8: الجرد الدوري يصبح على مستوى الدفعة/QR، لا Inventory المجمع فقط.
	lotId: int(),
	systemQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	countedQuantity: decimal({ precision: 12, scale: 3 }),
	diffQuantity: decimal({ precision: 12, scale: 3 }),
	lotNumber: varchar({ length: 50 }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	expiryDate: date({ mode: 'string' }),
	notes: text(),
	countedById: int(),
	countedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("inventory_count_items_operation_idx").on(table.operationId),
	index("inventory_count_items_inventory_idx").on(table.inventoryId),
	index("idx_inventory_count_items_lotId").on(table.lotId),
	index("inventory_count_items_countedby_idx").on(table.countedById),
]);

export const inventoryCountNumberCounter = mysqlTable("inventory_count_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
});

export const inventoryCountOperations = mysqlTable("inventory_count_operations", {
	id: int().autoincrement().notNull(),
	operationNumber: varchar({ length: 30 }).notNull(),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	operationDate: date({ mode: 'string' }).notNull(),
	scope: mysqlEnum(['full','partial']).default('full').notNull(),
	// 2B-8: يفصل الجرد الدوري عن تأسيس الرصيد الافتتاحي.
	countType: mysqlEnum(['periodic','opening_balance']).default('periodic').notNull(),
	// 2B-9: نطاق تصنيف اختياري للجرد الدوري؛ المرجع المنطقي هو catalog_nodes.
	// لا نضيف FK هنا لأن الحوكمة الشاملة مؤجلة إلى 2B-10.
	catalogNodeId: int(),
	warehouseId: int(),
	status: mysqlEnum(['in_progress','completed']).default('in_progress').notNull(),
	totalItemsCounted: int().default(0).notNull(),
	totalDiscrepancies: int().default(0).notNull(),
	createdById: int().notNull(),
	completedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	operationTitle: varchar({ length: 200 }),
	riyadhDayName: varchar({ length: 20 }),
	riyadhStartTime: varchar({ length: 8 }),
},
(table) => [
	index("inventory_count_operations_number_unique").on(table.operationNumber),
	index("inventory_count_operations_warehouse_idx").on(table.warehouseId),
	index("inventory_count_operations_status_idx").on(table.status),
]);

export const inventorySettlementItems = mysqlTable("inventory_settlement_items", {
	id: int().autoincrement().notNull(),
	settlementId: int().notNull(),
	inventoryId: int().notNull(),
	// 2B-8: فرق الجرد يبقى مربوطاً بالدفعة التي تم عدّها.
	lotId: int(),
	beforeQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	afterQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	diffQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	// Main Phase 4 / Step 2: nullable for legacy rows; new supported settlements
	// will persist the posting valuation basis and signed financial adjustment.
	unitCostUsed: decimal({ precision: 12, scale: 4 }),
	adjustmentValue: decimal({ precision: 14, scale: 2 }),
	lotNumber: varchar({ length: 50 }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	expiryDate: date({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("inventory_settlement_items_inventory_idx").on(table.inventoryId),
	index("idx_inventory_settlement_items_lotId").on(table.lotId),
	index("inventory_settlement_items_settlement_idx").on(table.settlementId),
]);

export const inventorySettlementNumberCounter = mysqlTable("inventory_settlement_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
});

export const inventorySettlements = mysqlTable("inventory_settlements", {
	id: int().autoincrement().notNull(),
	settlementNumber: varchar({ length: 30 }).notNull(),
	sourceType: mysqlEnum(['from_count','manual']).default('manual').notNull(),
	sourceCountOperationId: int(),
	status: mysqlEnum(['applied']).default('applied').notNull(),
	reason: text().notNull(),
	// Optional external/document/business reference. Count linkage remains in
	// sourceCountOperationId and is not duplicated here automatically.
	reference: varchar({ length: 255 }),
	appliedById: int().notNull(),
	appliedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("inventory_settlements_number_unique").on(table.settlementNumber),
	index("inventory_settlements_source_count_idx").on(table.sourceCountOperationId),
	index("inventory_settlements_appliedby_idx").on(table.appliedById),
]);

// Review preparation never posts stock. Installed manually before feature activation.
export const inventorySettlementDrafts = mysqlTable("inventory_settlement_drafts", {
	id: int().autoincrement().primaryKey(),
	sourceCountOperationId: int().notNull(),
	status: mysqlEnum(["draft", "pending_review", "returned", "applied", "no_adjustment"]).default("draft").notNull(),
	version: int().default(1).notNull(),
	reason: text().notNull(),
	reference: varchar({ length: 255 }),
	preparedById: int().notNull(),
	lastSubmittedById: int(),
	submittedVersion: int(),
	sourceFingerprint: varchar({ length: 64 }),
	submittedSnapshot: json(),
	returnedReason: text(),
	appliedSettlementId: int(),
	correctsSettlementId: int(),
	approvedById: int(),
	submittedAt: timestamp({ mode: "string" }),
	appliedAt: timestamp({ mode: "string" }),
	createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
	updatedAt: timestamp({ mode: "string" }).defaultNow().onUpdateNow().notNull(),
}, table => [
	uniqueIndex("uq_settlement_draft_count").on(table.sourceCountOperationId),
	index("idx_settlement_draft_status").on(table.status, table.updatedAt),
	index("idx_settlement_draft_preparer").on(table.preparedById),
]);

// Append-only versions/events preserve every review decision and submitted count snapshot.
export const inventorySettlementDraftEvents = mysqlTable("inventory_settlement_draft_events", {
	id: int().autoincrement().primaryKey(),
	draftId: int().notNull(),
	version: int().notNull(),
	action: varchar({ length: 40 }).notNull(),
	actorId: int().notNull(),
	reason: text(),
	payload: json().notNull(),
	createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
}, table => [
	uniqueIndex("uq_settlement_event_version").on(table.draftId, table.version),
]);

// A reviewer authorizes named rows only. The original finalized values are never lost.
export const inventoryCountCorrections = mysqlTable("inventory_count_corrections", {
	id: int().autoincrement().primaryKey(),
	draftId: int().notNull(),
	operationId: int().notNull(),
	status: mysqlEnum(["pending", "corrected"]).default("pending").notNull(),
	requestedById: int().notNull(),
	requestedReason: text().notNull(),
	allowedCountItemIds: json().notNull(),
	sourceFingerprint: varchar({ length: 64 }).notNull(),
	beforeSnapshot: json().notNull(),
	afterSnapshot: json(),
	correctedById: int(),
	correctionReason: text(),
	correctedAt: timestamp({ mode: "string" }),
	createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
}, table => [
	index("idx_count_correction_draft_status").on(table.draftId, table.status),
	index("idx_count_correction_operation").on(table.operationId),
]);

// New operations only. Independent table keeps existing issue writes compatible before manual installation.
export const materialExecutionCostContexts = mysqlTable("material_execution_cost_contexts", {
	inventoryTransactionId: int().primaryKey().notNull(),
	executionSource: varchar({ length: 20 }).notNull(),
	executionId: int(),
	executionItemId: int(),
	executionNumber: varchar({ length: 100 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
}, table => [
	index("idx_material_execution_source").on(table.executionSource, table.executionId),
	foreignKey({ name: "fk_material_execution_movement", columns: [table.inventoryTransactionId], foreignColumns: [inventoryTransactions.id] }).onDelete("restrict").onUpdate("restrict"),
]);

export const inventoryIssueCostAllocations = mysqlTable("inventory_issue_cost_allocations", {
	id: int().autoincrement().notNull(),
	inventoryTransactionId: int().notNull(),
	inventoryId: int().notNull(),
	lotId: int().notNull(),
	deliveryNumber: varchar({ length: 50 }),
	beneficiarySiteId: int().notNull(),
	beneficiarySectionId: int(),
	beneficiaryAssetId: int(),
	quantity: decimal({ precision: 12, scale: 3 }).notNull(),
	lotIssueUnitCostSnapshot: decimal({ precision: 12, scale: 4 }).notNull(),
	allocatedCostTotal: decimal({ precision: 14, scale: 2 }).notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_issue_cost_tx").on(table.inventoryTransactionId),
	index("idx_issue_cost_inventory").on(table.inventoryId),
	index("idx_issue_cost_lot").on(table.lotId),
	index("idx_issue_cost_site_date").on(table.beneficiarySiteId, table.createdAt),
	index("idx_issue_cost_section_date").on(table.beneficiarySectionId, table.createdAt),
	index("idx_issue_cost_asset_date").on(table.beneficiaryAssetId, table.createdAt),
]);

export const inventoryTransactions = mysqlTable("inventory_transactions", {
	id: int().autoincrement().notNull(),
	inventoryId: int().notNull(),
	// 2B-8: الدفعة التي أثرت عليها الحركة. Nullable للتاريخ/المسارات غير المفعّلة بعد.
	lotId: int(),
	type: mysqlEnum(['in','out']).notNull(),
	quantity: decimal({ precision: 12, scale: 3, mode: 'number' }).notNull(),
	reason: text(),
	ticketId: int(),
	purchaseOrderItemId: int().references(() => purchaseOrderItems.id, { onDelete: "set null" } ),
	performedById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	transactionType: mysqlEnum(['purchase','return','delivery','adjustment','disposal','transfer']).default('adjustment').notNull(),
	receiptId: int(),
	returnId: int(),
	unitCost: decimal({ precision: 12, scale: 4 }),
	totalCost: decimal({ precision: 14, scale: 2 }),
	projectId: int(),
	departmentId: int(),
	assetId: int(),
	documentUrl: text(),
	invoiceNumber: varchar({ length: 100 }),
},
(table) => [
	index("inventory_tx_item_type_date_idx").on(table.inventoryId, table.transactionType, table.createdAt),
	index("idx_inventory_transactions_lotId").on(table.lotId),
	index("idx_invtx_purchaseOrderItemId").on(table.purchaseOrderItemId),
]);

export const inventoryTransactionsLegacyOrphans = mysqlTable("inventory_transactions_legacy_orphans", {
	id: int().notNull(),
	inventoryId: int().notNull(),
	type: varchar({ length: 10 }).notNull(),
	quantity: int().notNull(),
	reason: text(),
	ticketId: int(),
	purchaseOrderItemId: int(),
	performedById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).notNull(),
	transactionType: varchar({ length: 20 }),
	receiptId: int(),
	returnId: int(),
	unitCost: decimal({ precision: 12, scale: 4 }),
	totalCost: decimal({ precision: 14, scale: 2 }),
	projectId: int(),
	departmentId: int(),
	assetId: int(),
	documentUrl: text(),
	invoiceNumber: varchar({ length: 100 }),
	archivedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	archiveReason: varchar({ length: 500 }).default('بند طلب شراء حقيقي اختفى من purchase_order_items قبل بناء دورة المخزون (6-7-2026) — لا يمكن استرجاع الربط').notNull(),
});

export const itemBarcodeCounter = mysqlTable("item_barcode_counter", {
	id: int().autoincrement().notNull(),
	year: smallint().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).default('CURRENT_TIMESTAMP'),
});

export const notifications = mysqlTable("notifications", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	title: varchar({ length: 300 }).notNull(),
	message: text().notNull(),
	type: mysqlEnum(['info','warning','error','success','critical','ticket_updated','ticket_deleted','po_deleted','po_updated','low_stock']).default('info').notNull(),
	eventKey: varchar({ length: 80 }),
	relatedTicketId: int(),
	relatedPoId: int(),
	isRead: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_notifications_user_event_created").on(table.userId, table.eventKey, table.createdAt),
]);

export const ocrJobs = mysqlTable("ocr_jobs", {
	id: int().autoincrement().notNull(),
	receiptId: int(),
	purchaseOrderId: int(),
	status: mysqlEnum(['pending','processing','ocr_completed','needs_review','approved','failed']).default('pending').notNull(),
	imageUrl: text().notNull(),
	rawResponse: json(),
	extractedData: json(),
	confidence: decimal({ precision: 5, scale: 2 }),
	errorMessage: text(),
	processingMs: int(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	completedAt: timestamp({ mode: 'string' }),
	purchaseOrderItemId: int(),
	approvedById: int(),
	approvedAt: timestamp({ mode: 'string' }),
	needsManualReview: tinyint().default(0).notNull(),
	confidenceScore: decimal({ precision: 5, scale: 2 }),
},
(table) => [
	index("idx_ocr_jobs_receiptId").on(table.receiptId),
	index("idx_ocr_jobs_status").on(table.status),
]);

export const pmChecklistItems = mysqlTable("pm_checklist_items", {
	id: int().autoincrement().notNull(),
	planId: int().notNull(),
	orderIndex: int().default(0).notNull(),
	text: text().notNull(),
	textAr: text("text_ar"),
	textEn: text("text_en"),
	isRequired: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	textUr: text("text_ur"),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const pmExecutionResults = mysqlTable("pm_execution_results", {
	id: int().autoincrement().notNull(),
	workOrderId: int().notNull(),
	checklistItemId: int().notNull(),
	status: mysqlEnum(['ok','fixed','issue']).notNull(),
	fixNotes: text(),
	photoUrl: text(),
	linkedTicketId: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	fixNotesAr: text("fixNotes_ar"),
	fixNotesEn: text("fixNotes_en"),
	fixNotesUr: text("fixNotes_ur"),
});

export const pmExecutionSessions = mysqlTable("pm_execution_sessions", {
	id: int().autoincrement().notNull(),
	workOrderId: int().notNull(),
	technicianId: int().notNull(),
	startedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	completedAt: timestamp({ mode: 'string' }),
	durationSeconds: int(),
	totalItems: int().default(0).notNull(),
	okCount: int().default(0).notNull(),
	fixedCount: int().default(0).notNull(),
	issueCount: int().default(0).notNull(),
	generalNotes: text(),
	status: mysqlEnum(['in_progress','completed','paused']).default('in_progress').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	generalNotesAr: text("generalNotes_ar"),
	generalNotesEn: text("generalNotes_en"),
	generalNotesUr: text("generalNotes_ur"),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
});

export const pmJobs = mysqlTable("pm_jobs", {
	id: int().autoincrement().notNull(),
	planId: int().notNull(),
	assetId: int().notNull(),
	ticketId: int(),
	dueDate: timestamp({ mode: 'string' }).notNull(),
	executedDate: timestamp({ mode: 'string' }),
	status: mysqlEnum(['pending','executed','skipped','overdue']).default('pending').notNull(),
	autoCreatedTicket: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const pmMainPlans = mysqlTable("pm_main_plans", {
	id: int().autoincrement().notNull(),
	branchId: int().notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("pm_main_plans_branch_unique").on(table.branchId),
]);

export const pmMaterialRequestItems = mysqlTable("pm_material_request_items", {
	id: int().autoincrement().notNull(),
	requestId: int().notNull(),
	inventoryItemId: int(),
	itemNameSnapshot: varchar({ length: 300 }).notNull(),
	unit: varchar({ length: 50 }),
	requestedQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	approvedQuantity: decimal({ precision: 12, scale: 3 }),
	status: mysqlEnum(['pending','approved','approved_partial','rejected_to_purchase','arrived_at_warehouse','ready_for_pickup','delivered']).default('pending').notNull(),
	warehouseNote: text(),
	linkedPurchaseOrderId: int(),
	deliveredById: int(),
	deliveredAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("pm_material_request_items_request_idx").on(table.requestId),
	index("pm_material_request_items_status_idx").on(table.status),
]);

export const pmMaterialRequests = mysqlTable("pm_material_requests", {
	id: int().autoincrement().notNull(),
	workOrderId: int().notNull(),
	checklistItemId: int(),
	requestedById: int().notNull(),
	requestNote: text(),
	status: mysqlEnum(['pending','processed']).default('pending').notNull(),
	reviewedById: int(),
	reviewedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("pm_material_requests_wo_idx").on(table.workOrderId),
]);

export const pmSubPlanChecklistItems = mysqlTable("pm_sub_plan_checklist_items", {
	id: int().autoincrement().notNull(),
	subPlanId: int().notNull(),
	orderIndex: int().default(0).notNull(),
	text: text().notNull(),
	textAr: text("text_ar"),
	textEn: text("text_en"),
	textUr: text("text_ur"),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	isRequired: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("pm_sub_plan_checklist_items_sub_plan_idx").on(table.subPlanId),
]);

export const pmSubPlans = mysqlTable("pm_sub_plans", {
	id: int().autoincrement().notNull(),
	mainPlanId: int().notNull(),
	sectionBranchId: int().notNull(),
	title: varchar({ length: 300 }).notNull(),
	titleAr: varchar("title_ar", { length: 300 }),
	titleEn: varchar("title_en", { length: 300 }),
	titleUr: varchar("title_ur", { length: 300 }),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	frequency: mysqlEnum(['daily','weekly','monthly','quarterly','biannual','annual']).notNull(),
	frequencyValue: int().default(1).notNull(),
	estimatedDurationMinutes: int(),
	assignedToId: int(),
	description: text(),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	descriptionUr: text("description_ur"),
	isActive: tinyint().default(1).notNull(),
	nextDueDate: timestamp({ mode: 'string' }),
	lastGeneratedAt: timestamp({ mode: 'string' }),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("pm_sub_plans_main_plan_idx").on(table.mainPlanId),
	index("pm_sub_plans_section_branch_idx").on(table.sectionBranchId),
]);

export const pmWorkOrderBranches = mysqlTable("pm_work_order_branches", {
	id: int().autoincrement().notNull(),
	workOrderId: int().notNull(),
	planId: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("pm_wo_branches_wo_plan_idx").on(table.workOrderId, table.planId),
]);

export const pmWorkOrders = mysqlTable("pm_work_orders", {
	id: int().autoincrement().notNull(),
	workOrderNumber: varchar({ length: 50 }).notNull(),
	planId: int(),
	subPlanId: int(),
	assetId: int(),
	siteId: int(),
	title: varchar({ length: 200 }).notNull(),
	scheduledDate: timestamp({ mode: 'string' }).notNull(),
	completedDate: timestamp({ mode: 'string' }),
	status: mysqlEnum(['scheduled','in_progress','completed','overdue','cancelled']).default('scheduled').notNull(),
	hasPendingMaterials: tinyint().default(0).notNull(),
	assignedToId: int(),
	checklistResults: json(),
	technicianNotes: text(),
	completionPhotoUrl: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	technicianNotesAr: text("technicianNotes_ar"),
	technicianNotesEn: text("technicianNotes_en"),
	technicianNotesUr: text("technicianNotes_ur"),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	titleAr: varchar("title_ar", { length: 200 }),
	titleEn: varchar("title_en", { length: 200 }),
	titleUr: varchar("title_ur", { length: 200 }),
},
(table) => [
	index("pm_work_orders_sub_plan_idx").on(table.subPlanId),
]);

export const poPricingBatches = mysqlTable("po_pricing_batches", {
	id: int().autoincrement().notNull(),
	purchaseOrderId: int().notNull(),
	batchNumber: int().notNull(),
	submittedById: int().notNull(),
	submittedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	itemCount: int().default(0).notNull(),
	totalEstimatedCost: decimal({ precision: 12, scale: 2 }),
	status: mysqlEnum(['pending_accounting','pending_management','approved','rejected']).default('pending_accounting').notNull(),
	accountingApprovedById: int(),
	accountingApprovedAt: timestamp({ mode: 'string' }),
	accountingNotes: text(),
	accountingSignatureSnapshot: text(),
	custodyAmount: decimal({ precision: 12, scale: 2 }),
	managementApprovedById: int(),
	managementApprovedAt: timestamp({ mode: 'string' }),
	managementNotes: text(),
	rejectedById: int(),
	rejectedAt: timestamp({ mode: 'string' }),
	rejectionReason: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	delegateSignatureSnapshot: varchar({ length: 500 }),
	// [PB] موجود فعليًا بالقاعدة منذ 2026-08-26 (تنفيذ سابق للميزة، حُذف
	// كوده وبقيت القاعدة)، صفر استخدام حتى 2026-08-29 (275 صف كلها
	// 'single'). يُضبط 'multi' فقط عند إنشاء دفعة تسعير ضمن إرسال فرعي
	// عابر لعدة طلبات. الاستدعاء العادي (طلب واحد) يبقى 'single' كاليوم.
	scope: mysqlEnum(['single','multi']).default('single').notNull(),
	// [PB] موجود فعليًا بالقاعدة منذ 2026-08-26 — صفر استخدام. غير مستخدَم
	// في التصميم الحالي (الربط الفعلي عبر purchasePackageSubmissionId).
	packageId: int(),
	// [PB] ربط اختياري بالدفعة الفرعية (PB01-1...) عند إرسال المندوب
	// لأصناف من عدة طلبات بضغطة واحدة. NULL = دفعة تسعير عادية لطلب واحد
	// كاليوم تمامًا. عرضي بحت — لا يُستخدم كمفتاح في أي منطق اعتماد.
	purchasePackageSubmissionId: int(),
},
(table) => [
	index("po_pricing_batches_po_idx").on(table.purchaseOrderId),
	index("idx_po_pricing_batches_packageId").on(table.packageId),
	index("po_pricing_batches_submission_idx").on(table.purchasePackageSubmissionId),
]);

export const preventivePlans = mysqlTable("preventive_plans", {
	id: int().autoincrement().notNull(),
	planNumber: varchar({ length: 50 }).notNull(),
	parentId: int(),
	isGroupOnly: tinyint().default(0).notNull(),
	title: varchar({ length: 200 }).notNull(),
	description: text(),
	assetId: int(),
	siteId: int(),
	frequency: mysqlEnum(['daily','weekly','monthly','quarterly','biannual','annual']),
	frequencyValue: int().default(1),
	estimatedDurationMinutes: int(),
	assignedToId: int(),
	checklist: json(),
	isActive: tinyint().default(1).notNull(),
	lastGeneratedAt: timestamp({ mode: 'string' }),
	nextDueDate: timestamp({ mode: 'string' }),
	createdById: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	titleAr: varchar("title_ar", { length: 200 }),
	titleEn: varchar("title_en", { length: 200 }),
	titleUr: varchar("title_ur", { length: 200 }),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	descriptionUr: text("description_ur"),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	sectionId: int(),
},
(table) => [
	index("preventive_plans_parent_idx").on(table.parentId),
]);

export const procurementComments = mysqlTable("procurement_comments", {
	id: int().autoincrement().notNull(),
	purchaseOrderId: int().notNull(),
	userId: int().notNull(),
	userName: text().notNull(),
	userRole: varchar({ length: 50 }).notNull(),
	actionType: varchar({ length: 50 }).notNull(),
	note: text().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	purchaseOrderItemId: int(),
});

// سجل موحّد لتاريخ بند طلب الشراء. الغرض منه حفظ كل انتقال تشغيلي جديد
// (حالة/مندوب/دفعة) مع إبقاء السجلات القديمة قابلة للعرض من التعليقات وحقول
// التوقيت وaudit_logs. لا توجد FK فعلية التزامًا بنمط الجداول التشغيلية في المشروع.
export const purchaseOrderItemHistory = mysqlTable("purchase_order_item_history", {
	id: int().autoincrement().notNull(),
	purchaseOrderItemId: int().notNull(),
	purchaseOrderId: int().notNull(),
	eventType: varchar({ length: 80 }).notNull(),
	previousStatus: varchar({ length: 50 }),
	newStatus: varchar({ length: 50 }),
	previousDelegateId: int(),
	newDelegateId: int(),
	actorUserId: int(),
	actorName: varchar({ length: 300 }),
	note: text(),
	metadata: json(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_poi_history_item_created").on(table.purchaseOrderItemId, table.createdAt),
	index("idx_poi_history_po_created").on(table.purchaseOrderId, table.createdAt),
]);

// ============================================================
// [PB] PURCHASE PACKAGES — حاوية عليا فوق طلبات الشراء.
//
// purchase_packages وعمودا purchase_orders.packageId /
// po_pricing_batches.packageId + scope موجودون فعليًا بالقاعدة منذ
// 2026-08-26 (تنفيذ سابق للميزة، أُزيل كوده من المستودع وبقيت القاعدة).
// بتاريخ 2026-08-29 أُعيد تفريغهم (تصفير الربط على 7 طلبات + حذف 3 حزم
// تجريبية) ثم استُؤنف العمل عليهم. الجدولان الآخران أُنشئا 2026-08-29.
//
// تمييز مهم — لا تخلط بين المستويين:
//   po_pricing_batches  → دفعة تسعير داخل طلب شراء واحد (موجود سابقًا)
//   purchase_packages   → حزمة تضم عدة طلبات شراء كاملة (هذه الميزة)
//
// راجع drizzle/2026_08_29_purchase_packages_submissions.sql.
// ============================================================
export const purchasePackages = mysqlTable("purchase_packages", {
	id: int().autoincrement().notNull(),
	packageNumber: varchar({ length: 20 }).notNull(),
	createdById: int().notNull(),
	notes: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("purchase_packages_number_idx").on(table.packageNumber),
]);

// [PR] عدّاد ترقيم مستقل لطلبات الشراء (2026-09-02). تمت إضافته فعليًا
// لقاعدة البيانات بنفس نمط عدّادات المشروع المعتمدة. ربطه بمولّد رقم PR
// سيتم في خطوة مستقلة حتى لا يتغير السلوك التشغيلي الحالي قبل اعتماد الإصلاح.
export const purchaseOrderNumberCounter = mysqlTable("purchase_order_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// [PB] عدّاد ترقيم مستقل للحزمة (2026-08-29). AUTO_INCREMENT بقاعدة
// البيانات هو ضامن التفرّد — لا SELECT MAX الذي يعيد استخدام الرقم بعد
// الحذف. مربوط فعليًا بالكود من أول استخدام.
export const purchasePackageNumberCounter = mysqlTable("purchase_package_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// [PB] دفعة فرعية — تتبّع إرسال واحد من المندوب قد يضم أصنافًا من عدة
// طلبات داخل نفس الحزمة (PB01-1, PB01-2...). حقول المرحلة الأولى أدناه
// مضافة للقاعدة كحقول اختيارية ومتوافقة للخلف فقط، ولا يتم استخدامها حتى
// الآن لتغيير أي اعتماد أو حالة أو Workflow قائم.
export const purchasePackageSubmissions = mysqlTable("purchase_package_submissions", {
	id: int().autoincrement().notNull(),
	purchasePackageId: int().notNull(),
	subNumber: int().notNull(),
	createdById: int().notNull(),
	totalEstimatedCost: decimal({ precision: 12, scale: 2 }),
	custodyBalance: decimal({ precision: 12, scale: 2 }),
	status: mysqlEnum(['pending_accounting','pending_management','approved','rejected']),
	accountingApprovedById: int(),
	accountingApprovedAt: timestamp({ mode: 'string' }),
	accountingSignatureSnapshot: text(),
	managementApprovedById: int(),
	managementApprovedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("purchase_package_submissions_uq").on(table.purchasePackageId, table.subNumber),
	index("purchase_package_submissions_pkg_idx").on(table.purchasePackageId),
]);

export const purchaseOrderItems = mysqlTable("purchase_order_items", {
	id: int().autoincrement().notNull(),
	purchaseOrderId: int().notNull().references(() => purchaseOrders.id, { onDelete: "restrict" } ),
	// 2B-1: الهوية المركزية للصنف عند اختيار البند من الكتالوج.
	// تبقى nullable لأن الإدخال اليدوي ما زال مسموحًا كاستثناء.
	catalogItemId: int(),
	itemName: varchar({ length: 300 }).notNull(),
	description: text(),
	quantity: int().default(1).notNull(),
	unit: varchar({ length: 50 }),
	photoUrl: text(),
	notes: text(),
	delegateId: int(),
	// NULL preserves the historical order-level review workflow.
	reviewRole: mysqlEnum(["general_maintenance_manager", "construction_procurement_manager", "senior_management"]),
	reviewedById: int(),
	reviewedAt: timestamp({ mode: 'string' }),
	reviewerSignatureSnapshot: text(),
	requiredDate: date({ mode: 'string' }),
	deliveryLeadDays: int(),
	delegateAssignedAt: timestamp({ mode: 'string' }),
	delegateChangeRequestedById: int(),
	delegateChangeReason: text(),
	delegateChangeRequestedAt: timestamp({ mode: 'string' }),
	estimatedUnitCost: decimal({ precision: 12, scale: 2 }),
	estimatedTotalCost: decimal({ precision: 12, scale: 2 }),
	actualUnitCost: decimal({ precision: 12, scale: 2 }),
	actualTotalCost: decimal({ precision: 12, scale: 2 }),
	supplierName: varchar({ length: 300 }),
	supplierInvoiceNumber: varchar({ length: 100 }),
	invoicePhotoUrl: text(),
	purchasedPhotoUrl: text(),
	status: mysqlEnum(['pending','estimated','approved','rejected','funded','purchased','delivered_to_warehouse','delivered_to_requester','pending_review','cancelled','needs_item_revision','purchase_cancelled']).default('pending').notNull(),
	purchasedAt: timestamp({ mode: 'string' }),
	receivedAt: timestamp({ mode: 'string' }),
	receivedById: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	purchasedById: int(),
	supplierItemName: varchar({ length: 300 }),
	warehousePhotoUrl: text(),
	deliveredAt: timestamp({ mode: 'string' }),
	deliveredById: int(),
	deliveredToId: int(),
	reviewReason: text(),
	managementRejectionReason: text(),
	receivedQuantity: int(),
	deliveredQuantity: int(),
	returnedQuantity: int().default(0),
	returnReason: text(),
	returnedAt: timestamp({ mode: 'string' }),
	photoUrls: json(),
	// سياق الاستفادة الخاص بالبند. يبقى nullable للتوافق مع الطلبات التاريخية؛
	// عند القراءة يُستخدم سياق رأس الطلب كقيمة بديلة.
	siteId: int(),
	sectionId: int(),
	assetId: int(),
	categoryId: int(),
	estimatedById: int(),
	itemNameAr: text("itemName_ar"),
	itemNameEn: text("itemName_en"),
	itemNameUr: text("itemName_ur"),
	notesAr: text("notes_ar"),
	notesEn: text("notes_en"),
	notesUr: text("notes_ur"),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	descriptionUr: text("description_ur"),
	itemRevisionNote: text(),
	itemRevisionRequestedById: int(),
	itemRevisionRequestedAt: timestamp({ mode: 'string' }),
	purchaseCancelReason: text(),
	purchaseCancelledById: int(),
	purchaseCancelledByName: varchar({ length: 300 }),
	purchaseCancelledAt: timestamp({ mode: 'string' }),
	deliveryNumber: varchar({ length: 20 }),
	printCount: int().default(0).notNull(),
	batchId: int(),
},
(table) => [
	index("purchase_order_items_batch_idx").on(table.batchId),
	index("idx_poi_purchaseOrderId").on(table.purchaseOrderId),
	index("idx_poi_catalogItemId").on(table.catalogItemId),
	index("idx_poi_siteId").on(table.siteId),
	index("idx_poi_sectionId").on(table.sectionId),
	index("idx_poi_assetId").on(table.assetId),
	index("idx_poi_categoryId").on(table.categoryId),
	index("idx_poi_review_queue").on(table.reviewRole, table.status, table.purchaseOrderId, table.id),
	index("idx_poi_review_actor").on(table.reviewRole, table.reviewedById, table.purchaseOrderId, table.id),
]);

export const purchaseOrders = mysqlTable("purchase_orders", {
	id: int().autoincrement().notNull(),
	poNumber: varchar({ length: 20 }).notNull(),
	ticketId: int(),
	// بند البلاغ الذي يخص هذا الطلب تحديدًا — الخطوة 4 من ميزة البلاغ متعدد
	// الجهات (2026-08-08). NULL للطلبات القديمة وللطلبات غير المرتبطة ببند
	// محدد (تبقى مرتبطة بالبلاغ عبر ticketId وحده، توافقًا رجعيًا كاملًا).
	// بلا مفتاح خارجي فعلي — بنفس اتفاقية ticketId ذاته (غير مفروض بقاعدة
	// البيانات في هذا المشروع، راجع ملاحظة "3 مواضع فقط بها FK فعلي" بـCLAUDE.md).
	ticketItemId: int(),
	requestedById: int().notNull(),
	status: mysqlEnum(['draft','pending_review','pending_estimate','pending_accounting','pending_management','approved','partial_purchase','purchased','received','closed','rejected','revision_needed']).default('draft').notNull(),
	totalEstimatedCost: decimal({ precision: 12, scale: 2 }),
	totalActualCost: decimal({ precision: 12, scale: 2 }),
	totalEstimatedText: varchar({ length: 500 }),
	accountingApprovedById: int(),
	accountingApprovedAt: timestamp({ mode: 'string' }),
	accountingNotes: text(),
	accountingSignatureSnapshot: text(),
	managementApprovedById: int(),
	managementApprovedAt: timestamp({ mode: 'string' }),
	managementNotes: text(),
	rejectedById: int(),
	rejectedAt: timestamp({ mode: 'string' }),
	rejectionReason: text(),
	notes: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	// تاريخ تحويل المسودة إلى طلب رسمي — يُستخدم للترتيب/الفلترة بدل createdAt
	submittedAt: timestamp({ mode: 'string' }),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	custodyAmount: decimal({ precision: 12, scale: 2 }),
	siteId: int(),
	sectionId: int(),
	assetId: int(),
	categoryId: int().references(() => centerCategories.id, { onDelete: "restrict" }),
	reviewedAt: timestamp({ mode: 'string' }),
	reviewedById: int(),
	requesterSignatureSnapshot: varchar({ length: 500 }),
	reviewerSignatureSnapshot: varchar({ length: 500 }),
	// [PB] ربط اختياري بحزمة الشراء — حاوية عليا تجميعية للعرض والتعيين
	// والإرسال والمتابعة فقط. NULL = طلب غير مجمّع، يسلك سلوك اليوم
	// حرفيًا (وهذا حال كل الطلبات القائمة). بلا مفتاح خارجي فعلي، بنفس
	// اتفاقية ticketId أعلاه. موجود فعليًا بالقاعدة منذ 2026-08-26،
	// أُعيد تصفيره على 7 طلبات متأثرة في 2026-08-29.
	packageId: int(),
},
(table) => [
	index("idx_purchase_orders_packageId").on(table.packageId),
	index("idx_purchase_orders_assetId").on(table.assetId),
	index("idx_purchase_orders_categoryId").on(table.categoryId),
]);

export const purchaseOrdersLegacyOrphans = mysqlTable("purchase_orders_legacy_orphans", {
	id: int().autoincrement().notNull(),
	poNumber: varchar({ length: 20 }).notNull(),
	ticketId: int(),
	requestedById: int().notNull(),
	status: mysqlEnum(['draft','pending_review','pending_estimate','pending_accounting','pending_management','approved','partial_purchase','purchased','received','closed','rejected','revision_needed']).default('draft').notNull(),
	totalEstimatedCost: decimal({ precision: 12, scale: 2 }),
	totalActualCost: decimal({ precision: 12, scale: 2 }),
	totalEstimatedText: varchar({ length: 500 }),
	accountingApprovedById: int(),
	accountingApprovedAt: timestamp({ mode: 'string' }),
	accountingNotes: text(),
	managementApprovedById: int(),
	managementApprovedAt: timestamp({ mode: 'string' }),
	managementNotes: text(),
	rejectedById: int(),
	rejectedAt: timestamp({ mode: 'string' }),
	rejectionReason: text(),
	notes: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	custodyAmount: decimal({ precision: 12, scale: 2 }),
	siteId: int(),
	sectionId: int(),
	reviewedAt: timestamp({ mode: 'string' }),
	reviewedById: int(),
	archivedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	archiveReason: varchar({ length: 500 }).default('طلب شراء وصل لحالة received بصفر أصناف — بنود حقيقية مرّت بدورة شراء كاملة ثم حُذفت قبل بناء دورة المخزون الحقيقية (6-7-2026)، حالة received أصبحت مضلِّلة لعدم وجود أي بند يوثقها').notNull(),
});

export const pushSubscriptions = mysqlTable("push_subscriptions", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	endpoint: text().notNull(),
	p256Dh: text().notNull(),
	auth: text().notNull(),
	userAgent: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const returnDocuments = mysqlTable("return_documents", {
	id: int().autoincrement().notNull(),
	returnNumber: varchar({ length: 20 }).notNull(),
	returnId: int().notNull(),
	itemName: varchar({ length: 300 }).notNull(),
	internalCode: varchar({ length: 50 }),
	manufacturerBarcode: varchar({ length: 100 }),
	returnedQuantity: int().notNull(),
	unit: varchar({ length: 50 }),
	reason: text().notNull(),
	returnedByName: varchar({ length: 200 }).notNull(),
	recipientName: varchar({ length: 200 }),
	receiptNumber: varchar({ length: 20 }),
	invoiceNumber: varchar({ length: 100 }),
	vendorName: varchar({ length: 300 }),
	poNumber: varchar({ length: 100 }),
	printCount: int().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_return_documents_return_id").on(table.returnId),
]);

export const sections = mysqlTable("sections", {
	id: int().autoincrement().notNull(),
	name: varchar({ length: 200 }).notNull(),
	description: text(),
	siteId: int().notNull(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	nameEn: varchar({ length: 200 }),
	nameUr: varchar({ length: 200 }),
});

export const sites = mysqlTable("sites", {
	id: int().autoincrement().notNull(),
	name: varchar({ length: 200 }).notNull(),
	address: text(),
	description: text(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	nameEn: varchar({ length: 200 }),
	nameUr: varchar({ length: 200 }),
});

export const suppliers = mysqlTable("suppliers", {
	id: int().autoincrement().notNull(),
	nameAr: varchar({ length: 255 }).notNull(),
	nameEn: varchar({ length: 255 }).notNull(),
	nameUr: varchar({ length: 255 }),
	contactPerson: varchar({ length: 255 }),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 20 }),
	address: text(),
	isActive: tinyint().default(1),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const technicians = mysqlTable("technicians", {
	id: int().autoincrement().notNull(),
	name: varchar({ length: 200 }).notNull(),
	specialty: varchar({ length: 200 }),
	status: mysqlEnum(['active','inactive']).default('active').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	nameEn: varchar({ length: 200 }),
	nameUr: varchar({ length: 200 }),
	specialtyEn: varchar({ length: 200 }),
	specialtyUr: varchar({ length: 200 }),
});

export const ticketConfirmations = mysqlTable("ticket_confirmations", {
	id: int().autoincrement().notNull(),
	ticketId: int().notNull(),
	confirmedById: int().notNull(),
	note: text().notNull(),
	photoUrls: json().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_ticket_confirmations_ticketId").on(table.ticketId),
]);

export const ticketStatusHistory = mysqlTable("ticket_status_history", {
	id: int().autoincrement().notNull(),
	ticketId: int().notNull(),
	fromStatus: varchar({ length: 50 }),
	toStatus: varchar({ length: 50 }).notNull(),
	changedById: int().notNull(),
	notes: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

// ══════════════════════════════════════════════════════════════════════
// ticket_items — وحدات التنفيذ القديمة/التوافقية للبلاغ
//
// أُنشئ هذا الجدول في 2026-08-08 لتمثيل البنود المستقلة ومسارات A/B/C. منذ
// 2026-08-11 لم يعد هو طبقة التنظيم الجديدة للجهة/المهمة؛ تلك الطبقة أصبحت
// ticket_departments → ticket_tasks → ticket_task_assignees. يبقى هذا الجدول
// مصدر حقيقة لوحدة الـWorkflow التنفيذية للبلاغات القديمة والبلاغات الفرعية،
// كما يبقى بند توافق واحد على الرأس حتى لا تنكسر الشاشات/التقارير القديمة.
//
// ⚠️ أعمدة tickets الحالية (status, maintenancePath, repairNotes, ...) تبقى
// ملخصًا للتوافق. لا تستخدم ticket_items لتمثيل "الجهة" أو "المهمة" الجديدة.
// راجع CLAUDE.md القاعدة #14.
// ══════════════════════════════════════════════════════════════════════
export const ticketItems = mysqlTable("ticket_items", {
	id: int().autoincrement().notNull(),
	ticketId: int().notNull().references(() => tickets.id, { onDelete: "restrict" } ),
	itemNumber: int().default(1).notNull(),
	title: varchar({ length: 300 }),
	description: text(),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	descriptionUr: text("description_ur"),
	assetId: int(),
	responsibleDepartment: mysqlEnum([
		'maintenance_report_department_general',
		'maintenance_report_department_construction',
		'maintenance_report_department_it',
	]),
	responsibleManagerId: int(),
	routedById: int(),
	routedAt: timestamp({ mode: 'string' }),
	routingNote: text(),
	maintenancePath: mysqlEnum(['A','B','C']),
	justification: text(),
	approvedById: int(),
	approvedAt: timestamp({ mode: 'string' }),
	status: mysqlEnum(['new','pending_triage','department_planning','under_inspection','work_approved','ready_for_closure','approved','assigned','in_progress','needs_purchase','purchase_pending_estimate','purchase_pending_accounting','purchase_pending_management','purchase_approved','partial_purchase','purchased','received_warehouse','out_for_repair','repaired','verified','closed','requester_confirmed']).default('pending_triage').notNull(),
	assignedToId: int(),
	assignedTechnicianId: int(),
	assignedAt: timestamp({ mode: 'string' }),
	repairNotes: text(),
	afterPhotoUrl: text(),
	materialsUsed: text(),
	estimatedCost: decimal({ precision: 12, scale: 2 }),
	actualCost: decimal({ precision: 12, scale: 2 }),
	closedAt: timestamp({ mode: 'string' }),
	isLegacySingleItem: tinyint().default(0).notNull(),
	createdById: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_ticket_items_ticket_number").on(table.ticketId, table.itemNumber),
	index("idx_ticket_items_ticket").on(table.ticketId),
	index("idx_ticket_items_status").on(table.status),
	index("idx_ticket_items_department").on(table.responsibleDepartment),
	index("idx_ticket_items_manager").on(table.responsibleManagerId),
	index("idx_ticket_items_assigned").on(table.assignedToId),
]);

export const tickets = mysqlTable("tickets", {
	id: int().autoincrement().notNull(),
	ticketNumber: varchar({ length: 20 }).notNull(),
	title: varchar({ length: 300 }).notNull(),
	description: text(),
	status: mysqlEnum(['new','pending_triage','department_planning','under_inspection','work_approved','ready_for_closure','approved','assigned','in_progress','needs_purchase','purchase_pending_estimate','purchase_pending_accounting','purchase_pending_management','purchase_approved','partial_purchase','purchased','received_warehouse','out_for_repair','repaired','verified','closed','requester_confirmed']).default('new').notNull(),
	priority: mysqlEnum(['low','medium','high','critical']).default('medium').notNull(),
	category: mysqlEnum(['electrical','plumbing','hvac','structural','mechanical','general','safety','cleaning','it']).default('general').notNull(),
	// Center Categories is used by new tickets. Legacy category remains untouched for historical compatibility.
	categoryId: int().references(() => centerCategories.id, { onDelete: "restrict" }),
	siteId: int(),
	locationDetail: varchar({ length: 300 }),
	reportedById: int().notNull(),
	assignedToId: int(),
	approvedById: int(),
	beforePhotoUrl: text(),
	afterPhotoUrl: text(),
	repairNotes: text(),
	materialsUsed: text(),
	estimatedCost: decimal({ precision: 12, scale: 2 }),
	actualCost: decimal({ precision: 12, scale: 2 }),
	closedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	originalLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	assetId: int(),
	titleAr: text("title_ar"),
	titleEn: text("title_en"),
	titleUr: text("title_ur"),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	descriptionUr: text("description_ur"),
	repairNotesAr: text("repairNotes_ar"),
	repairNotesEn: text("repairNotes_en"),
	repairNotesUr: text("repairNotes_ur"),
	maintenancePath: mysqlEnum(['A','B','C']),
	ticketType: mysqlEnum(['internal','external','procurement']),
	supervisorId: int(),
	inspectionNotes: text(),
	inspectionWorkflowStatus: mysqlEnum([
		'maintenance_inspection_pending_submission',
		'maintenance_inspection_submitted_for_review',
		'maintenance_inspection_returned_for_correction',
		'maintenance_inspection_approved',
	]),
	inspectionPerformedById: int(),
	inspectionRecordedById: int(),
	inspectionSubmittedAt: timestamp({ mode: 'string' }),
	inspectionSubmittedById: int(),
	inspectionApprovedAt: timestamp({ mode: 'string' }),
	inspectionApprovedById: int(),
	inspectionReturnedAt: timestamp({ mode: 'string' }),
	inspectionReturnedById: int(),
	inspectionReturnReason: text(),
	justification: text(),
	triageNotes: text(),
	gateExitApprovedById: int(),
	gateExitApprovedAt: timestamp({ mode: 'string' }),
	gateEntryApprovedById: int(),
	gateEntryApprovedAt: timestamp({ mode: 'string' }),
	externalRepairCompletedAt: timestamp({ mode: 'string' }),
	externalRepairCompletedById: int(),
	sectionId: int(),
	assignedTechnicianId: int(),
	assignedAt: timestamp({ mode: 'string' }),
	maintenanceResponsibleDepartment: mysqlEnum([
		'maintenance_report_department_general',
		'maintenance_report_department_construction',
		'maintenance_report_department_it',
	]),
	maintenanceResponsibleManagerId: int(),
	maintenanceRoutedById: int(),
	maintenanceRoutedAt: timestamp({ mode: 'string' }),
	maintenanceRoutingNote: text(),
	// 2026-08-11 — نموذج البلاغات المتعددة الجديد. البلاغ الرئيسي حاوية تنظيمية
	// للجهات والمهام، والبلاغ الفرعي فقط يدخل دورة التنفيذ A/B/C.
	workflowModel: mysqlEnum(['legacy','department_tasks','sub_ticket']).default('legacy').notNull(),
	parentTicketId: int(),
	sourceTaskId: int(),
	subTicketSequence: int(),
	// عداد دائم على البلاغ الرئيسي، لا ينقص عند حذف بلاغ فرعي حتى لا يُعاد استخدام -01/-02.
	subTicketCounter: int().default(0).notNull(),
},
(table) => [
	index("idx_tickets_categoryId").on(table.categoryId),
	index("idx_tickets_parent").on(table.parentTicketId),
	uniqueIndex("uq_tickets_source_task").on(table.sourceTaskId),
	uniqueIndex("uq_tickets_parent_sub_sequence").on(table.parentTicketId, table.subTicketSequence),
]);

// ══════════════════════════════════════════════════════════════════════
// ticket_departments / ticket_tasks / ticket_task_assignees — 2026-08-11
// بلاغ رئيسي → جهة/جهات → مسؤول لكل جهة → مهام → فنيون متعددون
// → تحويل اختياري للمهمة إلى بلاغ فرعي مستقل.
// ticket_items يبقى لوحدة الـWorkflow التنفيذية والتوافق الرجعي.
// ══════════════════════════════════════════════════════════════════════
export const itPurchaseNeeds = mysqlTable("it_purchase_needs", {
  id: int().autoincrement().primaryKey(),
  ticketId: int().notNull().references(() => tickets.id, { onDelete: "restrict" }),
  ticketItemId: int().notNull().references(() => ticketItems.id, { onDelete: "restrict" }),
  requestedById: int().notNull(),
  managerId: int().notNull(),
  items: json().$type<Array<{ itemName: string; quantity: number; unit?: string }>>().notNull(),
  reason: text().notNull(),
  status: mysqlEnum(["pending", "returned", "ordered"]).default("pending").notNull(),
  reviewNote: text(),
  purchaseOrderId: int(),
  createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
}, table => [index("idx_it_need_manager_status").on(table.managerId, table.status), index("idx_it_need_ticket").on(table.ticketId)]);

export const ticketDepartments = mysqlTable("ticket_departments", {
	claimedById: int(),
	claimedAt: timestamp({ mode: "string" }),
	id: int().autoincrement().notNull(),
	ticketId: int().notNull().references(() => tickets.id, { onDelete: "restrict" }),
	department: mysqlEnum([
		'maintenance_report_department_general',
		'maintenance_report_department_construction',
		'maintenance_report_department_it',
	]).notNull(),
	responsibleManagerId: int().notNull(),
	routedById: int().notNull(),
	routedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	routingNote: text(),
	// عنوان تنظيمي يرسله مدير الصيانة والتشغيل لجهة الإنشاءات قبل أن يقسمه مدير الجهة إلى مهام.
	organizationalTitle: varchar({ length: 300 }),
	status: mysqlEnum(['planning','active','completed']).default('planning').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_ticket_departments_ticket_department").on(table.ticketId, table.department),
	index("idx_ticket_departments_ticket").on(table.ticketId),
	index("idx_ticket_departments_manager").on(table.responsibleManagerId),
]);

export const ticketTasks = mysqlTable("ticket_tasks", {
	id: int().autoincrement().notNull(),
	ticketId: int().notNull(),
	ticketDepartmentId: int().notNull().references(() => ticketDepartments.id, { onDelete: "restrict" }),
	taskNumber: int().notNull(),
	title: varchar({ length: 300 }),
	description: text().notNull(),
	status: mysqlEnum(['pending_assignment','assigned','promoted','completed','cancelled']).default('pending_assignment').notNull(),
	convertedTicketId: int(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_ticket_tasks_department_number").on(table.ticketDepartmentId, table.taskNumber),
	index("idx_ticket_tasks_ticket").on(table.ticketId),
	index("idx_ticket_tasks_department").on(table.ticketDepartmentId),
	index("idx_ticket_tasks_converted").on(table.convertedTicketId),
]);

export const ticketTaskAssignees = mysqlTable("ticket_task_assignees", {
	id: int().autoincrement().notNull(),
	taskId: int().notNull().references(() => ticketTasks.id, { onDelete: "restrict" }),
	userId: int().notNull(),
	assignedById: int().notNull(),
	assignedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("uq_ticket_task_assignees_task_user").on(table.taskId, table.userId),
	index("idx_ticket_task_assignees_user").on(table.userId),
]);

export const translationJobs = mysqlTable("translation_jobs", {
	id: int().autoincrement().notNull(),
	entityType: varchar({ length: 50 }).notNull(),
	entityId: int().notNull(),
	fieldName: varchar({ length: 100 }).notNull(),
	sourceLanguage: mysqlEnum(['ar','en','ur']).notNull(),
	targetLanguage: mysqlEnum(['ar','en','ur']).notNull(),
	sourceText: text().notNull(),
	translatedText: text(),
	status: mysqlEnum(['pending','processing','completed','failed']).default('pending').notNull(),
	retryCount: int().default(0).notNull(),
	maxRetries: int().default(3).notNull(),
	errorMessage: text(),
	previousTextHash: varchar({ length: 64 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	completedAt: timestamp({ mode: 'string' }),
});

export const translationVersions = mysqlTable("translation_versions", {
	id: int().autoincrement().notNull(),
	entityTranslationId: int().notNull(),
	versionNumber: int().notNull(),
	translatedText: text(),
	translationStatus: varchar({ length: 20 }).notNull(),
	changedById: int(),
	changeReason: varchar({ length: 50 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const twoFactorAuditLogs = mysqlTable("two_factor_audit_logs", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	action: varchar({ length: 50 }).notNull(),
	ipAddress: varchar({ length: 45 }),
	userAgent: text(),
	success: tinyint().notNull(),
	details: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const twoFactorSecrets = mysqlTable("two_factor_secrets", {
	id: int().autoincrement().notNull(),
	userId: int().notNull(),
	secret: varchar({ length: 255 }).notNull(),
	backupCodes: text().notNull(),
	isEnabled: tinyint().default(0).notNull(),
	enabledAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
});

export const users = mysqlTable("users", {
	id: int().autoincrement().notNull(),
	openId: varchar({ length: 64 }).notNull(),
	name: text(),
	email: varchar({ length: 320 }),
	loginMethod: varchar({ length: 64 }),
	role: mysqlEnum(['user','admin','operator','technician','it_manager','it_member','maintenance_manager','general_maintenance_manager','construction_procurement_manager','supervisor','purchase_manager','purchase_requester','delegate','accountant','senior_management','executive_director','warehouse','gate_security','owner','food_warehouse_manager','food_warehouse_assistant','observer']).default('user').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	lastSignedIn: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	phone: varchar({ length: 20 }),
	department: varchar({ length: 100 }),
	isActive: tinyint().default(1).notNull(),
	preferredLanguage: mysqlEnum(['ar','en','ur']).default('ar').notNull(),
	username: varchar({ length: 100 }),
	passwordHash: varchar({ length: 255 }),
	signatureUrl: varchar({ length: 500 }),
},
(table) => [
	index("users_openId_unique").on(table.openId),
]);

export const warehouseReceiptItems = mysqlTable("warehouse_receipt_items", {
	id: int().autoincrement().notNull(),
	receiptId: int().notNull(),
	inventoryId: int(),
	purchaseOrderItemId: int().references(() => purchaseOrderItems.id, { onDelete: "set null" } ),
	// 2B-7: هوية Catalog المركزية لسطر الاستلام/الفاتورة.
	// تبقى nullable للسجلات التاريخية التي لم تُحسم هويتها بعد.
	catalogItemId: int(),
	itemName: varchar({ length: 300 }).notNull(),
	itemNameAr: text("itemName_ar"),
	itemNameEn: text("itemName_en"),
	// 2B-4: قرار المستخدم بأن الصنف غير موجود في Catalog Master الحالي.
	isNewCatalogItem: tinyint().default(0).notNull(),
	receivedQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	purchaseUnit: varchar({ length: 50 }),
	unitCost: decimal({ precision: 12, scale: 4 }).default('0').notNull(),
	taxRate: decimal({ precision: 5, scale: 2 }).default('15').notNull(),
	taxAmount: decimal({ precision: 12, scale: 2 }).default('0').notNull(),
	lineTotal: decimal({ precision: 12, scale: 2 }).default('0').notNull(),
	expectedQuantity: decimal({ precision: 12, scale: 3 }),
	quantityDiff: decimal({ precision: 12, scale: 3 }),
	expectedUnitCost: decimal({ precision: 12, scale: 4 }),
	priceDiff: decimal({ precision: 12, scale: 4 }),
	ocrExtracted: tinyint().default(0).notNull(),
	manuallyEdited: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_receipt_items_receiptId").on(table.receiptId),
	index("idx_receipt_items_inventoryId").on(table.inventoryId),
	index("idx_receipt_items_poItemId").on(table.purchaseOrderItemId),
	index("idx_wri_purchaseOrderItemId").on(table.purchaseOrderItemId),
	index("idx_receipt_items_catalogItemId").on(table.catalogItemId),
]);

export const warehouseReceiptItemsLegacyOrphans = mysqlTable("warehouse_receipt_items_legacy_orphans", {
	id: int().notNull(),
	receiptId: int().notNull(),
	inventoryId: int(),
	purchaseOrderItemId: int(),
	itemName: varchar({ length: 300 }).notNull(),
	itemNameAr: text("itemName_ar"),
	itemNameEn: text("itemName_en"),
	receivedQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	purchaseUnit: varchar({ length: 50 }),
	unitCost: decimal({ precision: 12, scale: 4 }).default('0').notNull(),
	taxRate: decimal({ precision: 5, scale: 2 }).default('15').notNull(),
	taxAmount: decimal({ precision: 12, scale: 2 }).default('0').notNull(),
	lineTotal: decimal({ precision: 12, scale: 2 }).default('0').notNull(),
	expectedQuantity: decimal({ precision: 12, scale: 3 }),
	quantityDiff: decimal({ precision: 12, scale: 3 }),
	expectedUnitCost: decimal({ precision: 12, scale: 4 }),
	priceDiff: decimal({ precision: 12, scale: 4 }),
	ocrExtracted: tinyint().default(0).notNull(),
	manuallyEdited: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).notNull(),
	archivedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	archiveReason: varchar({ length: 500 }).default('ربط خاطئ ببند وهمي (رقم صغير بدل المعرف الحقيقي) — تعذّرت المطابقة اليدوية القاطعة').notNull(),
});

export const warehouseReceipts = mysqlTable("warehouse_receipts", {
	id: int().autoincrement().notNull(),
	receiptNumber: varchar({ length: 20 }).notNull(),
	purchaseOrderId: int(),
	receivedById: int().notNull(),
	receivedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	notes: text(),
	totalItems: int().default(0),
	status: mysqlEnum(['draft','confirmed','approved','rejected']).default('draft').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	vendorName: varchar({ length: 300 }),
	vendorNameEn: varchar({ length: 300 }),
	vendorTaxNumber: varchar({ length: 50 }),
	// 2B-2: المورد المركزي المختار، أو مرشح المورد الجديد عند عدم وجوده.
	catalogSupplierId: int(),
	supplierCandidateId: int(),
	invoiceNumber: varchar({ length: 100 }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	invoiceDate: date({ mode: 'string' }),
	subtotal: decimal({ precision: 12, scale: 2 }),
	taxAmount: decimal({ precision: 12, scale: 2 }),
	grandTotal: decimal({ precision: 12, scale: 2 }),
	invoicePhotoUrl: text(),
	goodsPhotoUrl: text(),
	ocrRawData: json(),
	ocrConfidence: decimal({ precision: 5, scale: 2 }),
	isDuplicate: tinyint().default(0).notNull(),
	duplicateOfId: int(),
	hasDiscrepancy: tinyint().default(0).notNull(),
	discrepancyNotes: text(),
	isDraft: tinyint().default(1).notNull(),
	approvedById: int(),
	approvedAt: timestamp({ mode: 'string' }),
	printCount: int().default(0).notNull(),
},
(table) => [
	index("idx_warehouse_receipts_po_null").on(table.purchaseOrderId),
	index("idx_warehouse_receipts_catalog_supplier").on(table.catalogSupplierId),
	index("idx_warehouse_receipts_supplier_candidate").on(table.supplierCandidateId),
]);

export const warehouseReceiptsLegacyOrphans = mysqlTable("warehouse_receipts_legacy_orphans", {
	id: int().autoincrement().notNull(),
	receiptNumber: varchar({ length: 20 }).notNull(),
	purchaseOrderId: int(),
	receivedById: int().notNull(),
	receivedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	notes: text(),
	totalItems: int().default(0),
	status: mysqlEnum(['draft','confirmed','approved','rejected']).default('draft').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
	vendorName: varchar({ length: 300 }),
	vendorNameEn: varchar({ length: 300 }),
	vendorTaxNumber: varchar({ length: 50 }),
	invoiceNumber: varchar({ length: 100 }),
	// you can use { mode: 'date' }, if you want to have Date as type for this column
	invoiceDate: date({ mode: 'string' }),
	subtotal: decimal({ precision: 12, scale: 2 }),
	taxAmount: decimal({ precision: 12, scale: 2 }),
	grandTotal: decimal({ precision: 12, scale: 2 }),
	invoicePhotoUrl: text(),
	goodsPhotoUrl: text(),
	ocrRawData: json(),
	ocrConfidence: decimal({ precision: 5, scale: 2 }),
	isDuplicate: tinyint().default(0).notNull(),
	duplicateOfId: int(),
	hasDiscrepancy: tinyint().default(0).notNull(),
	discrepancyNotes: text(),
	isDraft: tinyint().default(1).notNull(),
	approvedById: int(),
	approvedAt: timestamp({ mode: 'string' }),
	archivedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	archiveReason: varchar({ length: 500 }).default('سند استلام أصبح فارغًا تمامًا بعد أرشفة/حذف أصنافه ضمن تنظيف بيانات ما قبل بناء دورة المخزون (6-7-2026)').notNull(),
},
(table) => [
	index("idx_warehouse_receipts_po_null").on(table.purchaseOrderId),
]);

export const warehouseReturns = mysqlTable("warehouse_returns", {
	id: int().autoincrement().notNull(),
	returnNumber: varchar({ length: 20 }).notNull(),
	receiptId: int(),
	purchaseOrderId: int(),
	purchaseOrderItemId: int(),
	inventoryId: int().notNull(),
	// 2B-8: الدفعة الأصلية المرتبطة بالمرتجع.
	lotId: int(),
	// 5.2: Future-only link for Recipient → Warehouse Return.
	// NULL keeps all historical/supplier returns unchanged. Live DB was manually
	// extended on 2026-08-22; no historical backfill/FK is introduced here.
	sourceDeliveryDocumentId: int(),
	returnedQuantity: int().notNull(),
	reason: text().notNull(),
	returnedById: int().notNull(),
	returnedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_warehouse_returns_lotId").on(table.lotId),
	index("idx_warehouse_returns_source_delivery").on(table.sourceDeliveryDocumentId),
]);

export const warehouses = mysqlTable("warehouses", {
	id: int().autoincrement().notNull(),
	code: varchar({ length: 20 }).notNull(),
	nameAr: varchar({ length: 200 }).notNull(),
	nameEn: varchar({ length: 200 }),
	description: text(),
	type: mysqlEnum(['main','project','branch','kitchen']).default('main').notNull(),
	parentId: int(),
	siteId: int(),
	projectId: int(),
	// ربط المخزن الفرعي بتصنيف المستوى الأول من شجرة الكتالوج (catalog_nodes.level = 1).
	// NULL مسموح فقط للمخزن الرئيسي — يُفرَض الإلزام على المخازن الفرعية برمجياً
	// في server/_core/db/warehouses.ts (createSubWarehouse) وليس على مستوى العمود،
	// والفهرس الفريد أدناه يمنع ربط أكثر من مخزن فرعي بنفس التصنيف.
	catalogNodeId: int().references(() => catalogNodes.id, { onDelete: "set null" } ),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("code").on(table.code),
	uniqueIndex("idx_warehouses_catalog_node_unique").on(table.catalogNodeId),
]);

// ══════════════════════════════════════════════════════════════════════
// warehouse_transfers — سجل رأسي موثِّق لكل عملية تحويل فعلية بين مخزنين
// (رئيسي↔فرعي أو فرعي↔فرعي). يشبه بنية disposal_operations/
// inventory_count_operations الموجودة مسبقاً. راجع server/_core/db/warehouses.ts
// ══════════════════════════════════════════════════════════════════════
export const warehouseTransfers = mysqlTable("warehouse_transfers", {
	id: int().autoincrement().notNull(),
	transferNumber: varchar({ length: 30 }).notNull(),
	// يجمع كل أصناف عملية تحويل واحدة (حتى 20 صنفاً) تحت رأس واحد للعرض
	// كبطاقة واحدة بالواجهة. NULL فقط للسجلات القديمة قبل هذا التعديل
	// (2026-08-05) — تُعامَل كل واحدة منها كعملية أحادية الصنف بالعرض.
	batchId: int().references(() => warehouseTransferBatches.id, { onDelete: "set null" } ),
	fromWarehouseId: int().notNull().references(() => warehouses.id, { onDelete: "restrict" } ),
	toWarehouseId: int().notNull().references(() => warehouses.id, { onDelete: "restrict" } ),
	fromInventoryId: int().notNull().references(() => inventory.id, { onDelete: "restrict" } ),
	toInventoryId: int().notNull().references(() => inventory.id, { onDelete: "restrict" } ),
	// 2B-8: التحويل ينقل نفس Lot/QR بين المخازن ولا ينشئ هوية دفعة جديدة.
	lotId: int(),
	quantity: decimal({ precision: 12, scale: 3 }).notNull(),
	// true إن كان تصنيف الصنف لا يطابق تصنيف المخزن الهدف — تحويل مسموح به
	// (تنبيه فقط وليس منعاً، بقرار صاحب المشروع) لكن يُسجَّل للمراجعة اللاحقة.
	categoryMismatch: tinyint().default(0).notNull(),
	notes: text(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("idx_warehouse_transfers_number_unique").on(table.transferNumber),
	index("idx_warehouse_transfers_from_warehouse").on(table.fromWarehouseId),
	index("idx_warehouse_transfers_to_warehouse").on(table.toWarehouseId),
	index("idx_warehouse_transfers_lotId").on(table.lotId),
	index("idx_warehouse_transfers_batch").on(table.batchId),
]);

// ══════════════════════════════════════════════════════════════════════
// warehouse_transfer_batches — الرأس الذي يجمع عملية تحويل واحدة قد تضم
// حتى 20 صنفاً تحت رقم عملية واحد (بطاقة واحدة بالواجهة). كل صف بجدول
// warehouseTransfers أعلاه هو "بند" تفصيلي مرتبط بهذا الرأس عبر batchId.
// ══════════════════════════════════════════════════════════════════════
export const warehouseTransferBatches = mysqlTable("warehouse_transfer_batches", {
	id: int().autoincrement().notNull(),
	batchNumber: varchar({ length: 30 }).notNull(),
	fromWarehouseId: int().notNull().references(() => warehouses.id, { onDelete: "restrict" } ),
	toWarehouseId: int().notNull().references(() => warehouses.id, { onDelete: "restrict" } ),
	notes: text(),
	itemsCount: int().default(0).notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("idx_warehouse_transfer_batches_number_unique").on(table.batchNumber),
	index("idx_warehouse_transfer_batches_from_warehouse").on(table.fromWarehouseId),
	index("idx_warehouse_transfer_batches_to_warehouse").on(table.toWarehouseId),
]);

export const warehouseTransferBatchNumberCounter = mysqlTable("warehouse_transfer_batch_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
});

export const warehouseTransferNumberCounter = mysqlTable("warehouse_transfer_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
});

// ══════════════════════════════════════════════════════════════════════
// ticket_number_counter — عدّاد أرقام البلاغات (2026-08-09)
//
// أُضيف بعد اكتشاف أن البلاغات كانت الكيان الوحيد بالمشروع الذي يُولَّد رقمه
// بالبحث عن أعلى رقم موجود حاليًا (SELECT MAX) بدل عدّاد مستقل — ما جعل رقم
// البلاغ **يُعاد استخدامه** بعد حذف بلاغ يحمل أعلى رقم. حالة مؤكَّدة بالإنتاج:
// MT-2026-00174 و MT-2026-00175 كانا لبلاغين حُذفا، ثم أُعيد الرقمان لبلاغين
// جديدين مختلفين تمامًا.
//
// النمط مطابق حرفيًا للعدّادات الستة الأخرى بالمشروع (delivery/disposal/
// inventoryCount/inventorySettlement/warehouseTransfer*): AUTO_INCREMENT
// بقاعدة البيانات نفسها هو ضامن التفرّد — آمن مع الطلبات المتزامنة بلا أقفال.
// ══════════════════════════════════════════════════════════════════════
export const ticketNumberCounter = mysqlTable("ticket_number_counter", {
	id: int().autoincrement().notNull(),
	year: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});


export const pmv2MaterialPurchaseLinks = mysqlTable("pmv2_material_purchase_links", {
	id: int().autoincrement().primaryKey().notNull(),
	materialRequestItemId: int().notNull().references(() => pmv2MaterialRequestItems.id, { onDelete: "restrict", onUpdate: "restrict" }),
	purchaseOrderId: int().notNull(),
	purchaseOrderItemId: int().notNull(),
	linkedQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_material_purchase_links_po_item").on(table.purchaseOrderItemId),
	uniqueIndex("uq_pmv2_material_purchase_links_request_po_item").on(table.materialRequestItemId, table.purchaseOrderItemId),
	index("idx_pmv2_material_purchase_links_request_item").on(table.materialRequestItemId),
	index("idx_pmv2_material_purchase_links_purchase_order").on(table.purchaseOrderId),
	index("idx_pmv2_material_purchase_links_created_by").on(table.createdById),
]);


export const pmv2TaskTicketLinks = mysqlTable("pmv2_task_ticket_links", {
	id: int().autoincrement().primaryKey().notNull(),
	taskItemId: int().notNull().references(() => pmv2TaskItems.id, { onDelete: "restrict", onUpdate: "restrict" }),
	ticketId: int().notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_task_ticket_links_ticket").on(table.ticketId),
	index("idx_pmv2_task_ticket_links_task_item").on(table.taskItemId),
	index("idx_pmv2_task_ticket_links_created_by").on(table.createdById),
]);

export const pmv2MaterialUsages = mysqlTable("pmv2_material_usages", {
	id: int().autoincrement().primaryKey().notNull(),
	taskItemId: int().notNull().references(() => pmv2TaskItems.id, { onDelete: "restrict", onUpdate: "restrict" }),
	visitId: int().notNull().references(() => pmv2Visits.id, { onDelete: "restrict", onUpdate: "restrict" }),
	materialRequestItemId: int().references(() => pmv2MaterialRequestItems.id, { onDelete: "restrict", onUpdate: "restrict" }),
	warehouseId: int().notNull(),
	catalogItemId: int().notNull(),
	inventoryTransactionId: int(),
	inventoryLotId: int(),
	deliveryDocumentId: int(),
	purchaseOrderItemId: int(),
	usedQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	unitSnapshot: varchar({ length: 50 }),
	recordedById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_pmv2_material_usages_task_item").on(table.taskItemId),
	index("idx_pmv2_material_usages_visit").on(table.visitId),
	index("idx_pmv2_material_usages_request_item").on(table.materialRequestItemId),
	index("idx_pmv2_material_usages_warehouse").on(table.warehouseId),
	index("idx_pmv2_material_usages_catalog_item").on(table.catalogItemId),
	index("idx_pmv2_material_usages_inventory_tx").on(table.inventoryTransactionId),
	index("idx_pmv2_material_usages_inventory_lot").on(table.inventoryLotId),
	index("idx_pmv2_material_usages_delivery_document").on(table.deliveryDocumentId),
	index("idx_pmv2_material_usages_po_item").on(table.purchaseOrderItemId),
	index("idx_pmv2_material_usages_recorded_by").on(table.recordedById),
	index("idx_pmv2_material_usages_created_at").on(table.createdAt),
]);



export const pmv2RequestReminders = mysqlTable("pmv2_request_reminders", {
	id: int().autoincrement().primaryKey().notNull(),
	requestId: int().notNull().references(() => pmv2MaterialRequests.id, { onDelete: "restrict", onUpdate: "restrict" }),
	recipientUserId: int().notNull(),
	reminderType: varchar({ length: 50 }).notNull(),
	notificationId: int(),
	createdById: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_pmv2_request_reminders_request").on(table.requestId),
	index("idx_pmv2_request_reminders_recipient_user").on(table.recipientUserId),
	index("idx_pmv2_request_reminders_type").on(table.reminderType),
	index("idx_pmv2_request_reminders_notification").on(table.notificationId),
	index("idx_pmv2_request_reminders_created_by").on(table.createdById),
	index("idx_pmv2_request_reminders_created_at").on(table.createdAt),
]);


export const pmv2SlaRules = mysqlTable("pmv2_sla_rules", {
	id: int().autoincrement().primaryKey().notNull(),
	roleKey: varchar({ length: 60 }).notNull(),
	slaMinutes: int(),
	reminderMinutes: int(),
	isActive: tinyint().default(1).notNull(),
	updatedById: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_sla_rules_role").on(table.roleKey),
	index("idx_pmv2_sla_rules_active").on(table.isActive),
	index("idx_pmv2_sla_rules_updated_by").on(table.updatedById),
]);

export const pmv2AlertDeliveries = mysqlTable("pmv2_alert_deliveries", {
	id: int().autoincrement().primaryKey().notNull(),
	taskId: int().notNull().references(() => pmv2Tasks.id, { onDelete: "restrict", onUpdate: "restrict" }),
	taskItemId: int().notNull().references(() => pmv2TaskItems.id, { onDelete: "restrict", onUpdate: "restrict" }),
	recipientUserId: int().notNull(),
	alertType: varchar({ length: 50 }).notNull(),
	stageKey: varchar({ length: 120 }).notNull(),
	dedupeKey: varchar({ length: 191 }).notNull(),
	notificationId: int(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_alert_deliveries_dedupe").on(table.dedupeKey),
	index("idx_pmv2_alert_deliveries_task").on(table.taskId),
	index("idx_pmv2_alert_deliveries_item").on(table.taskItemId),
	index("idx_pmv2_alert_deliveries_recipient").on(table.recipientUserId),
	index("idx_pmv2_alert_deliveries_type").on(table.alertType),
]);


export const pmv2DailyReportReviews = mysqlTable("pmv2_daily_report_reviews", {
	id: int().autoincrement().primaryKey().notNull(),
	reportDate: date({ mode: 'string' }).notNull(),
	teamId: int().notNull().references(() => pmv2Teams.id, { onDelete: "restrict", onUpdate: "restrict" }),
	reviewedById: int().notNull(),
	reviewedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	note: text(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_daily_report_reviews_date_team").on(table.reportDate, table.teamId),
	index("idx_pmv2_daily_report_reviews_team").on(table.teamId),
	index("idx_pmv2_daily_report_reviews_reviewer").on(table.reviewedById),
	index("idx_pmv2_daily_report_reviews_reviewed_at").on(table.reviewedAt),
]);


// ══════════════════════════════════════════════════════════════════════
// PM V2 — Phase 1 bounded-module schema
// External references (users, warehouses, sites, sections, assets, ...) stay
// logical IDs validated through PM V2 adapters; no physical external FK here.
// ══════════════════════════════════════════════════════════════════════
export const pmv2Specialties = mysqlTable("pmv2_specialties", {
	id: int().autoincrement().primaryKey().notNull(),
	code: varchar({ length: 50 }).notNull(),
	name: varchar({ length: 200 }).notNull(),
	nameEn: varchar({ length: 200 }),
	nameUr: varchar({ length: 200 }),
	description: text(),
	managerUserId: int(),
	isActive: tinyint().default(1).notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_specialties_code").on(table.code),
	index("idx_pmv2_specialties_manager_user").on(table.managerUserId),
	index("idx_pmv2_specialties_created_by").on(table.createdById),
	index("idx_pmv2_specialties_active").on(table.isActive),
]);

export const pmv2Teams = mysqlTable("pmv2_teams", {
	id: int().autoincrement().primaryKey().notNull(),
	specialtyId: int().notNull().references(() => pmv2Specialties.id, { onDelete: "restrict", onUpdate: "restrict" }),
	code: varchar({ length: 50 }).notNull(),
	warehouseId: int().notNull(),
	deviceUserId: int(),
	isActive: tinyint().default(1).notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_teams_code").on(table.code),
	index("idx_pmv2_teams_specialty").on(table.specialtyId),
	index("idx_pmv2_teams_warehouse").on(table.warehouseId),
	index("idx_pmv2_teams_device_user").on(table.deviceUserId),
	index("idx_pmv2_teams_active").on(table.isActive),
]);

export const pmv2TeamMembers = mysqlTable("pmv2_team_members", {
	id: int().autoincrement().primaryKey().notNull(),
	teamId: int().notNull().references(() => pmv2Teams.id, { onDelete: "restrict", onUpdate: "restrict" }),
	userId: int().notNull(),
	isActive: tinyint().default(1).notNull(),
	joinedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	leftAt: timestamp({ mode: 'string' }),
},
(table) => [
	uniqueIndex("uq_pmv2_team_members_team_user").on(table.teamId, table.userId),
	index("idx_pmv2_team_members_team").on(table.teamId),
	index("idx_pmv2_team_members_user").on(table.userId),
	index("idx_pmv2_team_members_active").on(table.isActive),
]);

export const pmv2Checklists = mysqlTable("pmv2_checklists", {
	id: int().autoincrement().primaryKey().notNull(),
	name: varchar({ length: 200 }).notNull(),
	description: text(),
	isActive: tinyint().default(1).notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_pmv2_checklists_active").on(table.isActive),
	index("idx_pmv2_checklists_created_by").on(table.createdById),
]);

export const pmv2ChecklistItems = mysqlTable("pmv2_checklist_items", {
	id: int().autoincrement().primaryKey().notNull(),
	checklistId: int().notNull().references(() => pmv2Checklists.id, { onDelete: "restrict", onUpdate: "restrict" }),
	title: varchar({ length: 300 }).notNull(),
	sortOrder: int().default(0).notNull(),
	isRequired: tinyint().default(1).notNull(),
	isActive: tinyint().default(1).notNull(),
	frequency: mysqlEnum(['daily','weekly','monthly','quarterly','biannual','annual']).notNull(),
	frequencyValue: int(),
	weekday: tinyint(),
	monthDay: tinyint(),
	anchorDate: date({ mode: 'string' }),
	scheduleConfigJson: text(),
},
(table) => [
	index("idx_pmv2_checklist_items_checklist").on(table.checklistId),
	index("idx_pmv2_checklist_items_active").on(table.isActive),
	index("idx_pmv2_checklist_items_frequency").on(table.frequency),
]);


export const pmv2Programs = mysqlTable("pmv2_programs", {
	id: int().autoincrement().primaryKey().notNull(),
	title: varchar({ length: 200 }),
	teamId: int().notNull().references(() => pmv2Teams.id, { onDelete: "restrict", onUpdate: "restrict" }),
	checklistId: int().notNull().references(() => pmv2Checklists.id, { onDelete: "restrict", onUpdate: "restrict" }),
	estimatedDurationMinutes: int(),
	isActive: tinyint().default(1).notNull(),
	createdById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_pmv2_programs_team").on(table.teamId),
	index("idx_pmv2_programs_checklist").on(table.checklistId),
	index("idx_pmv2_programs_active").on(table.isActive),
	index("idx_pmv2_programs_created_by").on(table.createdById),
]);

export const pmv2ProgramTargets = mysqlTable("pmv2_program_targets", {
	id: int().autoincrement().primaryKey().notNull(),
	programId: int().notNull().references(() => pmv2Programs.id, { onDelete: "restrict", onUpdate: "restrict" }),
	siteId: int(),
	sectionId: int(),
	assetId: int(),
},
(table) => [
	index("idx_pmv2_program_targets_program").on(table.programId),
	index("idx_pmv2_program_targets_site").on(table.siteId),
	index("idx_pmv2_program_targets_section").on(table.sectionId),
	index("idx_pmv2_program_targets_asset").on(table.assetId),
	uniqueIndex("uq_pmv2_program_targets_program_site").on(table.programId, table.siteId),
	uniqueIndex("uq_pmv2_program_targets_program_section").on(table.programId, table.sectionId),
	uniqueIndex("uq_pmv2_program_targets_program_asset").on(table.programId, table.assetId),
]);

export const pmv2Tasks = mysqlTable("pmv2_tasks", {
	id: int().autoincrement().primaryKey().notNull(),
	programId: int().notNull().references(() => pmv2Programs.id, { onDelete: "restrict", onUpdate: "restrict" }),
	programTargetId: int().notNull().references(() => pmv2ProgramTargets.id, { onDelete: "restrict", onUpdate: "restrict" }),
	teamId: int().notNull().references(() => pmv2Teams.id, { onDelete: "restrict", onUpdate: "restrict" }),
	taskNumber: varchar({ length: 50 }).notNull(),
	dueDate: date({ mode: 'string' }).notNull(),
	status: mysqlEnum(['pending','in_progress','waiting_material','waiting_ticket','ready_to_complete','completed','cancelled']).default('pending').notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_tasks_task_number").on(table.taskNumber),
	uniqueIndex("uq_pmv2_tasks_generation").on(table.programId, table.programTargetId, table.dueDate),
	index("idx_pmv2_tasks_program").on(table.programId),
	index("idx_pmv2_tasks_program_target").on(table.programTargetId),
	index("idx_pmv2_tasks_team").on(table.teamId),
	index("idx_pmv2_tasks_due_date").on(table.dueDate),
	index("idx_pmv2_tasks_status").on(table.status),
]);

export const pmv2TaskItems = mysqlTable("pmv2_task_items", {
	id: int().autoincrement().primaryKey().notNull(),
	taskId: int().notNull().references(() => pmv2Tasks.id, { onDelete: "restrict", onUpdate: "restrict" }),
	sourceChecklistItemId: int().notNull().references(() => pmv2ChecklistItems.id, { onDelete: "restrict", onUpdate: "restrict" }),
	titleSnapshot: varchar({ length: 300 }).notNull(),
	sortOrderSnapshot: int().default(0).notNull(),
	frequencySnapshot: mysqlEnum(['daily','weekly','monthly','quarterly','biannual','annual']),
	frequencyValueSnapshot: int(),
	weekdaySnapshot: tinyint(),
	monthDaySnapshot: tinyint(),
	anchorDateSnapshot: date({ mode: 'string' }),
	recurrenceLabelSnapshot: varchar({ length: 500 }),
	scheduledDate: date({ mode: 'string' }).notNull(),
	status: mysqlEnum(['pending','in_progress','waiting_material','waiting_ticket','ready_to_complete','completed']).default('pending').notNull(),
	result: mysqlEnum(['ok','fixed','needs_material','needs_ticket']),
},
(table) => [
	uniqueIndex("uq_pmv2_task_items_generation").on(table.taskId, table.sourceChecklistItemId, table.scheduledDate),
	index("idx_pmv2_task_items_task").on(table.taskId),
	index("idx_pmv2_task_items_source_checklist_item").on(table.sourceChecklistItemId),
	index("idx_pmv2_task_items_scheduled_date").on(table.scheduledDate),
	index("idx_pmv2_task_items_status").on(table.status),
	index("idx_pmv2_task_items_result").on(table.result),
]);

export const pmv2Visits = mysqlTable("pmv2_visits", {
	id: int().autoincrement().primaryKey().notNull(),
	taskId: int().notNull().references(() => pmv2Tasks.id, { onDelete: "restrict", onUpdate: "restrict" }),
	startedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	endedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_pmv2_visits_task").on(table.taskId),
	index("idx_pmv2_visits_started_at").on(table.startedAt),
	index("idx_pmv2_visits_ended_at").on(table.endedAt),
]);

export const pmv2VisitMembers = mysqlTable("pmv2_visit_members", {
	id: int().autoincrement().primaryKey().notNull(),
	visitId: int().notNull().references(() => pmv2Visits.id, { onDelete: "restrict", onUpdate: "restrict" }),
	userId: int().notNull(),
	isLeader: tinyint().default(0).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	uniqueIndex("uq_pmv2_visit_members_visit_user").on(table.visitId, table.userId),
	index("idx_pmv2_visit_members_visit").on(table.visitId),
	index("idx_pmv2_visit_members_user").on(table.userId),
	index("idx_pmv2_visit_members_leader").on(table.isLeader),
]);

export const pmv2ItemActions = mysqlTable("pmv2_item_actions", {
	id: int().autoincrement().primaryKey().notNull(),
	taskItemId: int().notNull().references(() => pmv2TaskItems.id, { onDelete: "restrict", onUpdate: "restrict" }),
	visitId: int().notNull().references(() => pmv2Visits.id, { onDelete: "restrict", onUpdate: "restrict" }),
	action: varchar({ length: 50 }).notNull(),
	result: mysqlEnum(['ok','fixed','needs_material','needs_ticket']),
	note: text(),
	performedById: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
},
(table) => [
	index("idx_pmv2_item_actions_task_item").on(table.taskItemId),
	index("idx_pmv2_item_actions_visit").on(table.visitId),
	index("idx_pmv2_item_actions_action").on(table.action),
	index("idx_pmv2_item_actions_result").on(table.result),
	index("idx_pmv2_item_actions_performed_by").on(table.performedById),
	index("idx_pmv2_item_actions_created_at").on(table.createdAt),
]);


export const pmv2MaterialRequests = mysqlTable("pmv2_material_requests", {
	id: int().autoincrement().primaryKey().notNull(),
	taskItemId: int().notNull().references(() => pmv2TaskItems.id, { onDelete: "restrict", onUpdate: "restrict" }),
	visitId: int().notNull().references(() => pmv2Visits.id, { onDelete: "restrict", onUpdate: "restrict" }),
	requestedById: int().notNull(),
	teamId: int().notNull().references(() => pmv2Teams.id, { onDelete: "restrict", onUpdate: "restrict" }),
	teamWarehouseId: int().notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_pmv2_material_requests_task_item").on(table.taskItemId),
	index("idx_pmv2_material_requests_visit").on(table.visitId),
	index("idx_pmv2_material_requests_requested_by").on(table.requestedById),
	index("idx_pmv2_material_requests_team").on(table.teamId),
	index("idx_pmv2_material_requests_team_warehouse").on(table.teamWarehouseId),
	index("idx_pmv2_material_requests_created_at").on(table.createdAt),
]);


export const pmv2MaterialRequestItems = mysqlTable("pmv2_material_request_items", {
	id: int().autoincrement().primaryKey().notNull(),
	requestId: int().notNull().references(() => pmv2MaterialRequests.id, { onDelete: "restrict", onUpdate: "restrict" }),
	catalogItemId: int(),
	itemNameSnapshot: varchar({ length: 300 }).notNull(),
	requestedQuantity: decimal({ precision: 12, scale: 3 }).notNull(),
	unitSnapshot: varchar({ length: 50 }),
	status: mysqlEnum(['waiting_warehouse','external_purchase','received_warehouse','issued_to_team','consumed','cancelled']).default('waiting_warehouse').notNull(),
	receivedWarehouseQuantity: decimal({ precision: 12, scale: 3 }).default('0.000').notNull(),
	issuedToTeamQuantity: decimal({ precision: 12, scale: 3 }).default('0.000').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).defaultNow().onUpdateNow().notNull(),
},
(table) => [
	index("idx_pmv2_material_request_items_request").on(table.requestId),
	index("idx_pmv2_material_request_items_catalog_item").on(table.catalogItemId),
	index("idx_pmv2_material_request_items_status").on(table.status),
]);




// ══════════════════════════════════════════════════════════════════════
// الثوابت والأنواع المساعدة التالية (قوائم الحالات/الأدوار/إلخ) لا تمثّل جداول
// بقاعدة البيانات، لذلك لم تلتقطها أداة سحب الـSchema التلقائي. أُعيدت هنا من
// نسخة الـschema.ts السابقة يدويًا حتى لا تنكسر أي دالة بالتطبيق تعتمد عليها
// (تم تصحيح poItemStatuses لتطابق القيم الـ12 الفعلية المؤكدة من قاعدة الإنتاج).
// ══════════════════════════════════════════════════════════════════════

export const userRoles = ["operator", "technician", "it_manager", "it_member", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "supervisor", "purchase_manager", "purchase_requester", "delegate", "accountant", "senior_management", "executive_director", "warehouse", "gate_security", "owner", "food_warehouse_manager", "food_warehouse_assistant"] as const;

export type UserRole = typeof userRoles[number];

export const supportedLanguages = ["ar", "en", "ur"] as const;

export type SupportedLanguage = typeof supportedLanguages[number];

export const technicianStatuses = ["active", "inactive"] as const;

export const ticketStatuses = [
  "new",
  "pending_triage", "department_planning", "under_inspection", "work_approved",
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

export const ticketCategories = ["electrical", "plumbing", "hvac", "structural", "mechanical", "general", "safety", "cleaning", "it"] as const;

export const poStatuses = [
  "draft", "pending_review", "pending_estimate", "pending_accounting", "pending_management",
  "approved", "partial_purchase", "purchased", "received", "closed", "rejected", "revision_needed"
] as const;

export const poItemStatuses = ["pending", "estimated", "approved", "rejected", "funded", "purchased", "delivered_to_warehouse", "delivered_to_requester", "pending_review", "cancelled", "needs_item_revision", "purchase_cancelled"] as const;

export const poBatchStatuses = [
  "pending_accounting", "pending_management", "approved", "rejected"
] as const;

export const translationStatuses = ["pending", "processing", "completed", "failed", "approved"] as const;

export type TranslationStatus = typeof translationStatuses[number];

export const assetStatuses = ["active", "inactive", "under_maintenance", "disposed"] as const;

export type AssetStatus = typeof assetStatuses[number];

export const pmFrequencies = ["daily", "weekly", "monthly", "quarterly", "biannual", "annual"] as const;

export type PMFrequency = typeof pmFrequencies[number];

export const pmWorkOrderStatuses = ["scheduled", "in_progress", "completed", "overdue", "cancelled"] as const;

export const pmItemResultStatuses = ["ok", "fixed", "issue"] as const;

export type PMItemResultStatus = typeof pmItemResultStatuses[number];

export const pmExecutionSessionStatuses = ["in_progress", "completed", "paused"] as const;

export const improvementCategories = [
  "operational", "technical", "procedural", "safety", "quality",
  "cost_reduction", "productivity", "innovative", "work_note", "recurring_problem",
] as const;

export const improvementGroups = [
  "maintenance_ops", "warehouse_assets", "purchasing_contracts", "safety_quality",
  "tech_digital", "restaurants_services", "hr_training", "customer_experience",
] as const;

export const improvementStatuses = [
  "new", "classified", "approved", "in_progress", "completed", "postponed", "cancelled",
] as const;

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

export const itemTypes = ["spare_part", "consumable", "tool", "food"] as const;

export type ItemType = typeof itemTypes[number];

export const warehouseTypes = ["main", "project", "branch", "kitchen"] as const;

export type WarehouseType = typeof warehouseTypes[number];

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

export const ocrJobStatuses = ["pending", "processing", "completed", "failed"] as const;

export const inventoryCountScopes = ["full", "partial"] as const;

export const inventoryCountStatuses = ["in_progress", "completed"] as const;

export const inventorySettlementSourceTypes = ["from_count", "manual"] as const;

export const pmMaterialRequestStatuses = ["pending", "processed"] as const;

export type PMMaterialRequestStatus = typeof pmMaterialRequestStatuses[number];

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
