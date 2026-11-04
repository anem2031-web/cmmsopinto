import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rejected: { rows: [] as any[], total: 0, page: 1, pageSize: 10 }, error: null as any, loading: false, queryCalls: [] as any[] }));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: { purchaseSpecifications: {
  decide: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
  rejectedReturns: { useQuery: (input: any, options: any) => { fixture.queryCalls.push({ input, options }); return { data: fixture.rejected, isLoading: fixture.loading, error: fixture.error }; } },
} } }));
vi.mock("../../client/src/components/ui/dialog", () => ({
  useDialogComposition: () => ({ justEndedComposing: () => false, setComposing: () => {}, markCompositionEnd: () => {} }),
  Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <div>{children}</div>, DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));

import { SpecificationReviewList, RejectedSpecificationReturns } from "../../client/src/components/purchase/PurchaseSpecifications";

const row = { id: 81, revision: 3, status: "pending", purchaseOrderId: 52, poNumber: "PR-TEST-52", purchaseOrderItemId: 33, itemName: "مادة الإنشاءات", quantity: 5, unit: "قطعة", receiptNumber: "REC-24", warehouseName: "الرئيسي", lotCode: "LOT-81", supplierName: "المورد", invoiceNumber: "INV-52", receivedAt: "2026-11-04", warehousePhotoUrl: "/api/media?key=goods-photo", purchasedPhotoUrl: "/api/media?key=purchase-photo", invoicePhotoUrl: "/api/media?key=invoice-photo", remainingReturnableQuantity: 4 };
const componentSource = readFileSync(new URL("../../client/src/components/purchase/PurchaseSpecifications.tsx", import.meta.url), "utf8");
const orderSource = readFileSync(new URL("../../client/src/pages/purchase/PurchaseOrders.tsx", import.meta.url), "utf8");
const returnSource = readFileSync(new URL("../../client/src/pages/inventory/WarehouseReturn.tsx", import.meta.url), "utf8");
function parse(source: string) { return ts.createSourceFile("fixture.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function nodes<T extends ts.Node>(source: string, match: (node: ts.Node) => node is T): T[] {
  const found: T[] = []; const visit = (node: ts.Node) => { if (match(node)) found.push(node); ts.forEachChild(node, visit); }; visit(parse(source)); return found;
}
function evaluate(expression: string, scope: Record<string, any>) {
  const js = ts.transpileModule(`const result = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return runInNewContext(`${js}\nresult;`, scope);
}
function initializer(source: string, name: string) {
  const declaration = nodes(source, ts.isVariableDeclaration).find(node => node.name.getText() === name);
  if (!declaration?.initializer) throw new Error(`Missing production initializer ${name}`);
  return declaration.initializer.getText();
}
function specificationEffect() {
  const call = nodes(returnSource, ts.isCallExpression).find(node => node.expression.getText() === "useEffect" && node.arguments[0]?.getText().includes("const source = specificationSource.data"));
  if (!call) throw new Error("Missing production specification prefill effect");
  return call.arguments[0].getText();
}
const tick = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => { fixture.rejected = { rows: [], total: 0, page: 1, pageSize: 10 }; fixture.error = null; fixture.loading = false; fixture.queryCalls = []; });

describe("specification review UI", () => {
  it("shows received item context, scoped item media, explicit decisions and bounded pagination", () => {
    const html = renderToStaticMarkup(<SpecificationReviewList data={{ rows: [row], total: 21, page: 1, pageSize: 10 }} isLoading={false} page={1} onPageChange={() => {}} onDecisionSaved={() => {}} />);
    for (const value of [row.itemName, row.poNumber, row.receiptNumber, row.invoiceNumber, row.supplierName, row.lotCode, "مطابق — موافقة", "غير مطابق — رفض", "ملاحظات المطابقة (اختياري)", "التالي", "1 / 3"]) expect(html).toContain(value);
    expect(html).toContain('href="/purchase-orders/52"');
    for (const key of ["goods-photo", "purchase-photo", "invoice-photo"]) expect(html).toContain(key);
    expect(html).not.toContain("receiptId=");
  });
  it("reports load failures and empty scope explicitly", () => {
    const props = { isLoading: false, page: 1, onPageChange: () => {}, onDecisionSaved: () => {} };
    expect(renderToStaticMarkup(<SpecificationReviewList {...props} error={{ message: "تعذر تحميل المطابقة" }} />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<SpecificationReviewList {...props} />)).toContain("لا توجد أصناف بانتظار مطابقة المواصفات");
  });
  it("sends independent server id/revision decisions, trimmed notes and no stock mutation", () => {
    const callbacks = nodes(componentSource, ts.isJsxAttribute).filter(node => node.name.getText() === "onClick" && node.initializer?.getText().includes("decide.mutate"));
    expect(callbacks).toHaveLength(2);
    const mutate = vi.fn();
    for (const callback of callbacks) {
      const expression = (callback.initializer as ts.JsxExpression).expression!.getText();
      evaluate(expression, { decide: { mutate }, row, notes: { [row.id]: "  غير مطابق  " } })();
    }
    expect(mutate.mock.calls.map(([input]) => ({ ...input }))).toEqual([
      { id: 81, revision: 3, decision: "approved", notes: "غير مطابق" },
      { id: 81, revision: 3, decision: "rejected", notes: "غير مطابق" },
    ]);
  });
  it.each(["construction_procurement_manager", "admin", "owner", "warehouse", "accounting", "senior_management", "technician", "maintenance_manager"])("preserves exact tab grant for %s", role => {
    expect(evaluate(initializer(orderSource, "canReviewSpecifications"), { user: { role } })).toBe(["construction_procurement_manager", "admin", "owner"].includes(role));
  });
  it("uses one pending-list query for tab badge and contents", () => {
    expect(orderSource.match(/trpc\.purchaseSpecifications\.list\.useQuery/g)).toHaveLength(1);
    const query = nodes(orderSource, ts.isCallExpression).find(node => node.expression.getText() === "trpc.purchaseSpecifications.list.useQuery")!;
    const options = evaluate(query.arguments[1].getText(), { canReviewSpecifications: false, independentReadOptions: {} });
    expect(options.enabled).toBe(false);
  });
  it("returns to the final existing page after approving the last row of a page", () => {
    const effect = nodes(orderSource, ts.isCallExpression).find(node => node.expression.getText() === "useEffect" && node.arguments[0]?.getText().includes("specificationPage > lastPage"))!;
    const setSpecificationPage = vi.fn();
    evaluate(effect.arguments[0].getText(), { specifications: { data: { total: 10 } }, PAGE_SIZE: 10, specificationPage: 2, setSpecificationPage, Math })();
    expect(setSpecificationPage).toHaveBeenCalledWith(1);
  });
});

describe("rejected stock handoff to native supplier returns", () => {
  it("shows remaining rejected quantity and a verified-source link without creating a return", () => {
    fixture.rejected.rows = [{ ...row, status: "rejected", notes: "المقاس لا يطابق" }]; fixture.rejected.total = 1;
    const html = renderToStaticMarkup(<RejectedSpecificationReturns />);
    expect(html).toContain('href="/warehouse/return?specificationId=81"');
    expect(html).toContain("المقاس لا يطابق"); expect(html).toContain("المتبقي القابل للإرجاع: 4 قطعة");
    expect(fixture.queryCalls).toHaveLength(1); expect(fixture.queryCalls[0].input).toEqual({ page: 1, pageSize: 10 });
  });
  it("prefills only the server-verified lot, caps native availability, and never submits automatically", async () => {
    const states: Record<string, any> = {}; const resolve = vi.fn(async (_input: any) => ({ availableQuantity: 3, item: { id: 90 }, trackingToken: "verified" }));
    const scope: any = { specificationSource: { data: { ...row, warehouseId: 7, trackingToken: "verified", notes: "  رفض المواصفات  " } }, lotsEnabled: true, specificationRequested: true, specificationLot: { mutateAsync: resolve }, Number, Math, Error };
    for (const state of ["SpecificationReady", "SpecificationError", "ReturnMode", "ReturnWarehouseId", "ReturnLotInfo", "SelectedItem", "SelectedSource", "SelectedVendorKey", "ReturnedQuantity", "Reason", "Step"]) scope[`set${state}`] = (value: any) => { states[state] = value; };
    const cleanup = evaluate(specificationEffect(), scope)(); await tick();
    expect(resolve.mock.calls[0][0]).toEqual({ warehouseId: 7, trackingToken: "verified" });
    expect(states).toMatchObject({ ReturnMode: "supplier", ReturnWarehouseId: "7", ReturnedQuantity: 3, Reason: "رفض المواصفات", Step: "confirm", SpecificationReady: true });
    expect(states.SelectedItem).toEqual({ id: 90 }); cleanup();
  });
  it("ignores an obsolete native resolution after source navigation", async () => {
    let finish!: (data: any) => void; const apply = vi.fn();
    const scope: any = { specificationSource: { data: { ...row, warehouseId: 7, trackingToken: "verified" } }, lotsEnabled: true, specificationRequested: true, specificationLot: { mutateAsync: () => new Promise(resolve => { finish = resolve; }) }, Number, Math, Error };
    for (const state of ["SpecificationReady", "SpecificationError", "ReturnMode", "ReturnWarehouseId", "ReturnLotInfo", "SelectedItem", "SelectedSource", "SelectedVendorKey", "ReturnedQuantity", "Reason", "Step"]) scope[`set${state}`] = apply;
    const cleanup = evaluate(specificationEffect(), scope)(); apply.mockClear(); cleanup(); finish({ availableQuantity: 2, item: { id: 90 } }); await tick();
    expect(apply).not.toHaveBeenCalled();
  });
  it("requires source verification before native confirmation while ordinary returns remain unchanged", () => {
    const expression = initializer(returnSource, "specificationBlocked");
    const base = { specificationRequested: true, validSpecificationId: true, specificationReady: true, specificationId: 81, specificationSource: { data: { id: 81, trackingToken: "verified", warehouseId: 7 }, error: null }, returnLotInfo: { trackingToken: "verified" }, returnWarehouseId: "7", specificationError: "" };
    expect(evaluate(expression, base)).toBe(false);
    expect(evaluate(expression, { ...base, specificationReady: false })).toBe(true);
    expect(evaluate(expression, { ...base, validSpecificationId: false })).toBe(true);
    expect(evaluate(expression, { ...base, specificationSource: { error: new Error("forbidden") } })).toBe(true);
    expect(evaluate(expression, { ...base, specificationId: 82 })).toBe(true);
    expect(evaluate(expression, { ...base, returnLotInfo: { trackingToken: "other-lot" } })).toBe(true);
    expect(evaluate(expression, { ...base, returnWarehouseId: "8" })).toBe(true);
    expect(evaluate(expression, { ...base, specificationRequested: false, specificationReady: false })).toBe(false);
  });
});
