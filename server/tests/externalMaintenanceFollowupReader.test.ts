import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { TRPCError } from "@trpc/server";
import { externalMaintenanceJobs, purchaseOrders, purchaseOrderItems, poPricingBatches, purchasePackageSubmissions, users, tickets, ticketItems } from "../../drizzle/schema";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
import { listExternalMaintenanceFollowup, externalMaintenanceFollowupDetail, externalDelegateFollowupMediaSources } from "../services/external-maintenance-followup";
import { externalFollowupRpcAllowed, externalFollowupListInput, externalFollowupDetailInput } from "../../shared/external-maintenance-followup";
import { businessRpcAllowed } from "../../shared/business-role-policy";
import { APP_ROLE } from "../../shared/roles";
import { assertDelegateExternalAssetKey } from "../_core/authz/external-followup-media";
import { assertMediaAccess, mediaKeyFromValue } from "../_core/authz/media-access";
import { router, protectedProcedure } from "../_core/trpc";

let f: ReturnType<typeof purchaseSpecificationsDatabase>, database: { execute(query: SQL): Promise<any> }, unified = false;
const actor = (role = "warehouse", id = 1) => ({ id, role, isActive: 1 });
function columns(table: any) {
  const name = getTableName(table), old = f.memory.prepare(`PRAGMA table_info(${name})`).all() as any[];
  const fields = Object.values(getTableColumns(table)) as any[];
  const definition = (field: any) => `\`${field.name}\` ${field.name === "id" ? "INTEGER PRIMARY KEY" : field.dataType === "number" ? "NUMERIC" : "TEXT"}`;
  if (!old.length) f.memory.exec(`CREATE TABLE ${name} (${fields.map(definition).join(",")})`);
  else for (const field of fields) if (!old.some(value => value.name === field.name)) f.memory.exec(`ALTER TABLE ${name} ADD COLUMN ${definition(field)}`);
}
function seed(n = 0) {
  const base = n * 1000;
  f.insert("tickets", { id: 100 + base, ticketNumber: `MT-${n}`, title: "Fault", description: "Fault detail", maintenancePath: "C" });
  f.insert("ticket_items", { id: 101 + base, ticketId: 100 + base, maintenancePath: "C", description: "Item fault" });
  f.insert("purchase_orders", { id: 200 + base, poNumber: `PR-${n}`, status: "approved", requestedById: 1, ticketId: 100 + base, ticketItemId: 101 + base });
  f.insert("purchase_order_items", { id: 201 + base, purchaseOrderId: 200 + base, itemName: "Maintenance", delegateId: 2, status: "approved", batchId: 400 + base });
  f.insert("po_pricing_batches", { id: 400 + base, purchaseOrderId: 200 + base, status: "approved", accountingApprovedById: 11,
    accountingApprovedAt: "2026-11-04 09:00:00", managementApprovedById: 4, managementApprovedAt: "2026-11-04 10:00:00" });
  f.insert("external_maintenance_jobs", { id: 300 + base, purchaseOrderId: 200 + base, ticketId: 100 + base, ticketItemId: 101 + base,
    delegateId: 2, status: "purchase_cycle", purchaseTitle: "عنوان المستودع", assetName: "الأصل", assetBeforeCondition: "لا يعمل", warehouseNotes: "حافظ عليه",
    assetBeforePhotoUrl: `cmms/before-${n}.jpg`, assetAfterReturnPhotoUrl: `cmms/after-${n}.jpg`, gateExitApprovedAt: "2026-11-04 08:00:00", updatedAt: "2026-11-04 10:00:00",
    workshopName: "Workshop", workshopPhone: "0501234567", expectedReturnDate: "2026-11-10", workshopLocationUrl: "https://maps.example/workshop", workshopNotes: "اتصل قبل العودة" });
}
function bundle() {
  f.insert("delegate_pricing_bundles", { id: 500, delegateId: 2, status: "archived" });
  f.insert("delegate_pricing_bundle_items", { bundleId: 500, purchaseOrderItemId: 201 });
  f.insert("delegate_pricing_bundle_batches", { bundleId: 500, purchaseOrderId: 200, pricingBatchId: 400 });
  if (unified) f.insert("delegate_pricing_bundle_approvals", { bundleId: 500, status: "approved", accountingApprovedById: 11,
    accountingApprovedAt: "2026-11-04 09:00:00", managementApprovedById: 4, managementApprovedAt: "2026-11-04 10:00:00", accountingRejections: "[]", managementRejections: "[]" });
}
beforeEach(() => {
  unified = false; f = purchaseSpecificationsDatabase();
  for (const table of [users, tickets, ticketItems, purchaseOrders, purchaseOrderItems, poPricingBatches, purchasePackageSubmissions, externalMaintenanceJobs]) columns(table);
  f.memory.exec(`CREATE TABLE delegate_pricing_bundles(id INTEGER PRIMARY KEY,delegateId INTEGER,status TEXT);
    CREATE TABLE delegate_pricing_bundle_items(bundleId INTEGER,purchaseOrderItemId INTEGER,removedAt TEXT);
    CREATE TABLE delegate_pricing_bundle_batches(bundleId INTEGER,purchaseOrderId INTEGER,pricingBatchId INTEGER,purchasePackageSubmissionId INTEGER);
    CREATE TABLE delegate_pricing_bundle_approvals(bundleId INTEGER PRIMARY KEY,status TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,accountingRejections TEXT,managementRejections TEXT);`);
  f.memory.function("JSON_CONTAINS", (value: string, subset: string) => {
    const array = JSON.parse(value), candidate = JSON.parse(subset);
    return Array.isArray(array) && array.some(item => Object.entries(candidate).every(([key, field]) => item[key] === field)) ? 1 : 0;
  });
  const dialect = new MySqlDialect();
  database = { execute: async query => {
    const compiled = dialect.sqlToQuery(query);
    if (compiled.sql.includes("information_schema.TABLES")) { f.queries.push(compiled); return [unified ? [{ TABLE_NAME: "delegate_pricing_bundle_approvals" }] : [], []]; }
    if (!/^\s*SELECT/i.test(compiled.sql)) throw Error("Followup reads may not write");
    return f.db.execute(query);
  } };
  for (const [id, role] of [[1, "warehouse"], [2, "delegate"], [3, "delegate_manager"], [4, "senior_management"], [5, "maintenance_manager"], [6, "construction_procurement_manager"], [7, "admin"], [8, "owner"], [9, "general_maintenance_manager"], [10, "delegate"], [11, "accountant"]] as const)
    f.insert("users", { id, role, isActive: 1, name: `Name ${id}` });
  seed(); f.queries.length = 0;
});
afterEach(() => { f.close(); vi.restoreAllMocks(); });
const list = (user = actor(), view: "active" | "all" | "received" = "active") => listExternalMaintenanceFollowup(database, user, { view, page: 1, pageSize: 24 });
const detail = (user = actor(), jobId = 300) => externalMaintenanceFollowupDetail(database, user, { jobId });

describe("External followup uses actual source approval and bounded read scope", () => {
  it.each([["warehouse", 1], ["delegate", 2], ["senior_management", 4], ["maintenance_manager", 5], ["construction_procurement_manager", 6], ["admin", 7], ["owner", 8], ["general_maintenance_manager", 9]])("allows the existing/narrow %s read only after final approval", async (role, id) => {
    expect((await list(actor(String(role), Number(id)))).rows).toHaveLength(1);
    expect(await detail(actor(String(role), Number(id)))).toMatchObject({ jobId: 300, workshopName: "Workshop", gateExitApprovedAt: "2026-11-04 08:00:00", ticketDescription: "Item fault" });
  });
  it("keeps delegate-manager scope equal to the current assigned delegate", async () => {
    f.memory.exec("UPDATE users SET role='delegate_manager' WHERE id=2");
    expect((await list(actor("delegate_manager", 2))).rows).toHaveLength(1);
    expect((await list(actor("delegate_manager", 3))).rows).toEqual([]);
    await expect(detail(actor("delegate_manager", 3))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it.each(["user", "accountant", "executive_director", "technician", "it_manager", "it_member", "operator", "observer", "gate_security", "purchase_manager", "purchase_requester"])("denies %s directly without a capability leak", async role => {
    await expect(list(actor(role))).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.queries).toHaveLength(0);
  });
  it.each([
    "UPDATE users SET isActive=0 WHERE id=1", "UPDATE users SET role='delegate' WHERE id=1",
    "DELETE FROM users WHERE id=1",
  ])("rechecks the actual active identity: %s", async mutation => {
    f.memory.exec(mutation); await expect(list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([
    "UPDATE po_pricing_batches SET status='pending_management'", "UPDATE po_pricing_batches SET managementApprovedAt=NULL",
    "UPDATE po_pricing_batches SET accountingApprovedById=NULL", "DELETE FROM po_pricing_batches",
    "UPDATE purchase_order_items SET status='rejected'", "UPDATE purchase_order_items SET status='estimated'",
    "UPDATE purchase_order_items SET batchId=NULL", "UPDATE purchase_orders SET status='rejected'",
  ])("does not trust an approved PO header: %s", async mutation => {
    f.memory.exec(mutation); expect((await list()).rows).toEqual([]); await expect(detail()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it.each([
    "DELETE FROM tickets", "DELETE FROM ticket_items", "DELETE FROM purchase_orders", "DELETE FROM purchase_order_items",
    "UPDATE purchase_orders SET ticketId=999", "UPDATE purchase_orders SET ticketItemId=NULL",
    "UPDATE ticket_items SET ticketId=999", "UPDATE ticket_items SET maintenancePath='B'",
    "UPDATE purchase_order_items SET delegateId=10", "UPDATE external_maintenance_jobs SET gateExitApprovedAt=NULL",
  ])("denies a missing/mismatched source: %s", async mutation => {
    f.memory.exec(mutation); expect((await list()).total).toBe(0); await expect(detail()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("does not guess one approved item or asset among ambiguous sources", async () => {
    f.insert("purchase_order_items", { id: 202, purchaseOrderId: 200, delegateId: 2, status: "pending" });
    expect((await list()).total).toBe(0);
    f.memory.exec("DELETE FROM purchase_order_items WHERE id=202");
    f.insert("external_maintenance_jobs", { id: 301, purchaseOrderId: 200, ticketId: 100, ticketItemId: 101 });
    expect((await list()).total).toBe(0);
  });
  it("allows an exact legacy null-item source without inventing a title/date", async () => {
    f.memory.exec("UPDATE external_maintenance_jobs SET ticketItemId=NULL,purchaseTitle=NULL,expectedReturnDate=NULL; UPDATE purchase_orders SET ticketItemId=NULL");
    expect((await list()).rows[0]).toMatchObject({ purchaseTitle: null, expectedReturnDate: null });
  });
  it("uses gate entry and warehouse receipt independently; archives only after receipt", async () => {
    f.memory.exec("UPDATE external_maintenance_jobs SET gateEntryApprovedAt='2026-11-12 10:00:00',status='waiting_warehouse_receipt'");
    expect((await list()).rows[0]).toMatchObject({ gateEntryApprovedAt: "2026-11-12 10:00:00", warehouseReceivedAt: null });
    expect((await list(actor(), "received")).total).toBe(0);
    f.memory.exec("UPDATE external_maintenance_jobs SET warehouseReceivedAt='2026-11-13 10:00:00',status='waiting_technician_handover'");
    expect((await list()).total).toBe(0); expect((await list(actor(), "received")).total).toBe(1); expect((await list(actor(), "all")).total).toBe(1);
    expect((await detail()).warehouseReceivedAt).toBe("2026-11-13 10:00:00");
  });
  it("preserves record scope across consecutive assignment changes and requests", async () => {
    expect((await list(actor("delegate", 2))).total).toBe(1);
    f.memory.exec("UPDATE external_maintenance_jobs SET delegateId=10; UPDATE purchase_order_items SET delegateId=10");
    expect((await list(actor("delegate", 2))).total).toBe(0); expect((await list(actor("delegate", 10))).total).toBe(1);
  });
  it("filters before pagination and keeps constant query count for 1001 assets", async () => {
    for (let index = 1; index <= 1000; index++) seed(index);
    f.memory.exec("UPDATE purchase_order_items SET delegateId=10 WHERE id<>201; UPDATE external_maintenance_jobs SET delegateId=10 WHERE id<>300");
    const own = await list(actor("delegate", 2)); expect(own.total).toBe(1); expect(own.rows.map(row => row.jobId)).toEqual([300]);
    expect(f.queries).toHaveLength(4); f.queries.length = 0;
    const page = await listExternalMaintenanceFollowup(database, actor(), { view: "all", page: 2, pageSize: 100 });
    expect(page.total).toBe(1001); expect(page.rows).toHaveLength(100); expect(f.queries).toHaveLength(4);
  });
  it("propagates infrastructure errors rather than returning an empty allowed list", async () => {
    const failure = { execute: async () => { throw Error("unavailable"); } };
    await expect(listExternalMaintenanceFollowup(failure, actor(), { view: "active" })).rejects.toThrow("unavailable");
  });
});

describe.each([false, true])("Legacy/unified source approval (unified=%s)", mode => {
  beforeEach(() => { unified = mode; bundle(); });
  it("reads the actual completed bundle rather than a rollout flag", async () => {
    expect((await list()).total).toBe(1);
    if (mode) { f.memory.exec("UPDATE delegate_pricing_bundle_approvals SET status='pending_management'"); expect((await list()).total).toBe(0); }
  });
  it.each(["DELETE FROM delegate_pricing_bundle_items", "UPDATE delegate_pricing_bundle_items SET removedAt='2026-11-04'", "UPDATE delegate_pricing_bundle_batches SET pricingBatchId=999", "UPDATE delegate_pricing_bundles SET status='draft'"])("denies malformed bundle/source membership: %s", async mutation => {
    f.memory.exec(mutation); expect((await list()).total).toBe(0);
  });
  it("requires package submission approval and exact package links", async () => {
    f.insert("purchase_package_submissions", { id: 600, purchasePackageId: 700, status: "approved", accountingApprovedById: 11, accountingApprovedAt: "a", managementApprovedById: 4, managementApprovedAt: "b" });
    f.memory.exec("UPDATE po_pricing_batches SET purchasePackageSubmissionId=600; UPDATE purchase_orders SET packageId=700; UPDATE delegate_pricing_bundle_batches SET purchasePackageSubmissionId=600");
    expect((await list()).total).toBe(1);
    f.memory.exec("UPDATE purchase_package_submissions SET managementApprovedAt=NULL"); expect((await list()).total).toBe(0);
  });
  it("refuses item rejection JSON even if a stale item/batch still appears approved", async () => {
    if (!mode) return;
    f.memory.exec(`UPDATE delegate_pricing_bundle_approvals SET accountingRejections='[{"itemId":201,"reason":"Rejected"}]'`);
    expect((await list()).total).toBe(0);
  });
});

describe("Exact asset image keys and central read grants", () => {
  const references = [{ id: 300, parentId: 100 }], key = "cmms/before-0.jpg";
  const port = () => ({ database: async () => database, prepurchase: async () => new Map([[300, { id: 300, ticketId: 100, purchaseOrderId: 200 } as any]]) });
  it("allows current own before/after asset pictures and refuses arbitrary report/PDF keys", async () => {
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), references, key, mediaKeyFromValue, port())).resolves.toBeUndefined();
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), references, "cmms/after-0.jpg", mediaKeyFromValue, port())).resolves.toBeUndefined();
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), references, "cmms/workshop-report.pdf", mediaKeyFromValue, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps own before photo readable for pricing, but not unapproved return images", async () => {
    f.memory.exec("UPDATE purchase_order_items SET status='pending',batchId=NULL");
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), references, key, mediaKeyFromValue, port())).resolves.toBeUndefined();
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), references, "cmms/after-0.jpg", mediaKeyFromValue, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("preserves the actual own workshop report after approval without granting foreign or unrelated PDFs", async () => {
    f.memory.exec("UPDATE external_maintenance_jobs SET workshopReportUrl='cmms/own-workshop-report.pdf'");
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), references, "cmms/own-workshop-report.pdf", mediaKeyFromValue, port())).resolves.toBeUndefined();
    await expect(assertDelegateExternalAssetKey(actor("delegate", 10), references, "cmms/own-workshop-report.pdf", mediaKeyFromValue, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE po_pricing_batches SET managementApprovedAt=NULL");
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), references, "cmms/own-workshop-report.pdf", mediaKeyFromValue, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("freshly denies a foreign/reassigned/inactive actor and mismatched photo parent", async () => {
    await expect(assertDelegateExternalAssetKey(actor("delegate", 10), references, key, mediaKeyFromValue, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), [{ id: 300, parentId: 999 }], key, mediaKeyFromValue, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=2");
    await expect(assertDelegateExternalAssetKey(actor("delegate", 2), references, key, mediaKeyFromValue, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not fall back to a readable ticket/PO reference when the external reference is denied", async () => {
    const authorize = vi.fn(async (_user: any, ref: any) => { if (ref.kind === "external") throw new TRPCError({ code: "FORBIDDEN" }); });
    await expect(assertMediaAccess(actor("delegate", 10), key, { references: async () => [{ kind: "ticket", id: 100, parentId: 100 }, { kind: "external", id: 300, parentId: 100 }], authorize })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(authorize).toHaveBeenCalledTimes(1); expect(authorize.mock.calls[0][1].kind).toBe("external");
  });
  it("batch-loads 1001 distinct media sources in 500-sized chunks rather than per row", async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => index + 300);
    await externalDelegateFollowupMediaSources(database, actor("delegate", 2), [...ids, ...ids]);
    expect(f.queries).toHaveLength(5);
  });
  it("does not bypass an original financial document gate by grafting its key as a workshop report", async () => {
    const authorize = vi.fn(async (_user: any, ref: any) => { if (ref.kind === "attachment") throw new TRPCError({ code: "FORBIDDEN" }); });
    await expect(assertMediaAccess(actor("delegate", 2), key, { references: async () => [{ kind: "external", id: 300, parentId: 100 }, { kind: "attachment", id: 5, parentId: 400, entityType: "po_financial_batch" }], authorize })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(authorize).toHaveBeenCalledTimes(1); expect(authorize.mock.calls[0][1].kind).toBe("attachment");
  });
  it("has exact query-only central grants and no observer/admin projection", () => {
    for (const role of Object.values(APP_ROLE)) {
      const allowed = ["warehouse", "delegate", "delegate_manager", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "senior_management", "owner", "admin"].includes(role);
      expect(externalFollowupRpcAllowed(actor(role), "query", "externalMaintenance.listFollowup")).toBe(allowed);
      expect(externalFollowupRpcAllowed(actor(role), "mutation", "externalMaintenance.listFollowup")).toBe(false);
      if (["warehouse", "senior_management", "accountant", "executive_director"].includes(role)) expect(businessRpcAllowed(actor(role), "query", "externalMaintenance.listFollowup")).toBe(allowed);
    }
    expect(externalFollowupRpcAllowed({ ...actor(), isActive: 0 }, "query", "externalMaintenance.followupDetail")).toBe(false);
  });
  it("actual router handlers use the authenticated actor and reject forged/projected roles", async () => {
    const source = ts.createSourceFile("router.ts", readFileSync("server/routers/external-maintenance/external-maintenance.router.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const statements = source.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
    const declaration = statements.find(node => node.name.getText(source) === "externalMaintenanceRouter")!;
    const body = (declaration.initializer as ts.CallExpression).arguments[0] as ts.ObjectLiteralExpression;
    const procedure = (name: string) => {
      const property = body.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === name) as ts.PropertyAssignment;
      return vm.runInNewContext(ts.transpileModule(`(${property.initializer.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
        protectedProcedure, externalFollowupListInput, externalFollowupDetailInput, TRPCError, db: { getDb: async () => database }, listExternalMaintenanceFollowup, externalMaintenanceFollowupDetail,
      });
    };
    const api = router({ externalMaintenance: router({ listFollowup: procedure("listFollowup"), followupDetail: procedure("followupDetail") }) });
    const own = api.createCaller({ user: actor("delegate", 2) } as any);
    expect((await own.externalMaintenance.listFollowup({ view: "active" })).total).toBe(1);
    const forged = api.createCaller({ user: actor("admin", 7), authenticatedUser: actor("observer", 7) } as any);
    await expect(forged.externalMaintenance.followupDetail({ jobId: 300 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
