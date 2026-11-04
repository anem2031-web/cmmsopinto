import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { computePurchaseOrderPhases } from "../services/reports/purchaseCyclePhases";
import { readScopeChunks } from "../_core/authz/read-batch";
import { isRoutedPurchaseItem } from "../../shared/purchase-item-review";
import { readAccountingSignature, captureAccountingSignature } from "../services/pdf/accountingSignature";

function functionSource(file: string, name: string) {
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  return ts.transpileModule(`(${node.getText(ast).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const renderer = functionSource("server/services/export/exportService.ts", "generatePurchaseRequestPDF");
function renderFixture(items: any[], reviewerRows = [{ id: 201, name: "Actual construction reviewer" }, { id: 202, name: "Actual senior reviewer" }]) {
  let html = ""; const reads: number[][] = [], writes = vi.fn(), images = vi.fn(async (source: string | null) => source ? `data:image/png;base64,${source}` : "");
  const db = { getPurchaseOrderById: async () => ({ id: 10, poNumber: "PR-10", requestedById: 100, reviewedById: 999, reviewerSignatureSnapshot: "WRONG-HEADER-SIGNATURE" }), getPOItems: async () => items,
    getPOPricingBatchById: async () => ({ id: 5, purchaseOrderId: 10, submittedById: 11, accountingApprovedById: 44, accountingSignatureSnapshot: captureAccountingSignature({ id: 44, name: "Senior management acting in accounting", signatureUrl: "captured-accounting" }), managementApprovedById: 44, delegateSignatureSnapshot: "delegate" }),
    getUserById: async (id: number) => { if (id === 999) throw Error("Unselected header reviewer must not be loaded"); return { id, name: `User ${id}`, role: id === 11 ? "delegate" : "senior_management", signatureUrl: `CURRENT-PROFILE-${id}` }; },
    getDb: async () => ({ select: () => ({ from: () => ({ where: async (ids: number[]) => { reads.push(ids); return reviewerRows.filter(row => ids.includes(row.id)); } }) }) }), updatePurchaseOrder: writes,
  };
  const render = vm.runInNewContext(renderer, { db, isRoutedPurchaseItem, readScopeChunks, inArray: (_: any, ids: number[]) => ids, users: { id: "id", name: "name" }, getSignatureDataUrl: images, readAccountingSignature,
    replacementDocumentForBatch: async () => [],
    escapeHtml: (value: any) => String(value).replaceAll("<", "&lt;"), fmtSAR: (value: number) => value.toFixed(2), amountToArabicCurrencyPhrase: String,
    htmlToPdf: async (value: string) => { html = value; return Buffer.from("%PDF-test"); },
  });
  return { render, html: () => html, reads, images, writes };
}
const row = (id: number, extra: any = {}) => ({ id, purchaseOrderId: 10, itemName: `Item ${id}`, quantity: 1, unit: "قطعة", estimatedUnitCost: "10", estimatedTotalCost: "10", status: "estimated", delegateId: 11, batchId: 5, reviewRole: "construction_procurement_manager", reviewedById: 201, reviewedAt: "2026-11-03T08:00:00Z", reviewerSignatureSnapshot: "CAPTURED-201", ...extra });

describe("Routed purchase reviewer metadata without live database or environment", () => {
  it("renders only included batch reviewers and their captured signatures, not header or later profile signatures", async () => {
    const f = renderFixture([row(1), row(2, { reviewRole: "senior_management", reviewedById: 202, reviewerSignatureSnapshot: null }), row(3, { batchId: 6, reviewedById: 999, reviewerSignatureSnapshot: "UNSELECTED" })]);
    await f.render(10, 44, 5);
    expect(f.html()).toContain("Actual construction reviewer"); expect(f.html()).toContain("Actual senior reviewer");
    expect(f.html()).not.toContain("WRONG-HEADER-SIGNATURE"); expect(f.html()).not.toContain("UNSELECTED");
    expect(f.images).toHaveBeenCalledWith("CAPTURED-201"); expect(f.images).not.toHaveBeenCalledWith("CURRENT-PROFILE-202");
    expect(f.html()).toContain("Senior management acting in accounting"); expect(f.images).toHaveBeenCalledWith("captured-accounting");
    expect(f.reads).toEqual([[201, 202]]);
    expect(f.writes.mock.calls.some(([, data]) => "reviewerSignatureSnapshot" in data)).toBe(false);
    expect(f.html().match(/>مراجع الطلب<\/td>/g)).toHaveLength(2);
  });
  it("denies missing routed review decisions and missing reviewer records instead of borrowing the header actor", async () => {
    const missing = renderFixture([row(1, { reviewedAt: null })]); await expect(missing.render(10, 44, 5)).rejects.toThrow("توثيق");
    const orphan = renderFixture([row(1)], []); await expect(orphan.render(10, 44, 5)).rejects.toThrow("مراجع");
    expect(missing.html()).toBe(""); expect(orphan.html()).toBe("");
  });
  it("keeps review pending after the first decision despite a stale reviewed header and names each assigned role", () => {
    const po = { createdAt: "2026-11-03T06:00:00Z", status: "pending_management", reviewedAt: "2026-11-03T08:00:00Z", accountingApprovedAt: "2026-11-03T09:00:00Z" };
    const reviews = [row(1, { reviewerName: "Actual construction reviewer" }), row(2, { reviewRole: "senior_management", reviewedAt: null, reviewedById: null })];
    const phases = computePurchaseOrderPhases(po, { requestedBy: "Creator", reviewedBy: "Wrong header reviewer", itemReviews: reviews });
    expect(phases[1]).toMatchObject({ status: "قيد التنفيذ", endAt: null });
    expect(phases[1].actors).toEqual([{ itemName: "Item 1", name: "Actual construction reviewer" }, { itemName: "Item 2", name: "الإدارة العليا" }]);
    expect(phases[1].actor).not.toContain("Wrong header reviewer");
    reviews[1] = row(2, { reviewRole: "senior_management", reviewerName: "Actual senior reviewer", reviewedById: 202, reviewedAt: "2026-11-03T11:00:00Z" });
    const complete = computePurchaseOrderPhases(po, { requestedBy: "Creator", itemReviews: reviews });
    expect(complete[1].status).toBe("مكتملة"); expect(complete[1].endAt?.toISOString()).toBe("2026-11-03T11:00:00.000Z");
    expect(complete[2].durationHours).toBe(1);
  });
  it("preserves legacy review phases without item routing", () => {
    const phases = computePurchaseOrderPhases({ createdAt: "2026-11-03T06:00:00Z", reviewedAt: "2026-11-03T08:00:00Z", status: "pending_estimate" }, { requestedBy: "Creator", reviewedBy: "Legacy reviewer" });
    expect(phases[1]).toMatchObject({ status: "مكتملة", actor: "Legacy reviewer", durationHours: 2, actors: [{ itemName: "", name: "Legacy reviewer" }] });
  });
  it("tracks each routed line by its review department, reviewer and actual batch instead of the header stage", () => {
    const code = functionSource("server/pmv2/tracking/timeline-service.ts", "purchaseResponsibility");
    const responsible = vm.runInNewContext(code, { roleLabel: (role: string) => role });
    expect(responsible({ status: "pending_management" }, row(1, { status: "pending_review", reviewedById: null, reviewedAt: null }))).toMatchObject({ stageKey: "purchase_review", roleKey: "construction_procurement_manager" });
    expect(responsible({ status: "pending_accounting" }, row(1, { status: "pending", delegateChangeRequestedAt: "2026-11-03" }))).toMatchObject({ roleKey: "construction_procurement_manager", responsibleUserId: 201 });
    expect(responsible({ status: "pending_management" }, row(1, { status: "pending", batchId: null }))).toMatchObject({ stageKey: "purchase_delegate", responsibleUserId: 11 });
    expect(responsible({ status: "approved" }, row(1, { status: "estimated", pricingBatchStatus: "pending_accounting" }))).toMatchObject({ stageKey: "purchase_accounting", roleKey: "accountant" });
    expect(responsible({ status: "pending_accounting" }, row(1, { status: "approved" }))).toMatchObject({ stageKey: "purchase_delegate", responsibleUserId: 11 });
    expect(responsible({ status: "pending_management" }, row(1, { status: "purchased" }))).toMatchObject({ stageKey: "purchase_warehouse_receipt", roleKey: "warehouse" });
    expect(responsible({ status: "pending_review" }, { status: "pending" })).toMatchObject({ roleKey: "maintenance_manager" });
    expect(responsible({ status: "draft" }, row(1, { status: "pending_review" }))).toMatchObject({ stageKey: "purchase_requester" });
  });
});
