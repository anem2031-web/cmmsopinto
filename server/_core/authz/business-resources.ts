import { TRPCError } from "@trpc/server";
import { isBusinessGuardedRole, type BusinessIdentity } from "../../../shared/business-role-policy";

const parentTables = {
  PO_ITEM: ["purchaseOrderItems", "purchaseOrderId", "po"],
  PO_BATCH: ["poPricingBatches", "purchaseOrderId", "po"],
  PO_COMMENT: ["procurementComments", "purchaseOrderId", "po"],
  PO_ITEM_HISTORY: ["purchaseOrderItemHistory", "purchaseOrderId", "po"],
  TICKET_ITEM: ["ticketItems", "ticketId", "ticket"],
  TICKET_TASK: ["ticketTasks", "ticketId", "ticket"],
  TICKET_STATUS_HISTORY: ["ticketStatusHistory", "ticketId", "ticket"],
  TICKET_DEPARTMENT: ["ticketDepartments", "ticketId", "ticket"],
  INSPECTION_RESULT: ["inspectionResults", "ticketId", "ticket"],
  EXTERNAL_MAINTENANCE_JOB: ["externalMaintenanceJobs", "ticketId", "external"],
  NOTIFICATION: ["notifications", "userId", "user"],
} as const;
type ScopeKind = "po" | "ticket" | "external" | "package" | "user";
type TranslationParent = { id: number; parentId: number; purchaseOrderItemId?: number | null };
export interface BusinessTranslationPort {
  parents(type: keyof typeof parentTables, ids: number[]): Promise<TranslationParent[]>;
  authorize(user: BusinessIdentity, kind: ScopeKind, id: number): Promise<void>;
  authorizeMany?(user: BusinessIdentity, kind: ScopeKind, ids: number[]): Promise<void>;
  authorizeRows?(user: BusinessIdentity, type: keyof typeof parentTables, rows: TranslationParent[]): Promise<void>;
}
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لبيانات الترجمة المطلوبة" });
const port: BusinessTranslationPort = {
  authorizeMany: authorizeBusinessTranslationParents,
  authorizeRows: authorizeBusinessPurchaseTranslationRows,
  async parents(type, ids) {
    const db = await import("../db");
    const schema = await import("../../../drizzle/schema");
    const { inArray } = await import("drizzle-orm");
    const [tableName, parentColumn] = parentTables[type];
    const table = (schema as any)[tableName];
    const connection = await db.getDb();
    if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
    if (type === "PO_COMMENT" || type === "PO_ITEM_HISTORY") {
      return connection.select({ id: table.id, parentId: table[parentColumn], purchaseOrderItemId: table.purchaseOrderItemId })
        .from(table).where(inArray(table.id, ids));
    }
    return connection.select({ id: table.id, parentId: table[parentColumn] }).from(table).where(inArray(table.id, ids));
  },
  async authorize(user, kind, id) {
    if (kind === "user") { if (id !== user.id) throw denied(); return; }
    const db = await import("../db");
    if (kind === "external" && user.role === "warehouse") return;
    if (kind === "ticket" || kind === "external") {
      const ticket = await db.getTicketById(id);
      if (!ticket) throw denied();
      const { assertTicketReadable } = await import("../../routers/tickets/tickets.access");
      await assertTicketReadable(user, ticket);
      return;
    }
    const { assertCanViewPurchaseOrder, assertCanPerformPOAction, filterVisiblePurchaseOrders } = await import("./guard");
    if (kind === "po") {
      const po = await db.getPurchaseOrderById(id);
      if (!po) throw denied();
      await assertCanViewPurchaseOrder(user, po);
      return;
    }
    assertCanPerformPOAction("viewPurchasePackage", user);
    const orders = await db.getPurchaseOrdersByPackage(id);
    if (!(await filterVisiblePurchaseOrders(user, orders)).length) throw denied();
  },
};

/** Batch only read authorization, reusing the same PO/ticket decisions. */
export async function authorizeBusinessTranslationParents(user: BusinessIdentity, kind: ScopeKind, ids: number[]) {
  if (!ids.length) return;
  if (kind === "user") { if (ids.some(id => id !== user.id)) throw denied(); return; }
  if (kind === "external" && user.role === "warehouse") return; // Existing warehouse exception.
  if (kind === "ticket" || kind === "external") {
    const { loadTicketReadScope } = await import("../db/ticket-read-scope");
    const { assertTicketReadable } = await import("../../routers/tickets/tickets.access");
    const scope = await loadTicketReadScope(user, ids);
    for (const id of ids) {
      const ticket = scope.tickets.get(id); if (!ticket) throw denied();
      await assertTicketReadable(user, ticket, undefined, scope.source);
    }
    return;
  }
  const db = await import("../db");
  const { createPurchaseOrderReadGuard, assertCanPerformPOAction } = await import("./guard");
  if (kind === "po") {
    const orders = new Map<number, any>((await db.getPurchaseOrdersByIds(ids)).map(row => [Number(row.id), row]));
    const check = await createPurchaseOrderReadGuard(user, Array.from(orders.values()));
    for (const id of ids) { const order = orders.get(id); if (!order) throw denied(); check(order); }
    return;
  }
  assertCanPerformPOAction("viewPurchasePackage", user);
  const orders = await db.getPurchaseOrdersForPackages(ids);
  const check = await createPurchaseOrderReadGuard(user, orders);
  const visiblePackages = new Set<number>();
  for (const order of orders) {
    try { check(order); visiblePackages.add(Number(order.packageId)); }
    catch (error) { if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN") throw error; }
  }
  if (ids.some(id => !visiblePackages.has(id))) throw denied();
}

/** New early reviewer access cannot authorize translations of a foreign line. */
export async function authorizeBusinessPurchaseTranslationRows(user: BusinessIdentity, type: keyof typeof parentTables, rows: TranslationParent[]) {
  const ids = Array.from(new Set(rows.map(row => Number(row.parentId))));
  const db = await import("../db");
  const { createPurchaseOrderReadScope } = await import("./guard");
  const orders = await db.getPurchaseOrdersByIds(ids);
  const byId = new Map<number, any>(orders.map(row => [Number(row.id), row]));
  const scope = await createPurchaseOrderReadScope(user, orders);
  for (const id of ids) { const order = byId.get(id); if (!order) throw denied(); scope.assert(order); }
  const earlyBatchParents = type === "PO_BATCH" ? orders.filter(order => scope.isRoutedReviewOnly(order)).map(order => Number(order.id)) : [];
  const batchItems = earlyBatchParents.length ? await db.getFullPOItemsForPOs(earlyBatchParents) : [];
  for (const row of rows) {
    const order = byId.get(Number(row.parentId));
    if (!scope.isRoutedReviewOnly(order)) continue;
    if (type === "PO_BATCH") {
      const members = batchItems.filter(item => Number(item.purchaseOrderId) === Number(order.id) && Number(item.batchId) === Number(row.id));
      if (!members.length || scope.filterItems(order, members).length !== members.length) throw denied();
      continue;
    }
    const itemId = type === "PO_ITEM" ? row.id : row.purchaseOrderItemId;
    // Shared header comments retain their existing visibility; history always has a line.
    if (itemId == null && type === "PO_COMMENT") continue;
    if (itemId == null || !scope.filterItems(order, [{ id: Number(itemId), purchaseOrderId: Number(order.id) }]).length) throw denied();
  }
}

async function authorizeParents(source: BusinessTranslationPort, user: BusinessIdentity, kind: ScopeKind, ids: number[]) {
  if (source.authorizeMany && ids.length > 1) return source.authorizeMany(user, kind, ids);
  for (const id of ids) await source.authorize(user, kind, id);
}
const referenceTypes = new Set(["USER", "SITE", "SECTION", "ASSET", "CENTER_CATEGORY", "ASSET_CATEGORY", "INVENTORY"]);
const legacyReportTypes = new Set(["PM_PLAN", "PM_WORK_ORDER", "PM_RESULT", "PM_SESSION", "PM_CHECKLIST"]);

/** Match the chosen parser, and authorize every parent before reading any text. */
export async function assertBusinessTranslationAccess(user: BusinessIdentity, raw: unknown, mode: "single" | "batch", source = port) {
  if (!isBusinessGuardedRole(user.role)) return;
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const type = String(input.entityType);
  const values = mode === "batch" ? input.entityIds : [input.entityId];
  if (!Array.isArray(values) || values.length > 200 || values.some(id => !Number.isSafeInteger(id) || id <= 0)) throw denied();
  const ids = Array.from(new Set(values)) as number[];
  if (referenceTypes.has(type)) return;
  if (["DELIVERY_DOCUMENT", "RETURN_DOCUMENT"].includes(type) && user.role !== "accountant") return;
  if (legacyReportTypes.has(type) && ["senior_management", "executive_director"].includes(user.role)) return;
  const kind = type === "PO" ? "po" : type === "TICKET" ? "ticket" : type === "PO_PACKAGE" ? "package" : null;
  if (kind) return authorizeParents(source, user, kind, ids);
  if (!Object.hasOwn(parentTables, type)) throw denied();
  const tableType = type as keyof typeof parentTables;
  const rows = ids.length ? await source.parents(tableType, ids) : [];
  if (rows.length !== ids.length || ids.some(id => !rows.some(row => row.id === id))) throw denied();
  if (user.role === "senior_management" && parentTables[tableType][2] === "po" && source.authorizeRows) {
    return source.authorizeRows(user, tableType, rows);
  }
  await authorizeParents(source, user, parentTables[tableType][2], Array.from(new Set(rows.map(row => row.parentId))));
}
