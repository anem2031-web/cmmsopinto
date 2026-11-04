import { describe, it, expect } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { executeFollowupCommand, type FollowupPort, type FollowupCommand } from "../supplier-return-followup/commands";

function fixture() {
  let state: any = { active: true, source: true, catalog: true, plans: [], credits: [], record: { id: 1, returnId: 2, inventoryId: 3, purchaseOrderId: 4, purchaseOrderItemId: 5, delegateId: 10, creatorId: 12, returnedQuantity: "2.000", returnedUnit: "قطعة", revision: 0, handoverStatus: "awaiting_delegate", resolution: null, rejectionReason: null, creatorDecision: null }, events: [] };
  let serial: Promise<any> = Promise.resolve();
  const queries: string[] = [];
  let failEvent = false;
  const port: FollowupPort = { transaction(work) {
    const run = serial.then(async () => {
      const next = structuredClone(state);
      const value = await work({ async execute(query) {
        const { sql: text, params: p } = new MySqlDialect().sqlToQuery(query);
        queries.push(text);
        if (text.startsWith("SELECT id,role,isActive")) return [[{ id: p[0], role: p[0] === 20 ? "warehouse" : "delegate", isActive: next.active ? 1 : 0 }]];
        if (text.startsWith("SELECT * FROM supplier_return_cases")) return [p[0] === 1 ? [next.record] : []];
        if (text.startsWith("SELECT id,inventoryId")) return [next.source ? [{ id: 2, inventoryId: 3, purchaseOrderId: 4, purchaseOrderItemId: 5 }] : []];
        if (text.startsWith("SELECT p.id FROM purchase_orders")) return [[{ id: 4 }]];
        if (text.startsWith("SELECT actorId,requestHash")) return [next.events.filter((e: any) => e.caseId === p[0] && e.operationKey === p[1])];
        if (text.startsWith("SELECT COALESCE(i.itemName,v.itemName)")) return [[{ itemName: "مصباح", activeCatalogId: next.catalog ? 44 : null }]];
        if (text.startsWith("SELECT id FROM supplier_return_replacement_plans")) return [next.plans.length ? [{ id: 1 }] : []];
        if (text.startsWith("SELECT id FROM supplier_return_settlements")) return [next.credits.length ? [{ id: 1 }] : []];
        if (text.startsWith("INSERT INTO supplier_return_settlements")) { next.credits.push({ caseId: p[0], operationKey: p[1], amount: p[2], currency: p[3], basis: p[4] }); return [{ insertId: 1 }]; }
        if (text.startsWith("INSERT INTO supplier_return_replacement_plans")) { next.plans.push({ caseId: p[0], catalogItemId: p[1], itemName: p[2], quantity: p[3], unit: p[4] }); return [{ insertId: 1 }]; }
        if (text.startsWith("UPDATE supplier_return_cases")) {
          Object.assign(next.record, { handoverStatus: p[0], rejectionReason: p[1], resolution: p[2], creatorDecision: p[3], revision: p[4] });
          return [{ affectedRows: 1 }];
        }
        if (text.startsWith("INSERT INTO supplier_return_events")) {
          if (failEvent) throw Error("event failure");
          next.events.push({ caseId: p[0], actorId: p[1], operationKey: p[3], requestHash: p[4], result: p[10] });
          return [{ affectedRows: 1 }];
        }
        if (text.startsWith("INSERT INTO notifications")) return [{ affectedRows: 1 }];
        throw Error(`Unexpected query: ${text}`);
      } });
      state = next;
      return value;
    });
    serial = run.catch(() => {});
    return run;
  } };
  return { port, queries, state: () => state, set: (key: string, value: any) => { state[key] = value; }, fail: (value: boolean) => { failEvent = value; } };
}
const actor = { id: 10, role: "delegate" };
const accept: FollowupCommand = { caseId: 1, expectedRevision: 0, operationKey: "test-operation-001", action: "accept" };
describe("supplier return transactional commands (no environment/database)", () => {
  it("replays duplicate success without another event or stock write", async () => {
    const f = fixture();
    const a = await executeFollowupCommand(f.port, actor, accept);
    expect(await executeFollowupCommand(f.port, actor, accept)).toEqual(a);
    expect(f.state().events).toHaveLength(1);
    expect(f.queries.filter(q => /^(UPDATE|INSERT)/.test(q))).toHaveLength(2);
    expect(f.queries.some(q => /inventory_transactions|inventory_lot_balances/.test(q))).toBe(false);
  });
  it("recognizes the original invoice amount once on delegate acceptance and rolls it back with a failed event", async () => {
    const f = fixture();
    Object.assign(f.state().record, { originalPurchaseValue: "23.5000", currency: "SAR", valuationBasis: "tax_inclusive" });
    f.fail(true);
    await expect(executeFollowupCommand(f.port, actor, accept)).rejects.toThrow("event failure");
    expect(f.state().credits).toHaveLength(0);
    expect(f.state().record.handoverStatus).toBe("awaiting_delegate");
    f.fail(false);
    const result = await executeFollowupCommand(f.port, actor, accept);
    expect(f.state().credits).toEqual([{ caseId: 1, operationKey: "handover-credit:1", amount: "23.5000", currency: "SAR", basis: "tax_inclusive" }]);
    expect(await executeFollowupCommand(f.port, actor, accept)).toEqual(result);
    expect(f.state().credits).toHaveLength(1);
  });
  it("rolls back the state if event persistence fails, then permits retry", async () => {
    const f = fixture(); f.fail(true);
    await expect(executeFollowupCommand(f.port, actor, accept)).rejects.toThrow("event failure");
    expect(f.state().record.revision).toBe(0);
    f.fail(false);
    await executeFollowupCommand(f.port, actor, accept);
    expect(f.state().record.revision).toBe(1);
  });
  it("serializes two decisions at the same revision", async () => {
    const f = fixture();
    const result = await Promise.allSettled([
      executeFollowupCommand(f.port, actor, accept),
      executeFollowupCommand(f.port, actor, { ...accept, operationKey: "test-operation-002", action: "reject", reason: "لم يصل" }),
    ]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(f.state().events).toHaveLength(1);
  });
  it("rejects key reuse with different payload", async () => {
    const f = fixture(); await executeFollowupCommand(f.port, actor, accept);
    await expect(executeFollowupCommand(f.port, actor, { ...accept, action: "reject", reason: "لم يصل" })).rejects.toThrow("مفتاح العملية");
  });
  it("rechecks active status even on replay", async () => {
    const f = fixture(); await executeFollowupCommand(f.port, actor, accept); f.set("active", false);
    await expect(executeFollowupCommand(f.port, actor, accept)).rejects.toThrow("الحساب");
  });
  it("denies a different delegate", async () => {
    const f = fixture();
    await expect(executeFollowupCommand(f.port, { id: 11, role: "delegate" }, accept)).rejects.toThrow("لمندوب آخر");
    expect(f.state().events).toHaveLength(0);
  });
  it("denies missing case or source", async () => {
    const f = fixture();
    await expect(executeFollowupCommand(f.port, actor, { ...accept, caseId: 4 })).rejects.toThrow("غير متاح");
    f.set("source", false);
    await expect(executeFollowupCommand(f.port, actor, accept)).rejects.toThrow("مصدر المرتجع");
  });
  it("reject, resend, accept preserve quantity and never create a second return", async () => {
    const f = fixture();
    await executeFollowupCommand(f.port, actor, { ...accept, action: "reject", reason: "لم يصل" });
    await executeFollowupCommand(f.port, { id: 20, role: "warehouse" }, { ...accept, expectedRevision: 1, operationKey: "test-operation-002", action: "resend" });
    await executeFollowupCommand(f.port, actor, { ...accept, expectedRevision: 2, operationKey: "test-operation-003" });
    expect(f.state().record.returnedQuantity).toBe("2.000");
    expect(f.state().record.handoverStatus).toBe("accepted");
    expect(f.state().events).toHaveLength(3);
  });
  it("selects a resolution only after receipt", async () => {
    const f = fixture();
    const command = { ...accept, action: "resolve", resolution: "change_item" } as const;
    await expect(executeFollowupCommand(f.port, actor, command)).rejects.toThrow("استلام");
    await executeFollowupCommand(f.port, actor, accept);
    await executeFollowupCommand(f.port, actor, { ...command, expectedRevision: 1, operationKey: "test-operation-002" });
    expect(f.state().record.creatorDecision).toBe("pending");
  });
  it("freezes a same-item replacement plan once, in the same transaction as the resolution", async () => {
    const f = fixture();
    await executeFollowupCommand(f.port, actor, accept);
    const choice = { ...accept, action: "resolve", resolution: "same_item", expectedRevision: 1, operationKey: "test-operation-002" } as const;
    const result = await executeFollowupCommand(f.port, actor, choice);
    expect(f.state().plans).toEqual([{ caseId: 1, catalogItemId: 44, itemName: "مصباح", quantity: "2.000", unit: "قطعة" }]);
    expect(await executeFollowupCommand(f.port, actor, choice)).toEqual(result);
    expect(f.state().plans).toHaveLength(1);
  });
  it("keeps a manual original item eligible without inventing a catalog identity", async () => {
    const f = fixture(); await executeFollowupCommand(f.port, actor, accept); f.set("catalog", false);
    await executeFollowupCommand(f.port, actor, { ...accept, action: "resolve", resolution: "same_item", expectedRevision: 1, operationKey: "test-operation-002" });
    expect(f.state().plans[0].catalogItemId).toBeNull();
    expect(f.state().record.resolution).toBe("same_item");
  });
});
