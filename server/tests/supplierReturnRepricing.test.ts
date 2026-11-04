import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { returnReplacementToDelegate, returnReplacementToDelegateFromUnifiedBundle } from "../supplier-return-followup/repricing";
import { createBundleReplacementAdapter } from "../services/delegate-pricing-bundles/replacement-approval-adapter";

function fixture(stage: "accounting" | "management" = "accounting") {
  const writes: string[] = [];
  const actor = { id: 22, role: stage === "accounting" ? "accountant" : "senior_management", isActive: 1 };
  const plan: any = { id: 7, caseId: 3, purchaseOrderId: 50, purchaseOrderItemId: 70,
    creditAllocationSettlementId: 15, fundingSettlementId: stage === "management" ? 16 : null,
    delegateId: 4, itemDelegateId: 4, handoverStatus: "accepted",
    status: stage === "accounting" ? "pending_accounting" : "pending_management",
    batchStatus: stage === "accounting" ? "pending_accounting" : "pending_management",
    purchasePackageSubmissionId: null, itemBatchId: 80, itemStatus: "estimated" };
  const tx: any = { async execute(query: any) {
    const { sql: text } = new MySqlDialect().sqlToQuery(query);
    if (text.startsWith("SELECT DATABASE()")) return [[{ databaseName: "copycmms2" }]];
    if (text.startsWith("SELECT id,role,isActive FROM users")) return [[actor]];
    if (text.includes("FROM supplier_return_replacement_plans p")) return [[plan]];
    if (text.startsWith("SELECT id FROM purchase_order_items")) return [[{ id: 70 }]];
    if (text.includes("FROM supplier_return_settlements") && text.includes("credit_allocation")) return [[{ id: 15, status: stage === "accounting" ? "pending" : "accounting_approved" }]];
    if (text.includes("FROM supplier_return_settlements") && text.includes("additional_funding")) return [[{ id: 16, status: "accounting_approved" }]];
    if (/^(INSERT|UPDATE)/.test(text)) { writes.push(text); return [{ affectedRows: 1 }]; }
    throw Error(text);
  } };
  return { tx, plan, writes, actor };
}

describe("rejected replacement pricing", () => {
  it("returns the same item to the delegate and frees its pending credit", async () => {
    const f = fixture();
    expect(await returnReplacementToDelegate(f.tx, 22, "accountant", "accounting", 80, 70, "السعر غير مناسب")).toBe(true);
    expect(f.writes.some(q => q.includes("SET status='pending',batchId=NULL"))).toBe(true);
    expect(f.writes.some(q => q.includes("SET status='pending_review'"))).toBe(true);
    expect(f.writes.filter(q => q.includes("supplier_return_settlements SET status='cancelled'"))).toHaveLength(1);
  });
  it("also releases approved funding when management rejects", async () => {
    const f = fixture("management");
    expect(await returnReplacementToDelegate(f.tx, 22, "senior_management", "management", 80, 70, "يلزم إعادة التسعير")).toBe(true);
    expect(f.writes.filter(q => q.includes("supplier_return_settlements SET status='cancelled'"))).toHaveLength(2);
  });
  it("does not mutate a changed stage", async () => {
    const f = fixture(); f.plan.status = "ready_to_purchase";
    await expect(returnReplacementToDelegate(f.tx, 22, "accountant", "accounting", 80, 70, "السعر غير مناسب")).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  });
});

describe("DPB-only senior accounting rejection of replacement pricing", () => {
  function scopedFixture() {
    const f = fixture(); f.actor.role = "senior_management";
    const scope: any = { approvalStatus: "pending_accounting", bundleNumber: "DPB-24", bundleDelegateId: 4,
      delegateId: 4, submittedById: 4, batchStatus: "pending_accounting", status: "estimated", purchaseOrderId: 50,
      quantity: 1, estimatedTotalCost: "120", snapshotJson: JSON.stringify({ number: "DPB-24", delegate: { id: 4 }, rows: [{ id: 70, purchaseOrderId: 50, quantity: 1, estimatedTotalCost: "120" }] }) };
    let missing = false;
    const base = f.tx.execute.bind(f.tx);
    const proofs: any[] = [];
    f.tx.execute = async (query: any) => {
      const statement = new MySqlDialect().sqlToQuery(query);
      if (statement.sql.includes("FROM delegate_pricing_bundle_approvals a")) { proofs.push(statement); return [missing ? [] : [scope]]; }
      return base(query);
    };
    return { ...f, scope, proofs, removeMembership: () => { missing = true; } };
  }
  it("requires a locked current DPB/batch/item membership proof and keeps the actual senior actor", async () => {
    const f = scopedFixture();
    expect(await returnReplacementToDelegateFromUnifiedBundle(f.tx, 22, "senior_management", "accounting", 24, 80, 70, "سعر البديل مرتفع ويحتاج إعادة تسعير")).toBe(true);
    expect(f.proofs[0].params).toContain(24); expect(f.proofs[0].params).toContain(80); expect(f.proofs[0].params).toContain(70);
    expect(f.proofs[0].sql).toContain("m.removedAt IS NULL"); expect(f.proofs[0].sql).toContain("i.batchId=pb.id"); expect(f.proofs[0].sql).toContain("FOR UPDATE");
    expect(f.writes.some(query => query.includes("SET status='pending',batchId=NULL"))).toBe(true);
  });
  it("does not widen the old generic replacement rejection even if an extra grant argument is forged", async () => {
    const f = scopedFixture();
    await expect((returnReplacementToDelegate as any)(f.tx, 22, "senior_management", "accounting", 80, 70, "سعر البديل مرتفع ويحتاج مراجعة", { unifiedBundleId: 24, verified: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.proofs).toHaveLength(0); expect(f.writes).toHaveLength(0);
  });
  it("the production DPB adapter forwards the explicit bundle scope to the real rejection writer", async () => {
    const f = scopedFixture();
    const adapter = createBundleReplacementAdapter({
      returnToDelegate: async () => { throw Error("Legacy rejection writer must not receive the new accounting grant"); },
      returnToDelegateFromBundle: returnReplacementToDelegateFromUnifiedBundle,
      accounting: async () => { throw Error("Rejection cannot create funding"); },
      management: async () => false, funding: async () => null,
    });
    expect(await adapter(f.tx, { id: 22, role: "senior_management", isActive: 1 }, "accounting", { id: 80, unifiedBundleId: 24 }, { itemId: 70, reason: "سعر البديل مرتفع ويحتاج إعادة تسعير" }, "", "signature")).toBe(true);
    expect(f.writes.some(query => query.includes("SET status='pending',batchId=NULL"))).toBe(true);
    const g = scopedFixture();
    await expect(adapter(g.tx, { id: 22, role: "senior_management", isActive: 1 }, "accounting", { id: 80 }, { itemId: 70, reason: "سعر البديل مرتفع ويحتاج مراجعة" }, "", "signature")).rejects.toThrow("سياق اعتماد حزمة التسعير مطلوب");
    expect(g.writes).toHaveLength(0);
  });
  it.each(["missing", "approval", "batch", "member", "snapshot", "delegate"])("denies mismatched %s proof without releasing credit or changing item", async mutation => {
    const f = scopedFixture();
    if (mutation === "missing") f.removeMembership();
    if (mutation === "approval") f.scope.approvalStatus = "approved";
    if (mutation === "batch") f.scope.batchStatus = "pending_management";
    if (mutation === "member") f.scope.status = "approved";
    if (mutation === "snapshot") f.scope.snapshotJson = JSON.stringify({ number: "DPB-24", delegate: { id: 4 }, rows: [{ id: 71, purchaseOrderId: 50 }] });
    if (mutation === "delegate") f.scope.bundleDelegateId = 99;
    await expect(returnReplacementToDelegateFromUnifiedBundle(f.tx, 22, "senior_management", "accounting", 24, 80, 70, "سعر البديل مرتفع ويحتاج مراجعة")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.writes).toHaveLength(0);
  });
  it("denies an inactive/changed actor and refuses to use the accounting exception for management", async () => {
    const f = scopedFixture(); f.actor.isActive = 0;
    await expect(returnReplacementToDelegateFromUnifiedBundle(f.tx, 22, "senior_management", "accounting", 24, 80, 70, "سعر البديل مرتفع ويحتاج مراجعة")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const g = scopedFixture();
    await expect(returnReplacementToDelegateFromUnifiedBundle(g.tx, 22, "senior_management", "management", 24, 80, 70, "سعر البديل مرتفع ويحتاج مراجعة")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.writes).toHaveLength(0); expect(g.writes).toHaveLength(0);
  });
});
