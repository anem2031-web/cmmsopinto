import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
import { createWarehouseRequestDocumentService } from "../services/warehouse-request-documents";
import { createWarehouseRequestDocumentsRouter } from "../routers/inventory/warehouse-request-documents.router";
import { router } from "../_core/trpc";
import { APP_ROLE } from "../../shared/roles";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
let service: ReturnType<typeof createWarehouseRequestDocumentService>;
const actor = { id: 1, role: "warehouse", isActive: 1 };
const readDocument = vi.fn(), incrementPrint = vi.fn();
const page = (source: "tickets" | "pmv2" | "operational", extra = {}) => service.page(actor, { source, search: "", sort: "newest", page: 1, pageSize: 20, ...extra });
beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  for (const table of [schema.deliveryDocuments, schema.returnDocuments, schema.materialExecutionCostContexts,
    schema.pmv2Tasks, schema.pmv2TaskItems, schema.pmv2ItemActions, schema.pmv2MaterialUsages,
    schema.pmv2MaterialRequests, schema.pmv2MaterialRequestItems,
    schema.warehouseIssueBatches, schema.warehouseIssueBatchItems, schema.tickets]) {
    const name = getTableName(table), existing = f.memory.prepare(`PRAGMA table_info(${name})`).all() as any[];
    const columns = Object.values(getTableColumns(table)) as any[];
    const definition = (c: any) => `\`${c.name}\` ${c.name === "id" ? "INTEGER PRIMARY KEY" : c.dataType === "number" ? "NUMERIC" : "TEXT"}`;
    if (!existing.length) f.memory.exec(`CREATE TABLE ${name}(${columns.map(definition).join(",")})`);
    else for (const c of columns) if (!existing.some(x => x.name === c.name)) f.memory.exec(`ALTER TABLE ${name} ADD COLUMN ${definition(c)}`);
  }
  f.memory.exec(`
    ALTER TABLE warehouse_returns ADD COLUMN sourceDeliveryDocumentId INTEGER;
    CREATE TABLE operational_issue_orders(id INTEGER PRIMARY KEY,orderNumber TEXT,reason TEXT);
    CREATE TABLE operational_issue_items(id INTEGER PRIMARY KEY,orderId INTEGER);
    CREATE TABLE operational_issue_deliveries(id INTEGER PRIMARY KEY,orderItemId INTEGER,deliveryDocumentId INTEGER);
    CREATE TABLE ticket_team_assignments(id INTEGER PRIMARY KEY,ticketId INTEGER);
    CREATE TABLE ticket_team_material_needs(id INTEGER PRIMARY KEY,assignmentId INTEGER);
    CREATE TABLE ticket_team_delivery_links(id INTEGER PRIMARY KEY,needId INTEGER,deliveryDocumentId INTEGER);
  `);
  f.memory.function("CONCAT_WS", { varargs: true }, (separator: string, ...args: any[]) => args.filter(x => x != null).join(separator));
  f.memory.function("LOCATE", (term: string, text: string) => text.indexOf(term) + 1);
  f.memory.function("JSON_UNQUOTE", (value: any) => value);
  f.insert("users", actor);
  f.insert("warehouses", { id: 1, nameAr: "المخزن الرئيسي" });
  f.insert("inventory", { id: 1, warehouseId: 1 });
  f.insert("inventory_lots", { id: 1, lotCode: "LOT-1" });
  for (const id of [100, 200, 300, 400, 500]) f.insert("delivery_documents", { id, deliveryNumber: `DLV-${id}`, inventoryId: 1, lotId: 1, inventoryTransactionId: id, itemName: "مصباح", quantity: 2, unit: "حبة", deliveredByName: "أمين", deliveredToName: "فني", createdAt: `2026-11-0${id / 100} 10:00:00` });
  f.insert("operational_issue_orders", { id: 1, orderNumber: "OPR-672", reason: "تشغيل الموقع" });
  f.insert("operational_issue_items", { id: 1, orderId: 1 });
  f.insert("operational_issue_deliveries", { id: 1, orderItemId: 1, deliveryDocumentId: 100 });
  f.insert("operational_issue_items", { id: 2, orderId: 999 });
  f.insert("operational_issue_deliveries", { id: 2, orderItemId: 2, deliveryDocumentId: 500 });
  f.insert("tickets", { id: 2, ticketNumber: "MT-672", title: "إنارة الممر" });
  f.memory.exec("UPDATE delivery_documents SET ticketId=2 WHERE id=200");
  f.insert("ticket_team_assignments", { id: 2, ticketId: 2 });
  f.insert("ticket_team_material_needs", { id: 2, assignmentId: 2 });
  f.insert("ticket_team_delivery_links", { id: 2, needId: 2, deliveryDocumentId: 200 });
  f.insert("pmv2_tasks", { id: 3, taskNumber: "PM-672" });
  f.insert("pmv2_task_items", { id: 3, taskId: 3, titleSnapshot: "فحص الإنارة" });
  f.insert("pmv2_item_actions", { id: 1, taskItemId: 3, action: "material_issue_linked", note: JSON.stringify({ deliveryDocumentId: 300 }) });
  f.insert("pmv2_item_actions", { id: 2, taskItemId: 3, action: "material_issue_linked", note: "bad historical note" });
  f.insert("pmv2_material_usages", { id: 1, taskItemId: 3, deliveryDocumentId: 300 });
  f.insert("material_execution_cost_contexts", { inventoryTransactionId: 300, executionSource: "pmv2", executionId: 3, executionItemId: 3 });
  f.insert("warehouse_returns", { id: 6, sourceDeliveryDocumentId: 100 });
  f.insert("return_documents", { id: 6, returnId: 6, returnNumber: "RTN-6", itemName: "مصباح", returnedQuantity: 1, returnedByName: "فني", recipientName: "أمين", createdAt: "2026-11-06" });
  f.insert("warehouse_issue_batches", { id: 7, issueNumber: "WIS-7", itemsCount: 2, warehouseName: "الرئيسي", deliveredToName: "فني", issuedByName: "أمين", createdAt: "2026-11-07" });
  f.insert("warehouse_issue_batch_items", { id: 1, batchId: 7, deliveryDocumentId: 200, itemName: "مصباح", referenceType: "ticket" });
  f.insert("warehouse_issue_batch_items", { id: 2, batchId: 7, deliveryDocumentId: 300, itemName: "سلك", referenceType: "pmv2" });
  readDocument.mockReset().mockResolvedValue({ deliveryNumber: "DLV-100" }); incrementPrint.mockReset().mockResolvedValue(1);
  service = createWarehouseRequestDocumentService({ database: async () => f.db, readDocument, incrementPrint });
});
afterEach(() => f.close());

describe("existing warehouse documents grouped by actual issue source", () => {
  it("deduplicates modern, action and usage references and keeps source lists independent", async () => {
    expect((await page("operational")).rows.map(x => x.number)).toEqual(["RTN-6", "DLV-100"]);
    expect((await page("tickets")).rows.map(x => x.number)).toEqual(["WIS-7", "DLV-200"]);
    expect((await page("pmv2")).rows.map(x => x.number)).toEqual(["WIS-7", "DLV-300"]);
    expect((await page("pmv2")).rows.find(x => x.kind === "warehouse_issue")?.mixedSources).toBe(1);
    expect((await page("pmv2")).rows.find(x => x.kind === "delivery")).toMatchObject({ referenceNumber: "PM-672", warehouseName: "المخزن الرئيسي", lotCode: "LOT-1" });
    expect((await page("operational")).rows.some(x => x.id === 400 || x.id === 500)).toBe(false);
  });
  it("includes PMV2 before any consumption is declared, including a pending link", async () => {
    f.memory.exec("DELETE FROM pmv2_material_usages; DELETE FROM material_execution_cost_contexts; UPDATE pmv2_item_actions SET action='material_issue_link_pending' WHERE id=1");
    expect((await page("pmv2")).rows.some(x => x.number === "DLV-300")).toBe(true);
  });
  it("searches references, text, recipient and Arabic digits before pagination and supports oldest", async () => {
    expect((await page("tickets", { search: "٦٧٢", pageSize: 1 })).total).toBe(2);
    expect((await page("tickets", { search: "إنارة", sort: "oldest", pageSize: 1 })).rows[0].number).toBe("DLV-200");
    expect((await page("tickets", { search: "فني" })).total).toBe(2);
    expect((await page("tickets", { search: "%" })).total).toBe(0);
    expect((await page("tickets", { search: "DLV-200" })).total).toBe(1);
    expect((await page("tickets", { search: "سلك" })).rows.map(x => x.number)).toEqual(["WIS-7"]);
  });
  it("denies foreign source IDs, missing parents and incomplete aggregate members", async () => {
    await expect(service.detail(actor, { source: "tickets", kind: "delivery", id: 100 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.memory.exec("DELETE FROM pmv2_tasks WHERE id=3");
    expect((await page("pmv2")).total).toBe(0);
    f.memory.exec("DELETE FROM delivery_documents WHERE id=300");
    expect((await page("tickets")).rows.map(x => x.number)).toEqual(["DLV-200"]);
    expect(readDocument).not.toHaveBeenCalled();
  });
  it("does not cache permission or list state for detail or print", async () => {
    await page("operational");
    await service.detail(actor, { source: "operational", kind: "delivery", id: 100 });
    f.memory.exec("DELETE FROM operational_issue_orders WHERE id=1");
    await expect(service.recordPrint(actor, { source: "operational", kind: "delivery", id: 100 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(incrementPrint).not.toHaveBeenCalled();
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=1");
    await expect(page("tickets")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rechecks a role change before detail and rejects inactive or anonymous direct requests", async () => {
    await page("tickets");
    f.memory.exec("UPDATE users SET role='technician' WHERE id=1");
    await expect(service.detail(actor, { source: "tickets", kind: "delivery", id: 200 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const api = router({ warehouseRequestDocuments: createWarehouseRequestDocumentsRouter(service) });
    await expect(api.createCaller({ user: null, req: {}, res: {} } as any).warehouseRequestDocuments.list({ source: "tickets" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.createCaller({ user: { ...actor, isActive: 0 }, req: {}, res: {} } as any).warehouseRequestDocuments.list({ source: "tickets" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(readDocument).not.toHaveBeenCalled();
  });
  it("has constant query count with a large list and repeated parents, and bounds the page", async () => {
    for (let id = 1000; id < 2050; id++) f.insert("delivery_documents", { id, ticketId: 2, deliveryNumber: `DLV-${id}`, itemName: "مصباح", createdAt: "2026-11-07" });
    f.queries.length = 0;
    const result = await page("tickets", { pageSize: 50 });
    expect(result.total).toBe(1052); expect(result.rows).toHaveLength(50); expect(f.queries).toHaveLength(3);
    expect(readDocument).not.toHaveBeenCalled();
  });
  it("propagates infrastructure failures instead of silently denying rows", async () => {
    const broken = createWarehouseRequestDocumentService({ database: async () => ({ execute: async () => { throw Error("unavailable"); } }), readDocument, incrementPrint });
    await expect(broken.page(actor, { source: "tickets", search: "", sort: "newest", page: 1, pageSize: 20 })).rejects.toThrow("unavailable");
  });
  it.each(Object.values(APP_ROLE))("explicitly reviews direct RPC access for %s", async role => {
    f.memory.prepare("UPDATE users SET role=? WHERE id=1").run(role);
    const api = router({ warehouseRequestDocuments: createWarehouseRequestDocumentsRouter(service) });
    const caller = api.createCaller({ user: { ...actor, role }, req: {}, res: {} } as any);
    const input = { source: "operational" as const, search: "", sort: "newest" as const, page: 1, pageSize: 20 };
    if (["warehouse", "owner", "admin"].includes(role)) {
      await expect(caller.warehouseRequestDocuments.list(input)).resolves.toMatchObject({ total: 2 });
      await expect(caller.warehouseRequestDocuments.detail({ source: "operational", kind: "delivery", id: 100 })).resolves.toMatchObject({ row: { number: "DLV-100" } });
      await caller.warehouseRequestDocuments.recordPrint({ source: "operational", kind: "delivery", id: 100 });
      expect(incrementPrint).toHaveBeenCalledWith("delivery", 100);
    } else {
      await expect(caller.warehouseRequestDocuments.list(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(readDocument).not.toHaveBeenCalled(); expect(incrementPrint).not.toHaveBeenCalled();
    }
  });
});
