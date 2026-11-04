import { TRPCError } from "@trpc/server";
import { vi } from "vitest";
import { PurchaseSpecificationsService } from "../../services/purchase-specifications";
import { purchaseSpecificationsDatabase } from "./purchaseSpecificationsDatabase";

export const specificationPeople = {
  construction: { id: 31, role: "construction_procurement_manager", isActive: 1, name: "مدير الإنشاءات" },
  warehouse: { id: 32, role: "warehouse", isActive: 1, name: "المستودع" },
  admin: { id: 33, role: "admin", isActive: 1, name: "مدير النظام" },
  owner: { id: 34, role: "owner", isActive: 1, name: "المالك" },
};

/** A source is an actual receipt, item, original inventory and physical lot. */
export function seedSpecificationReceipt(f: ReturnType<typeof purchaseSpecificationsDatabase>, options: {
  id?: number; orderId?: number; itemId?: number; inventoryId?: number; receiptId?: number;
  receiptItemId?: number; warehouseId?: number; status?: string | null; reviewRole?: string | null;
  receiptStatus?: string; quantity?: number; remaining?: number; name?: string; createdAt?: string;
  requestedById?: number; sourceType?: string;
} = {}) {
  const id = options.id ?? 1, orderId = options.orderId ?? 10, itemId = options.itemId ?? id + 1000;
  const inventoryId = options.inventoryId ?? id + 2000, receiptId = options.receiptId ?? id + 3000;
  const receiptItemId = options.receiptItemId ?? id + 4000, warehouseId = options.warehouseId ?? 1;
  const quantity = options.quantity ?? 6, remaining = options.remaining ?? quantity;
  const ensure = (table: string, row: any) => {
    if (!f.memory.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id)) f.insert(table, row);
  };
  ensure("purchase_orders", { id: orderId, poNumber: `PR-${orderId}`, status: "partially_received", requestedById: options.requestedById ?? 31, ticketId: 500, ticketItemId: 501, siteId: 50, sectionId: 51 });
  ensure("purchase_order_items", { id: itemId, purchaseOrderId: orderId, itemName: options.name ?? `Material ${id}`, quantity, unit: "قطعة", status: "received", reviewRole: options.reviewRole === undefined ? "construction_procurement_manager" : options.reviewRole, catalogItemId: 9000, purchasedPhotoUrl: "/purchase.jpg", invoicePhotoUrl: "/invoice.jpg", warehousePhotoUrl: "/received.jpg" });
  ensure("warehouse_receipts", { id: receiptId, receiptNumber: `WR-${receiptId}`, purchaseOrderId: orderId, status: options.receiptStatus ?? "confirmed", vendorName: "المورد", invoiceNumber: "INV-123", receivedById: 32, receivedAt: "2026-11-04 08:00:00" });
  ensure("warehouse_receipt_items", { id: receiptItemId, receiptId, purchaseOrderItemId: itemId, inventoryId, itemName: `Invoice material ${id}`, catalogItemId: 9000, receivedQuantity: quantity, purchaseUnit: "قطعة", unitCost: "12.5000", lineTotal: "75.0000" });
  ensure("warehouses", { id: warehouseId, nameAr: "المخزن الرئيسي", nameEn: "Main", code: `MAIN-${warehouseId}`, type: "main", isActive: 1 });
  ensure("inventory", { id: inventoryId, warehouseId, linkedItemId: 9000, itemName: `Stock ${id}`, unit: "قطعة", issueUnit: "قطعة", quantity: remaining, averageCost: 12.5, totalCostValue: remaining * 12.5 });
  f.insert("inventory_lots", { id, lotCode: `LOT-${id}`, trackingToken: `CMMS-LOT-${id}`, sourceType: options.sourceType ?? "receipt", catalogItemId: 9000, receiptId, receiptItemId, purchaseOrderId: orderId, purchaseOrderItemId: itemId, originalQuantity: quantity, remainingQuantity: remaining, purchaseUnit: "قطعة", issueUnit: "قطعة", conversionFactor: 1, purchaseUnitCost: 12.5, issueUnitCost: 12.5, createdById: 32, createdAt: options.createdAt ?? "2026-11-04 08:00:00", specificationStatus: options.status === undefined ? "pending" : options.status, specificationRevision: 0 });
  f.insert("inventory_lot_balances", { lotId: id, inventoryId, quantity: remaining });
  return { id, orderId, itemId, inventoryId, receiptId, receiptItemId, warehouseId, quantity };
}

export function specificationFixture() {
  const f = purchaseSpecificationsDatabase();
  Object.values(specificationPeople).forEach(person => f.insert("users", person));
  const scope = new Map<number, Set<number>>();
  const readGuard = vi.fn(async (actor: any, orders?: readonly any[]) => {
    // Deliberately independent per parent; one allowed row cannot authorize another.
    const allowed = scope.get(actor.id);
    return (order: any) => {
      if (allowed && !allowed.has(Number(order.id))) throw new TRPCError({ code: "FORBIDDEN" });
      if (!(orders ?? []).some(row => row.id === order.id)) throw Error("Scope omitted a parent");
    };
  });
  const ports = { database: async () => f.db, readGuard };
  const service = new PurchaseSpecificationsService(ports);
  const get = (table: string, id: number) => f.memory.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
  const snapshot = () => ["purchase_orders", "purchase_order_items", "warehouse_receipts", "warehouse_receipt_items", "inventory", "inventory_lot_balances", "inventory_transactions", "warehouse_returns"].map(table => [table, f.memory.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]);
  return { ...f, service, ports, readGuard, scope, get, snapshot };
}
