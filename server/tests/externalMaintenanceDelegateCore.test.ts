import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { externalMaintenanceJobs, users, tickets, ticketItems, purchaseOrders, purchaseOrderItems, ticketStatusHistory, assets } from "../../drizzle/schema";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
import { hasCurrentExternalDelegateReceipt, canWarehouseReprepareExternalAsset } from "../../shared/externalMaintenanceWorkflow";

const ports = vi.hoisted(() => ({ db: null as any, number: vi.fn() }));
vi.mock("../_core/db/client", () => ({ getDb: async () => ports.db, withTransaction: (work: any) => ports.db.transaction(work) }));
vi.mock("../_core/db/purchase", () => ({ getNextPONumber: () => ports.number() }));
import { prepareExternalMaintenanceJob, decideExternalMaintenanceDelegateReceipt, approveExternalMaintenanceGateExit,
  listExternalMaintenanceJobsForDelegate, listPathCTicketsWaitingWarehousePreparation } from "../_core/db/external-maintenance";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const preparation = { ticketId: 10, ticketItemId: 11, purchaseTitle: "إصلاح محرك النافورة", assetName: "المحرك الأصلي",
  assetBeforePhotoUrl: "/photo.jpg", assetBeforeCondition: "لا يعمل", delegateId: 2, warehousePreparedById: 1, warehouseNotes: "يراجع المندوب المواصفات" };
const jobRow = (id: number) => f.memory.prepare("SELECT * FROM external_maintenance_jobs WHERE id=?").get(id) as any;
const count = (table: string) => Number((f.memory.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count);
const decide = (jobId: number, decision: "accept" | "reject" = "accept", expectedRevision = 1, delegateId = 2, reason?: string) =>
  decideExternalMaintenanceDelegateReceipt({ jobId, expectedRevision, decision, delegateId, reason });
const exit = (jobId: number) => approveExternalMaintenanceGateExit({ jobId, gateUserId: 3, carrierName: "المندوب" });

function addColumns(table: any) {
  const name = getTableName(table), existing = f.memory.prepare(`PRAGMA table_info(${name})`).all() as any[];
  const columns = Object.values(getTableColumns(table)) as any[];
  const definition = (column: any) => `\`${column.name}\` ${column.name === "id" ? "INTEGER PRIMARY KEY" : column.dataType === "number" ? "NUMERIC" : "TEXT"}${column.name === "preparationRevision" ? " DEFAULT 0" : ""}`;
  if (!existing.length) f.memory.exec(`CREATE TABLE ${name}(${columns.map(definition).join(",")})`);
  else for (const column of columns) if (!existing.some(value => value.name === column.name)) f.memory.exec(`ALTER TABLE ${name} ADD COLUMN ${definition(column)}`);
}

beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  for (const table of [users, tickets, ticketItems, purchaseOrders, purchaseOrderItems, ticketStatusHistory, assets, externalMaintenanceJobs]) addColumns(table);
  f.memory.exec("CREATE UNIQUE INDEX external_item_once ON external_maintenance_jobs(ticketItemId)");
  // Actual MySQL Drizzle selects/updates run over disposable SQLite; no pool,
  // credentials, environment file or application database client is loaded.
  const driver = { query: async (config: string | { sql: string }, params: any[] = []) => {
    const statement = typeof config === "string" ? config : config.sql;
    const executable = statement.replace(/\s+FOR UPDATE\b/gi, "").replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP").replace(/\bdefault\b/gi, "NULL");
    const values = params.map(value => value instanceof Date ? value.toISOString().slice(0, 19).replace("T", " ") : value);
    f.queries.push({ sql: statement, params: values });
    const prepared = f.memory.prepare(executable);
    if (/^\s*SELECT/i.test(executable)) { prepared.setReturnArrays(true); return [prepared.all(...values), []]; }
    const result = prepared.run(...values);
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }, []];
  } };
  const database: any = drizzle({ client: driver as any });
  database.transaction = (work: any) => f.db.transaction(() => work(database));
  ports.db = database;
  ports.number.mockReset().mockResolvedValue("PR-2026-9999");
  for (const [id, role] of [[1, "warehouse"], [2, "delegate"], [3, "gate_security"], [4, "delegate"], [5, "admin"], [6, "owner"]])
    f.insert("users", { id, role, isActive: 1, name: `User ${id}` });
  f.insert("tickets", { id: 10, ticketNumber: "MT-CORE", title: "العطل", description: "تفاصيل البلاغ", maintenancePath: "C", status: "work_approved" });
  f.insert("ticket_items", { id: 11, ticketId: 10, itemNumber: 1, maintenancePath: "C", status: "work_approved", description: "المواصفات" });
});
afterEach(() => { ports.db = null; f.close(); });

describe("External asset delegate receipt uses the same guarded preparation and gate transaction", () => {
  it("gives the assigned delegate manager the same receipt and purchase ownership without allowing a foreign delegate",async()=>{
    f.memory.exec("UPDATE users SET role='delegate_manager' WHERE id=2");
    const prepared=await prepareExternalMaintenanceJob(preparation);
    await expect(decide(prepared.jobId,"accept",1,4)).rejects.toThrow("FORBIDDEN");
    await decide(prepared.jobId,"accept",1,2);
    const result=await exit(prepared.jobId);
    expect(result.job.delegateId).toBe(2);
    expect(f.memory.prepare("SELECT delegateId FROM purchase_order_items").all()).toEqual([expect.objectContaining({delegateId:2})]);
  });
  it("prepares a separate mandatory purchase title, then requires actual delegate receipt before creating one exact-title purchase item", async () => {
    const prepared = await prepareExternalMaintenanceJob(preparation);
    expect(jobRow(prepared.jobId)).toMatchObject({ status: "waiting_delegate_receipt", purchaseTitle: preparation.purchaseTitle, assetName: preparation.assetName,
      delegateReceiptStatus: "pending", preparationRevision: 1, delegateReceiptById: null });
    await expect(exit(prepared.jobId)).rejects.toThrow();
    expect(ports.number).not.toHaveBeenCalled(); expect(count("purchase_orders")).toBe(0);
    await decide(prepared.jobId);
    expect(hasCurrentExternalDelegateReceipt(jobRow(prepared.jobId))).toBe(true);
    const created = await exit(prepared.jobId);
    expect(jobRow(prepared.jobId)).toMatchObject({ status: "purchase_cycle", purchaseOrderId: created.purchaseOrderId, delegateReceiptById: 2 });
    expect(f.memory.prepare("SELECT itemName,delegateId,unit FROM purchase_order_items").all()).toEqual([{ itemName: preparation.purchaseTitle, delegateId: 2, unit: "خدمة" }]);
    expect(f.memory.prepare("SELECT ticketId,ticketItemId,status FROM purchase_orders").all()).toEqual([{ ticketId: 10, ticketItemId: 11, status: "pending_estimate" }]);
    expect(ports.number).toHaveBeenCalledTimes(1);
    await expect(exit(prepared.jobId)).rejects.toThrow();
    expect(ports.number).toHaveBeenCalledTimes(1); expect(count("purchase_orders")).toBe(1);
  });

  it.each(["", "   ", "x".repeat(301)])("rejects invalid purchase title %j without saving a preparation", async purchaseTitle => {
    await expect(prepareExternalMaintenanceJob({ ...preparation, purchaseTitle })).rejects.toThrow("EXTERNAL_PURCHASE_TITLE_REQUIRED");
    expect(count("external_maintenance_jobs")).toBe(0); expect(count("audit_logs")).toBe(0);
  });

  it("keeps the same job and document after rejection, audits the reason before reassigning and invalidates the previous delegate/revision", async () => {
    const first = await prepareExternalMaintenanceJob(preparation);
    await expect(decide(first.jobId, "reject", 1, 2, " ")).rejects.toThrow("REASON_REQUIRED");
    await decide(first.jobId, "reject", 1, 2, "الأصل لم يُسلّم لي");
    expect(jobRow(first.jobId)).toMatchObject({ status: "waiting_warehouse_preparation", delegateReceiptStatus: "rejected", delegateReceiptReason: "الأصل لم يُسلّم لي" });
    const second = await prepareExternalMaintenanceJob({ ...preparation, jobId: first.jobId, expectedRevision: 1, delegateId: 4, purchaseTitle: "تغيير المحرك" });
    expect(second).toMatchObject({ jobId: first.jobId, exitDocumentNumber: first.exitDocumentNumber, preparationRevision: 2 });
    expect(count("external_maintenance_jobs")).toBe(1);
    expect(jobRow(first.jobId)).toMatchObject({ delegateId: 4, delegateReceiptStatus: "pending", delegateReceiptReason: null, delegateReceiptById: null, delegateReceiptAt: null });
    const audits = f.memory.prepare("SELECT oldValues FROM audit_logs WHERE action='external_preparation_revised'").all() as any[];
    expect(JSON.parse(audits[0].oldValues)).toMatchObject({ delegateId: 2, delegateReceiptReason: "الأصل لم يُسلّم لي", preparationRevision: 1 });
    await expect(decide(first.jobId, "accept", 1, 2)).rejects.toThrow();
    await expect(decide(first.jobId, "accept", 1, 4)).rejects.toThrow("CONFLICT");
    await decide(first.jobId, "accept", 2, 4);
    expect((await listExternalMaintenanceJobsForDelegate(2))).toHaveLength(0);
    expect((await listExternalMaintenanceJobsForDelegate(4))[0].job.id).toBe(first.jobId);
  });

  it.each([4, 5, 6])("does not let another delegate, admin or owner %s impersonate the assigned delegate", async actorId => {
    const prepared = await prepareExternalMaintenanceJob(preparation);
    await expect(decide(prepared.jobId, "accept", 1, actorId)).rejects.toThrow();
    expect(jobRow(prepared.jobId)).toMatchObject({ status: "waiting_delegate_receipt", delegateReceiptStatus: "pending" });
  });

  it("rechecks active identity, assignment and current parent source for every decision and gate request", async () => {
    const prepared = await prepareExternalMaintenanceJob(preparation);
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=2");
    await expect(decide(prepared.jobId)).rejects.toThrow("FORBIDDEN");
    f.memory.exec("UPDATE users SET isActive=1 WHERE id=2; UPDATE ticket_items SET maintenancePath='A' WHERE id=11");
    await expect(decide(prepared.jobId)).rejects.toThrow("TICKET_INVALID");
    f.memory.exec("UPDATE ticket_items SET maintenancePath='C' WHERE id=11");
    await decide(prepared.jobId);
    f.memory.exec("UPDATE ticket_items SET ticketId=99 WHERE id=11");
    await expect(exit(prepared.jobId)).rejects.toThrow("TICKET_INVALID");
    expect(ports.number).not.toHaveBeenCalled();
  });

  it("rejects duplicate initial preparation and repeated/stale decisions without creating another job", async () => {
    const prepared = await prepareExternalMaintenanceJob(preparation);
    await expect(prepareExternalMaintenanceJob(preparation)).rejects.toThrow("EXTERNAL_JOB_EXISTS");
    const decisions = await Promise.allSettled([decide(prepared.jobId), decide(prepared.jobId)]);
    expect(decisions.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(count("external_maintenance_jobs")).toBe(1);
    expect(count("audit_logs")).toBe(2);
  });

  it("rolls preparation and its audit/history back together when audit persistence fails", async () => {
    f.memory.exec("CREATE TRIGGER fail_external_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
    await expect(prepareExternalMaintenanceJob(preparation)).rejects.toThrow();
    expect(count("external_maintenance_jobs")).toBe(0); expect(count("ticket_status_history")).toBe(0);
  });

  it("rolls a delegate rejection back with its audit/history when either persistence fails", async () => {
    const prepared = await prepareExternalMaintenanceJob(preparation);
    f.memory.exec("CREATE TRIGGER fail_external_history BEFORE INSERT ON ticket_status_history BEGIN SELECT RAISE(ABORT,'history unavailable'); END");
    await expect(decide(prepared.jobId, "reject", 1, 2, "لم أستلم")).rejects.toThrow();
    expect(jobRow(prepared.jobId)).toMatchObject({ status: "waiting_delegate_receipt", delegateReceiptStatus: "pending", delegateReceiptReason: null });
    expect(count("audit_logs")).toBe(1);
  });

  it.each(["title", "actor", "time", "revision"])("blocks gate bypass through a forged or stale accepted %s", async kind => {
    const prepared = await prepareExternalMaintenanceJob(preparation); await decide(prepared.jobId);
    if (kind === "title") f.memory.exec("UPDATE external_maintenance_jobs SET purchaseTitle=NULL");
    if (kind === "actor") f.memory.exec("UPDATE external_maintenance_jobs SET delegateReceiptById=4");
    if (kind === "time") f.memory.exec("UPDATE external_maintenance_jobs SET delegateReceiptAt='2000-01-01 00:00:00'");
    if (kind === "revision") f.memory.exec("UPDATE external_maintenance_jobs SET preparationRevision=0");
    await expect(exit(prepared.jobId)).rejects.toThrow("RECEIPT_REQUIRED");
    expect(ports.number).not.toHaveBeenCalled(); expect(count("purchase_orders")).toBe(0);
  });

  it("serializes concurrent initial preparation and gate approvals into one job and one linked purchase order", async () => {
    const attempts = await Promise.allSettled([prepareExternalMaintenanceJob(preparation), prepareExternalMaintenanceJob(preparation)]);
    expect(attempts.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    const prepared = (attempts[0] as PromiseFulfilledResult<any>).value;
    await decide(prepared.jobId);
    const approvals = await Promise.allSettled([exit(prepared.jobId), exit(prepared.jobId)]);
    expect(approvals.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    expect(ports.number).toHaveBeenCalledTimes(1);
    expect(count("external_maintenance_jobs")).toBe(1); expect(count("purchase_orders")).toBe(1); expect(count("purchase_order_items")).toBe(1);
  });

  it("rolls the whole gate transition back if its single purchase item cannot be persisted", async () => {
    const prepared = await prepareExternalMaintenanceJob(preparation); await decide(prepared.jobId);
    f.memory.exec("CREATE TRIGGER fail_external_po_item BEFORE INSERT ON purchase_order_items BEGIN SELECT RAISE(ABORT,'item unavailable'); END");
    await expect(exit(prepared.jobId)).rejects.toThrow();
    expect(count("purchase_orders")).toBe(0); expect(count("purchase_order_items")).toBe(0);
    expect(jobRow(prepared.jobId)).toMatchObject({ status: "waiting_gate_exit", purchaseOrderId: null, delegateReceiptStatus: "accepted", gateExitApprovedAt: null });
    f.memory.exec("DROP TRIGGER fail_external_po_item");
    await exit(prepared.jobId);
    expect(count("purchase_orders")).toBe(1); expect(count("purchase_order_items")).toBe(1);
  });

  it("preserves the independent second ticket item and does not replace the first item's ticket status", async () => {
    f.insert("ticket_items", { id: 12, ticketId: 10, itemNumber: 2, maintenancePath: "C", status: "work_approved", description: "  عطل المحرك في البند الثاني  " });
    const prepared = await prepareExternalMaintenanceJob({ ...preparation, ticketItemId: 12 });
    expect((await listExternalMaintenanceJobsForDelegate(2))[0].ticketDescription).toBe("  عطل المحرك في البند الثاني  ");
    await decide(prepared.jobId); await exit(prepared.jobId);
    expect(f.memory.prepare("SELECT status FROM tickets WHERE id=10").get()).toEqual({ status: "work_approved" });
    expect(f.memory.prepare("SELECT status FROM ticket_items WHERE id=11").get()).toEqual({ status: "work_approved" });
    expect(f.memory.prepare("SELECT status FROM ticket_items WHERE id=12").get()).toEqual({ status: "out_for_repair" });
  });

  it("keeps rejected and accepted pre-gate cards in the assigned delegate list, and drops a post-gate job", async () => {
    const prepared = await prepareExternalMaintenanceJob(preparation);
    await decide(prepared.jobId, "reject", 1, 2, "لم أستلم");
    expect((await listExternalMaintenanceJobsForDelegate(2))[0].job.status).toBe("waiting_warehouse_preparation");
    await prepareExternalMaintenanceJob({ ...preparation, jobId: prepared.jobId, expectedRevision: 1 });
    await decide(prepared.jobId, "accept", 2);
    expect((await listExternalMaintenanceJobsForDelegate(2))[0].job.status).toBe("waiting_gate_exit");
    await expect(prepareExternalMaintenanceJob({ ...preparation, jobId: prepared.jobId, expectedRevision: 2 })).rejects.toThrow("CONFLICT");
    await exit(prepared.jobId);
    expect(await listExternalMaintenanceJobsForDelegate(2)).toEqual([]);
  });

  it("reprepares a legacy NULL-item gate job explicitly while preserving its identity/document and denying duplicate creation", async () => {
    f.insert("external_maintenance_jobs", { id: 70, ticketId: 10, ticketItemId: null, status: "waiting_gate_exit", delegateId: 2, preparationRevision: 0, exitDocumentNumber: "EXT-OUT-OLD" });
    expect(await listPathCTicketsWaitingWarehousePreparation()).toEqual([]);
    await expect(prepareExternalMaintenanceJob(preparation)).rejects.toThrow("EXTERNAL_JOB_EXISTS");
    await expect(exit(70)).rejects.toThrow("RECEIPT_REQUIRED");
    expect(ports.number).not.toHaveBeenCalled();
    const revised = await prepareExternalMaintenanceJob({ ...preparation, jobId: 70, expectedRevision: 0 });
    expect(revised).toMatchObject({ jobId: 70, exitDocumentNumber: "EXT-OUT-OLD", preparationRevision: 1 });
    expect(jobRow(70).ticketItemId).toBeNull();
    await decide(70); await exit(70);
    expect(count("external_maintenance_jobs")).toBe(1);
  });

  it("loads only assigned current pre-purchase jobs with one bounded join and no cross-request permission cache", async () => {
    const prepared = await prepareExternalMaintenanceJob(preparation);
    const template = jobRow(prepared.jobId);
    for (let id = 100; id < 1100; id++) f.insert("external_maintenance_jobs", { ...template, id, ticketItemId: null, delegateId: id % 2 ? 2 : 4 });
    const before = f.queries.length;
    const rows = await listExternalMaintenanceJobsForDelegate(2);
    expect(rows).toHaveLength(501); expect(rows.every(row => Number(row.job.delegateId) === 2)).toBe(true);
    expect(rows.find(row => row.job.id === prepared.jobId)).toHaveProperty("ticketDescription", "المواصفات");
    expect(f.queries.slice(before)).toHaveLength(1);
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=2");
    expect(await listExternalMaintenanceJobsForDelegate(2)).toEqual([]);
    expect(f.queries.slice(before)).toHaveLength(2);
    f.memory.exec("UPDATE users SET isActive=1 WHERE id=2; UPDATE tickets SET maintenancePath='A' WHERE id=10");
    const itemOnly = await listExternalMaintenanceJobsForDelegate(2);
    expect(itemOnly.map(row => row.job.id)).toEqual([prepared.jobId]);
    f.memory.exec("DELETE FROM ticket_items WHERE id=11");
    expect(await listExternalMaintenanceJobsForDelegate(2)).toEqual([]);
  });
});
