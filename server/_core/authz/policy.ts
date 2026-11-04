/**
 * ══════════════════════════════════════════════════════════════════════════
 * الحارس المركزي لطلبات الشراء — الطبقة 1: تعريف السياسات (Policy)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * هذا الملف هو **مصدر الحقيقة الوحيد** لصلاحيات دورة طلب الشراء. لا يحتوي أي
 * منطق تنفيذي (ذلك بملف engine.ts) — فقط بيانات صريحة تعكس جدول الصلاحيات
 * المعتمد (نسخة v2 + تعديل تضييق نطاق الحسابات، 2026-07-28).
 *
 * أي تغيير مستقبلي بالصلاحيات يبدأ ويُقصر على هذا الملف. لا تضف شروط صلاحية
 * جديدة داخل الراوترات مباشرة — أضفها هنا، واستدعها عبر engine.ts.
 *
 * مبدأ المنع الافتراضي (Default Deny): أي تركيبة (دور × إجراء × حالة) غير
 * موجودة صراحة بهذا الملف تُرفض تلقائيًا من engine.ts.
 */

// ──────────────────────────────────────────────────────────────────────────
// مجموعات حالات الطلب (PO status) — تُستخدم بكل مكان بدل تكرار السلاسل النصية
// ──────────────────────────────────────────────────────────────────────────

export const PO_STATUS = {
  DRAFT: "draft",
  PENDING_REVIEW: "pending_review",
  PENDING_ESTIMATE: "pending_estimate",
  PENDING_ACCOUNTING: "pending_accounting",
  PENDING_MANAGEMENT: "pending_management",
  APPROVED: "approved",
  PARTIAL_PURCHASE: "partial_purchase",
  PURCHASED: "purchased",
  RECEIVED: "received",
  CLOSED: "closed",
  REJECTED: "rejected",
  REVISION_NEEDED: "revision_needed",
} as const;

export type POStatus = (typeof PO_STATUS)[keyof typeof PO_STATUS];

/** كل الحالات بعد الاعتماد الإداري فصاعدًا (تشمل نهايات الدورة) */
const FROM_PENDING_MANAGEMENT_ONWARD: POStatus[] = [
  PO_STATUS.PENDING_MANAGEMENT,
  PO_STATUS.APPROVED,
  PO_STATUS.PARTIAL_PURCHASE,
  PO_STATUS.PURCHASED,
  PO_STATUS.RECEIVED,
  PO_STATUS.CLOSED,
  PO_STATUS.REJECTED,
  PO_STATUS.REVISION_NEEDED,
];

/** مراحل الشراء والاستلام فقط (لا مسودات، لا اعتماد مالي) */
const PURCHASING_AND_RECEIVING_STAGES: POStatus[] = [
  PO_STATUS.PARTIAL_PURCHASE,
  PO_STATUS.PURCHASED,
  PO_STATUS.RECEIVED,
  PO_STATUS.CLOSED,
];

// ──────────────────────────────────────────────────────────────────────────
// الأدوار
// ──────────────────────────────────────────────────────────────────────────

export const ROLE = {
  OWNER: "owner",
  ADMIN: "admin",
  PURCHASE_REQUESTER: "purchase_requester",
  FOOD_WAREHOUSE_ASSISTANT: "food_warehouse_assistant",
  FOOD_WAREHOUSE_MANAGER: "food_warehouse_manager",
  MAINTENANCE_MANAGER: "maintenance_manager",
  GENERAL_MAINTENANCE_MANAGER: "general_maintenance_manager",
  CONSTRUCTION_PROCUREMENT_MANAGER: "construction_procurement_manager",
  PURCHASE_MANAGER: "purchase_manager",
  DELEGATE: "delegate",
  ACCOUNTANT: "accountant",
  SENIOR_MANAGEMENT: "senior_management",
  EXECUTIVE_DIRECTOR: "executive_director",
  WAREHOUSE: "warehouse",
  TECHNICIAN: "technician",
  IT_MANAGER: "it_manager",
  IT_MEMBER: "it_member",
  OPERATOR: "operator",
  SUPERVISOR: "supervisor",
  GATE_SECURITY: "gate_security",
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

/** الأدوار التي تتجاوز كل قواعد هذا الملف دائمًا (لا تحتاج ذكرها بكل قاعدة) */
export const BYPASS_ALL_ROLES: Role[] = [ROLE.OWNER, ROLE.ADMIN];

/** طلب تغيير مندوب الصنف يقدمه المندوب الحالي، ويُحسم بواسطة مدير الصيانة أو الإدارة. */
export const DELEGATE_CHANGE_REQUEST_ROLES: Role[] = [ROLE.DELEGATE];
/** Routed review is decided from the current item, never a header-role grant. */
export const ROUTED_REVIEW_BLOCKED_PO_STATUSES = ["draft", "revision_needed", "closed", "rejected"] as const;
export const DELEGATE_CHANGE_RESOLVER_ROLES: Role[] = [
  ROLE.MAINTENANCE_MANAGER,
  ROLE.GENERAL_MAINTENANCE_MANAGER,
  ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  ROLE.OWNER,
  ROLE.ADMIN,
];

/** الأدوار كاملة الصلاحية للإشراف (ترى كل شيء، لكن ليست bypass لكل الإجراءات) */
export const FULL_VISIBILITY_MANAGER_ROLES: Role[] = [
  ROLE.MAINTENANCE_MANAGER,
  ROLE.GENERAL_MAINTENANCE_MANAGER,
  ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  ROLE.PURCHASE_MANAGER,
];

/** أدوار لا علاقة وظيفية لها بدورة الشراء — نطاقها دائمًا "طلباتها الخاصة فقط" */
export const OWN_REQUESTS_ONLY_ROLES: Role[] = [
  ROLE.PURCHASE_REQUESTER,
  ROLE.FOOD_WAREHOUSE_ASSISTANT,
  ROLE.TECHNICIAN,
  ROLE.IT_MANAGER,
  ROLE.IT_MEMBER,
  ROLE.OPERATOR,
  ROLE.SUPERVISOR,
  ROLE.GATE_SECURITY,
];

// ──────────────────────────────────────────────────────────────────────────
// سياسة الرؤية (Visibility) — تحدد نطاق العمل الوظيفي لكل دور. يضيف engine.ts
// إلى هذا النطاق قاعدة عامة مستقلة: كل دور معرَّف يرى طلباته الشخصية بكل المراحل.
// ──────────────────────────────────────────────────────────────────────────

export type VisibilityRule =
  | { kind: "all" }
  | { kind: "own" }
  | { kind: "own_plus_role"; extraRole: Role }
  | { kind: "assigned_items_only" }
  | { kind: "status_exact"; status: POStatus }
  | { kind: "status_range"; excludedStatuses: POStatus[] };

/**
 * جدول الرؤية الكامل — لكل دور غير bypass، القاعدة التي تحدد أي الطلبات يراها.
 * BYPASS_ALL_ROLES (owner/admin) لا تحتاج قاعدة هنا — تُعامل كـ"all" دائمًا
 * من داخل engine.ts مباشرة.
 */
export const VISIBILITY_POLICY: Record<string, VisibilityRule> = {
  [ROLE.MAINTENANCE_MANAGER]: { kind: "all" },
  [ROLE.GENERAL_MAINTENANCE_MANAGER]: { kind: "all" },
  [ROLE.CONSTRUCTION_PROCUREMENT_MANAGER]: { kind: "all" },
  [ROLE.PURCHASE_MANAGER]: { kind: "all" },

  [ROLE.PURCHASE_REQUESTER]: { kind: "own" },
  [ROLE.FOOD_WAREHOUSE_ASSISTANT]: { kind: "own" },
  [ROLE.TECHNICIAN]: { kind: "own" },
  [ROLE.IT_MANAGER]: { kind: "own" },
  [ROLE.IT_MEMBER]: { kind: "own" },
  [ROLE.OPERATOR]: { kind: "own" },
  [ROLE.SUPERVISOR]: { kind: "own" },
  [ROLE.GATE_SECURITY]: { kind: "own" },

  [ROLE.FOOD_WAREHOUSE_MANAGER]: { kind: "own_plus_role", extraRole: ROLE.FOOD_WAREHOUSE_ASSISTANT },

  [ROLE.DELEGATE]: { kind: "assigned_items_only" },

  // ⚠️ تطابق تام، وليس نطاقًا — تضييق صريح بتاريخ 2026-07-28 (راجع CHANGELOG_TECHNICAL.md)
  [ROLE.ACCOUNTANT]: { kind: "status_exact", status: PO_STATUS.PENDING_ACCOUNTING },

  // نطاق (لم يُضيَّق) — يشمل كل شيء من pending_management فصاعدًا
  [ROLE.SENIOR_MANAGEMENT]: {
    kind: "status_range",
    excludedStatuses: [PO_STATUS.DRAFT, PO_STATUS.PENDING_REVIEW, PO_STATUS.PENDING_ESTIMATE, PO_STATUS.PENDING_ACCOUNTING],
  },
  [ROLE.EXECUTIVE_DIRECTOR]: {
    kind: "status_range",
    excludedStatuses: [PO_STATUS.DRAFT, PO_STATUS.PENDING_REVIEW, PO_STATUS.PENDING_ESTIMATE, PO_STATUS.PENDING_ACCOUNTING],
  },

  // المستودع يرى طلبات الآخرين فقط ضمن مراحل عمله الفعلية. قاعدة الملكية
  // العامة في engine.ts تبقي طلباته الشخصية ظاهرة له في جميع المراحل.
  [ROLE.WAREHOUSE]: {
    kind: "status_range",
    excludedStatuses: [
      PO_STATUS.DRAFT,
      PO_STATUS.PENDING_REVIEW,
      PO_STATUS.PENDING_ESTIMATE,
      PO_STATUS.PENDING_ACCOUNTING,
      PO_STATUS.PENDING_MANAGEMENT,
      PO_STATUS.APPROVED,
      PO_STATUS.REJECTED,
      PO_STATUS.REVISION_NEEDED,
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// سياسة الإجراءات (Actions) — كل إجراء ومن يملكه وتحت أي شرط
// ──────────────────────────────────────────────────────────────────────────

export type ActionName =
  | "create"
  | "editDraft"
  | "submitDraft"
  | "deleteOrder"
  | "reviewItems"
  | "editItem"
  | "deleteItem"
  | "cancelItem"
  | "estimateCost"
  | "submitPricedBatch"
  | "approveAccounting"
  | "approveManagement"
  | "reject"
  | "confirmPurchase"
  | "confirmDeliveryToWarehouse"
  | "confirmDeliveryToRequester"
  // [PB] إجراءا حزمة الشراء — إضافة صرفة (2026-08-29). الحزمة حاوية
  // تجميعية للعرض والتعيين والمتابعة فقط، لا تغيّر حالة أي طلب أو صنف.
  | "createPurchasePackage"
  | "viewPurchasePackage";

export type Ownership = "none" | "creator";

export interface ActionClause {
  /** الأدوار المسموحة بهذا الشرط (بخلاف BYPASS_ALL_ROLES، مسموحة دائمًا) */
  roles: Role[];
  /** حالات الطلب المسموح تنفيذ الإجراء فيها. "any" = بلا قيد حالة */
  statuses: POStatus[] | "any";
  /** هل يُشترط أن يكون منفّذ الإجراء هو منشئ الطلب؟ */
  ownership?: Ownership;
}

/**
 * جدول الإجراءات الكامل. كل إجراء = قائمة "بنود" (clauses)؛ الإجراء مسموح لو
 * تحقّق بند واحد على الأقل (roles تطابق + statuses تطابق + ownership تطابق).
 * BYPASS_ALL_ROLES تُفحص أولًا بـengine.ts قبل الرجوع لهذا الجدول.
 */
export const ACTION_POLICY: Record<ActionName, ActionClause[]> = {
  create: [{ roles: Object.values(ROLE), statuses: "any" }], // مفتوح لأي دور — قرار صريح، راجع PENDING_TASKS.md

  editDraft: [{ roles: Object.values(ROLE), statuses: [PO_STATUS.DRAFT], ownership: "creator" }],
  submitDraft: [{ roles: Object.values(ROLE), statuses: [PO_STATUS.DRAFT], ownership: "creator" }],

  deleteOrder: [{ roles: [], statuses: "any" }], // owner/admin فقط — bypass، لا بند إضافي

  reviewItems: [
    { roles: [
      ROLE.MAINTENANCE_MANAGER,
      ROLE.GENERAL_MAINTENANCE_MANAGER,
      ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
      ROLE.PURCHASE_MANAGER,
    ], statuses: [PO_STATUS.PENDING_REVIEW] },
    { roles: [ROLE.FOOD_WAREHOUSE_MANAGER], statuses: [PO_STATUS.PENDING_REVIEW] }, // مقيّد إضافيًا بنطاق الملكية بـengine.ts
  ],

  // editItem/deleteItem: منطقهما أعقد من شكل ActionClause (مستوى الصنف لا الطلب
  // فقط) — معرَّفتان بـITEM_ACTION_POLICY أدناه بدلًا من هذا الجدول، وتُستخدمان
  // عبر canPerformItemAction وليس canPerformAction.
  editItem: [],
  deleteItem: [],

  // إلغاء الصنف الإداري مرتبط بمرحلة الدور: مدير الصيانة قبل التسعير،
  // والإدارة العليا في مرحلة اعتماد الإدارة. owner/admin يتجاوزان دائمًا.
  cancelItem: [
    { roles: [
      ROLE.MAINTENANCE_MANAGER,
      ROLE.GENERAL_MAINTENANCE_MANAGER,
      ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
    ], statuses: [PO_STATUS.DRAFT, PO_STATUS.PENDING_REVIEW] },
    { roles: [ROLE.SENIOR_MANAGEMENT], statuses: [PO_STATUS.PENDING_MANAGEMENT] },
  ],

  estimateCost: [{ roles: [ROLE.DELEGATE], statuses: "any" }], // مقيّد إضافيًا بملكية الصنف بـengine.ts (isItemAssignedToDelegate)
  submitPricedBatch: [{ roles: [ROLE.DELEGATE], statuses: "any" }],

  approveAccounting: [{ roles: [ROLE.ACCOUNTANT], statuses: [PO_STATUS.PENDING_ACCOUNTING] }],
  approveManagement: [{ roles: [ROLE.SENIOR_MANAGEMENT], statuses: [PO_STATUS.PENDING_MANAGEMENT] }], // executive_director مستثنى صراحة (ليس بالقائمة)

  reject: [
    { roles: [ROLE.ACCOUNTANT], statuses: [PO_STATUS.PENDING_ACCOUNTING] },
    { roles: [ROLE.SENIOR_MANAGEMENT], statuses: [PO_STATUS.PENDING_MANAGEMENT] },
    // executive_director غير مذكور هنا عمدًا — ممنوع صراحة بكل الحالات (Default Deny)
  ],

  confirmPurchase: [{ roles: [ROLE.DELEGATE], statuses: [PO_STATUS.APPROVED, PO_STATUS.PARTIAL_PURCHASE] }], // ملكية الصنف تُفحص إضافيًا بـengine.ts
  // confirmDeliveryToWarehouse/confirmDeliveryToRequester: تُفحصان بحالة **الصنف**
  // لا حالة الطلب (طلب واحد قد يحوي أصنافًا بحالات مختلفة في آن واحد أثناء
  // الشراء الجزئي) — معرَّفتان بـITEM_STATUS_ACTION_POLICY أدناه بدلًا من هذا الجدول.
  confirmDeliveryToWarehouse: [],
  confirmDeliveryToRequester: [],

  // ────────────────────────────────────────────────────────────────────
  // [PB] حزمة الشراء (2026-08-29) — إضافة صرفة، صفر تعديل على أي بند أعلاه.
  //
  // التجميع فعل يقوم به دور المراجع (مدير الصيانة)، فيقع حيث يقع دوره
  // بالضبط: نفس أدوار reviewItems ونفس حالة PENDING_REVIEW. هذا ليس
  // اختيارًا تصميميًا جديدًا بل اشتقاق مباشر من قاعدة "الحزمة مرآة لطلب
  // الشراء": ما يستطيعه المراجع على الطلب يستطيعه على حزمته.
  //
  // ملاحظة: هذان الإجراءان لا يغيّران حالة أي طلب أو صنف إطلاقًا — يكتبان
  // على purchase_orders.packageId فقط (عمود تجميعي اختياري).
  // ────────────────────────────────────────────────────────────────────
  createPurchasePackage: [
    { roles: [
      ROLE.MAINTENANCE_MANAGER,
      ROLE.GENERAL_MAINTENANCE_MANAGER,
      ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
      ROLE.PURCHASE_MANAGER,
    ], statuses: [PO_STATUS.PENDING_REVIEW] },
    { roles: [ROLE.FOOD_WAREHOUSE_MANAGER], statuses: [PO_STATUS.PENDING_REVIEW] }, // مقيّد إضافيًا بنطاق الملكية بـengine.ts
  ],

  // العرض متاح لكل من يرى الطلب أصلًا بأي مرحلة — الحزمة لا تضيف صلاحية
  // رؤية جديدة، بل تعرض ما يراه المستخدم اليوم مجمّعًا. الفلترة الفعلية
  // لما يراه كل دور تبقى في طبقة الراوتر كما هي اليوم بلا تغيير.
  viewPurchasePackage: [{ roles: Object.values(ROLE), statuses: "any" }],
};

// ──────────────────────────────────────────────────────────────────────────
// سياسة إجراءات مستوى الصنف (Item-level actions) — editItem / deleteItem
// ──────────────────────────────────────────────────────────────────────────
//
// هذي الإجراءات لا يمكن التعبير عنها بشكل ActionClause البسيط أعلاه لأن
// صلاحيتها تعتمد على تركيبة (دور × حالة الطلب × حالة الصنف × هل المنفّذ هو
// منشئ الطلب) بمنطق أكثر ثراءً من "قائمة بنود OR". القاعدة المستخرجة من الكود
// الفعلي الأصلي (purchase-orders.router.ts) بالضبط:
//
//  1. استثناء منشئ الطلب: مسموح له التصرف لو (الصنف بحالة مراجعة/إلغاء) أو
//     (الطلب كله بحالة revision_needed) — بغض النظر عن دوره.
//  2. غير ذلك: يُشترط أن يكون بأحد الأدوار المميّزة، وأن تكون حالة الطلب من
//     ضمن الحالات القابلة للتعديل.
//  3. لو حالة الطلب revision_needed، تُقصر الصلاحية على المنشئ لبقية الأدوار.
//     owner/admin يتجاوزان هذه القيود من engine.ts وفق قاعدة BYPASS_ALL_ROLES
//     الموحدة على كل إجراءات الطلب والصنف.

export interface ItemActionRule {
  /** الأدوار المميّزة غير bypass المسموح لها بالتصرف بمعزل عن كونها منشئ الطلب.
   * owner/admin لا يحتاجان ذكرًا هنا لأن engine.ts يمنحهما تجاوزًا مطلقًا أولًا. */
  privilegedRoles: Role[];
  /** حالات الطلب المسموح للأدوار المميّزة التصرف فيها */
  privilegedEditableStatuses: POStatus[];
  /** حالات الصنف التي تمنح منشئ الطلب استثناءً (بغض النظر عن حالة الطلب) */
  creatorExceptionItemStatuses: string[];
  /** حالات الطلب التي تمنح منشئ الطلب استثناءً (بغض النظر عن حالة الصنف) */
  creatorExceptionPOStatuses: POStatus[];
  /** حالات طلب مقصورة على منشئ الطلب حصرًا لبقية الأدوار غير bypass */
  creatorOnlyPOStatuses: POStatus[];
}

/** حالات الصنف التي يُعاد فيها القرار إلى منشئ الطلب. */
export const CREATOR_RETURNED_ITEM_STATUSES = ["needs_item_revision", "purchase_cancelled"] as const;
export type CreatorReturnedItemStatus = (typeof CREATOR_RETURNED_ITEM_STATUSES)[number];

export const ITEM_ACTION_POLICY: Record<"editItem" | "deleteItem", ItemActionRule> = {
  editItem: {
    privilegedRoles: [
      ROLE.MAINTENANCE_MANAGER,
      ROLE.GENERAL_MAINTENANCE_MANAGER,
      ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
    ],
    privilegedEditableStatuses: [
      PO_STATUS.DRAFT, PO_STATUS.PENDING_REVIEW, PO_STATUS.REVISION_NEEDED,
    ],
    creatorExceptionItemStatuses: ["needs_item_revision", "purchase_cancelled"],
    creatorExceptionPOStatuses: [PO_STATUS.REVISION_NEEDED],
    creatorOnlyPOStatuses: [PO_STATUS.REVISION_NEEDED],
  },
  deleteItem: {
    privilegedRoles: [
      ROLE.MAINTENANCE_MANAGER,
      ROLE.GENERAL_MAINTENANCE_MANAGER,
      ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
    ],
    privilegedEditableStatuses: [
      PO_STATUS.DRAFT, PO_STATUS.PENDING_REVIEW,
    ],
    creatorExceptionItemStatuses: ["needs_item_revision", "purchase_cancelled"],
    creatorExceptionPOStatuses: [PO_STATUS.REVISION_NEEDED],
    creatorOnlyPOStatuses: [PO_STATUS.REVISION_NEEDED],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// سياسة إجراءات تُفحص بحالة **الصنف** حصرًا (لا حالة الطلب) — مثال: طلب واحد
// أثناء "شراء جزئي" قد يحوي صنفًا "مشترى" وآخر لسه "معتمد بانتظار الشراء" في
// آن واحد؛ فحص حالة الطلب ككل لا يكفي لتحديد هل *هذا الصنف بالذات* جاهز.
// ──────────────────────────────────────────────────────────────────────────

export interface ItemStatusActionClause {
  roles: Role[];
  itemStatuses: string[];
}

export const ITEM_STATUS_ACTION_POLICY: Record<
  "confirmDeliveryToWarehouse" | "confirmDeliveryToRequester",
  ItemStatusActionClause[]
> = {
  confirmDeliveryToWarehouse: [{ roles: [ROLE.WAREHOUSE], itemStatuses: ["purchased"] }],
  confirmDeliveryToRequester: [{ roles: [ROLE.WAREHOUSE], itemStatuses: ["delivered_to_warehouse"] }],
};
