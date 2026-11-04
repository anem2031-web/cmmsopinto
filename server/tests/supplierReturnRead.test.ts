import { it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { listInput, listSupplierReturns, supplierReturnStatus, runTrialCommand } from "../supplier-return-followup/runtime";
import { businessRpcAllowed } from "../../shared/business-role-policy";

function fixture(role = "delegate") {
  let active = true; let databaseName = "copycmms2"; let data: any[] = [{ id: 1, delegateId: 10 }];
  const queries: { sql: string; params: any[] }[] = [];
  const tx = { async execute(query: any) {
    const q = new MySqlDialect().sqlToQuery(query); queries.push(q);
    if (q.sql.startsWith("SELECT id,role,isActive")) return [[{ id: 10, role, isActive: active ? 1 : 0 }]];
    if (q.sql.startsWith("SELECT DATABASE")) return [[{ databaseName }]];
    if (q.sql.startsWith("SELECT COUNT")) return [[{ total: 1000 }]];
    return [data];
  } };
  return { tx, queries, inactive: () => { active = false; }, database: (name: string) => { databaseName = name; }, data: (rows: any[]) => { data = rows; } };
}
const actor = { id: 10, role: "delegate" };
it("rechecks the production switch and identity on independent requests", async () => {
  const f = fixture(); f.database("cmms");
  try {
    vi.stubEnv("SUPPLIER_RETURN_FOLLOWUP_ENABLED", "true");
    expect(await supplierReturnStatus(actor, f.tx)).toEqual({ enabled: true });
    await listSupplierReturns(actor, {}, f.tx);
    vi.stubEnv("SUPPLIER_RETURN_FOLLOWUP_ENABLED", "false");
    await expect(listSupplierReturns(actor, {}, f.tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.stubEnv("SUPPLIER_RETURN_FOLLOWUP_ENABLED", "true");
    f.inactive();
    await expect(listSupplierReturns(actor, {}, f.tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally { vi.unstubAllEnvs(); }
});
it("trial is disabled on production and every write rechecks actual database", async () => {
  const f = fixture(); f.database("cmms");
  expect(await supplierReturnStatus(actor, f.tx)).toEqual({ enabled: false });
  await expect(listSupplierReturns(actor, {}, f.tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(runTrialCommand(actor, { action: "accept", caseId: 1, expectedRevision: 0, operationKey: "trial-operation-001" }, { transaction: work => work(f.tx) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.queries.some(q => /UPDATE|INSERT/.test(q.sql))).toBe(false);
});
it.each(["observer", "gate_security"])("does not grant %s return management", async role => {
  const f = fixture(role);
  await expect(listSupplierReturns({ ...actor, role }, {}, f.tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.queries).toHaveLength(0);
});
it.each(["accountant", "senior_management", "maintenance_manager", "technician", "operator", "purchase_requester"])("limits %s return reads to the original creator", async role => {
  const f = fixture(role); f.data([{ id: 1, creatorId: 10 }]);
  await listSupplierReturns({ ...actor, role }, {}, f.tx);
  expect(f.queries.some(q => q.sql.includes("COALESCE(c.creatorId,CASE") && q.sql.includes("THEN c.createdById ELSE NULL END)=?"))).toBe(true);
  f.data([{ id: 2, creatorId: 11 }]);
  await expect(listSupplierReturns({ ...actor, role }, {}, f.tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("uses four queries per page, never one authorization load per row", async () => {
  const f = fixture(); f.data(Array.from({ length: 50 }, (_, i) => ({ id: i+1, delegateId: 10 })));
  for (let page = 1; page <= 20; page++) await listSupplierReturns(actor, { page, pageSize: 50 }, f.tx);
  expect(f.queries).toHaveLength(80);
  for (const q of f.queries.filter(q => q.sql.includes("FROM supplier_return_cases"))) {
    expect(q.sql).toContain("c.delegateId=?");
    expect(q.sql).toContain("i.purchaseOrderId=p.id");
    expect(q.sql).toContain("r.purchaseOrderId <=> c.purchaseOrderId");
    expect(q.sql).toContain("p.id IS NOT NULL");
  }
  expect(f.queries.at(-1)?.params.slice(-2)).toEqual([50, 950]);
});
it("mixed foreign rows fail independently and identity is fresh", async () => {
  const f = fixture();
  await listSupplierReturns(actor, {}, f.tx);
  f.data([{ id: 1, delegateId: 10 }, { id: 2, delegateId: 11 }]);
  await expect(listSupplierReturns(actor, {}, f.tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  f.inactive();
  await expect(listSupplierReturns(actor, {}, f.tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("rejects oversized pagination and propagates infrastructure errors", async () => {
  expect(() => listInput.parse({ pageSize: 501 })).toThrow();
  await expect(listSupplierReturns(actor, {}, { execute: async () => { throw Error("database down"); } })).rejects.toThrow("database down");
});
it("central capabilities separate creator reads from warehouse-only reads", () => {
  for (const path of ["supplierReturns.status", "supplierReturns.list"]) {
    expect(businessRpcAllowed({ id: 10, role: "warehouse", isActive: 1 }, "query", path)).toBe(true);
    expect(businessRpcAllowed({ id: 10, role: "accountant", isActive: 1 }, "query", path)).toBe(true);
  }
  for (const path of ["supplierReturns.delegates", "supplierReturns.valuePreview"]) {
    expect(businessRpcAllowed({ id: 10, role: "warehouse", isActive: 1 }, "query", path)).toBe(true);
    expect(businessRpcAllowed({ id: 10, role: "accountant", isActive: 1 }, "query", path)).toBe(false);
  }
});
