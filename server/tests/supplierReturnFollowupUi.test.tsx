import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { APP_ROLE, canRoleAccessPath } from "../../shared/roles";

const data = vi.hoisted(() => ({ role: "delegate", loading: false, enabled: true, tab: "active", queryCalls: [] as any[], listOptions: [] as any[], rows: [] as any[], total: undefined as number | undefined, mutations: [] as any[] }));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual, useState: (initial: any) => initial === "active" ? [data.tab, vi.fn()] : actual.useState(initial) };
});
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 10, role: data.role, isActive: 1 }, loading: data.loading }) }));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: { supplierReturns: {
  status: { useQuery: () => ({ data: { enabled: data.enabled } }) },
  list: { useQuery: (input: any, options: any) => { data.listOptions.push(options); if (options.enabled) data.queryCalls.push(input); return { data: options.enabled ? { total: data.total ?? data.rows.length, items: data.rows } : undefined, refetch: vi.fn() }; } },
  command: { useMutation: () => ({ mutate: (...args: any[]) => data.mutations.push(args), isPending: false }) },
  chooseReplacement: { useMutation: () => ({ mutate: (...args: any[]) => data.mutations.push(args), isPending: false }) },
  confirmRefund: { useMutation: () => ({ mutate: (...args: any[]) => data.mutations.push(args), isPending: false }) },
  cancelAfterRefund: { useMutation: () => ({ mutate: (...args: any[]) => data.mutations.push(args), isPending: false }) },
} } }));
vi.mock("../../client/src/components/catalog/CatalogPickerDialog", () => ({ CatalogPickerDialog: () => null }));
import { SupplierReturns } from "../../client/src/components/purchase/SupplierReturns";
import WarehouseReturnFollowup from "../../client/src/pages/purchase/WarehouseReturnFollowup";

beforeEach(() => {
  data.role = "delegate"; data.loading = false; data.enabled = true; data.tab = "active"; data.queryCalls = []; data.listOptions = []; data.total = undefined; data.mutations = [];
  data.rows = [{ id: 1, delegateId: 10, itemName: "Material", returnNumber: "RTN-1", returnedQuantity: 2, returnedUnit: "piece", handoverStatus: "awaiting_delegate" }];
});
describe("Dedicated assigned warehouse-return followup", () => {
  it.each(Object.values(APP_ROLE))("keeps the %s page grant explicit without expanding API scope", role => {
    data.role = role;
    const allowed = ["delegate", "delegate_manager", "owner", "admin"].includes(role);
    expect(canRoleAccessPath(role, "/warehouse-returns-followup?tab=completed")).toBe(allowed);
    const html = renderToStaticMarkup(<WarehouseReturnFollowup />);
    if (allowed) {
      expect(html).toContain("مرتجعات المستودع"); expect(data.queryCalls).toHaveLength(1);
      expect(data.queryCalls[0]).toEqual({ page: 1, pageSize: 20, status: "active" });
    } else {
      expect(html).toContain("ليس لديك صلاحية لهذه الصفحة"); expect(data.queryCalls).toHaveLength(0);
    }
  });
  it("does not request return data while the account is loading", () => {
    data.loading = true;
    expect(renderToStaticMarkup(<WarehouseReturnFollowup />)).toContain("جارٍ تحميل الحساب");
    expect(data.queryCalls).toHaveLength(0);
  });
  it("keeps pending handover decisions and mandatory rejection reason visible", () => {
    const html = renderToStaticMarkup(<SupplierReturns />);
    expect(html).toContain("بانتظار تأكيد استلام المندوب");
    expect(html).toContain("استلمت المرتجع"); expect(html).toContain("سبب عدم الاستلام");
    expect(html).not.toContain("استبدال بنفس الصنف");
  });
  it("loads completed cases from the server and retains source/replacement references without action buttons", () => {
    data.tab = "completed";
    data.rows = [{ ...data.rows[0], handoverStatus: "accepted", closedAt: "2026-11-04", resolution: "same_item", replacementPlanId: 5, replacementPlanStatus: "received", replacementPurchaseOrderId: 7, replacementPoNumber: "PR-REPLACEMENT", parentReturnNumber: "RTN-PREVIOUS", residualCustodyAmount: "20.0000" }];
    const html = renderToStaticMarkup(<SupplierReturns />);
    expect(data.queryCalls[0].status).toBe("completed");
    expect(html).toContain("اكتملت متابعة المرتجع باستلام البديل");
    expect(html).toContain("متبقٍ بعهدة المندوب: 20.00");
    expect(html).toContain("RTN-PREVIOUS"); expect(html).toContain("PR-REPLACEMENT");
    expect(html).not.toContain("لم أستلم المرتجع"); expect(html).not.toMatch(/<button[^>]*>استبدال بنفس الصنف<\/button>/);
  });
  it("does not label a zero remainder as a new custody amount", () => {
    data.rows[0] = { ...data.rows[0], residualCustodyAmount: "0.0000" };
    expect(renderToStaticMarkup(<SupplierReturns />)).not.toContain("متبقٍ بعهدة المندوب");
  });
  it("returns from an emptied last active page to an existing page after completion", () => {
    const source = ts.createSourceFile("SupplierReturns.tsx", readFileSync("client/src/components/purchase/SupplierReturns.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect = "";
    const find = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") effect = node.arguments[0].getText(source);
      ts.forEachChild(node, find);
    };
    find(source);
    const script = ts.transpileModule(`(${effect})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const setPage = vi.fn();
    vm.runInNewContext(script, { list: { data: { total: 20 } }, page: 2, setPage })();
    expect(setPage).toHaveBeenCalledWith(1);
    setPage.mockClear();
    vm.runInNewContext(script, { list: { data: { total: 45 } }, page: 3, setPage })();
    expect(setPage).not.toHaveBeenCalled();
  });
  it("searches the loaded center page immediately in Arabic or English without changing server pagination or actions", () => {
    data.rows = [{ ...data.rows[0], itemName: "مادة كهرباء", returnedUnit: "قطعة" }, { ...data.rows[0], id: 2, itemName: "PIPE", returnNumber: "RTN-2" }];
    const arabic = renderToStaticMarkup(<SupplierReturns centerMode search="ك" />);
    expect(arabic).toContain("مادة كهرباء"); expect(arabic).not.toContain("PIPE");
    const english = renderToStaticMarkup(<SupplierReturns centerMode search="p" />);
    expect(english).toContain("PIPE"); expect(english).not.toContain("مادة كهرباء");
    expect(data.queryCalls).toEqual([{ page: 1, pageSize: 20, status: "active" }, { page: 1, pageSize: 20, status: "active" }]);
    expect(data.mutations).toEqual([]);
  });
  it("describes only current-page search results and retains the original active/completed server totals", () => {
    data.total = 42;
    const html = renderToStaticMarkup(<SupplierReturns centerMode search="no match" />);
    expect(html).toContain("البحث في الصفحة الحالية فقط");
    expect(html).toContain("إجمالي ملفات الحالة: 42");
    expect(html).toContain("لا توجد نتائج مطابقة في الصفحة الحالية");
    expect(html).not.toContain("لا توجد مرتجعات قيد المتابعة.");
    expect(html).toContain("التالي");
    data.tab = "completed";
    renderToStaticMarkup(<SupplierReturns centerMode search="x" />);
    expect(data.queryCalls[1]).toEqual({ page: 1, pageSize: 20, status: "completed" });
  });
  it("keeps original screen defaults and ignores center search unless centerMode is requested", () => {
    expect(renderToStaticMarkup(<SupplierReturns search="no match" />)).toContain("Material");
    expect(renderToStaticMarkup(<SupplierReturns />)).not.toContain("البحث في الصفحة الحالية فقط");
    expect(data.mutations).toEqual([]);
  });
  it("shows an unavailable message only in the center without enabling list reads or invoking actions", () => {
    data.enabled = false;
    expect(renderToStaticMarkup(<SupplierReturns centerMode search="مادة" />)).toContain("متابعة مرتجعات المورد غير متاحة حاليًا.");
    expect(renderToStaticMarkup(<SupplierReturns />)).toBe("");
    expect(data.queryCalls).toEqual([]);
    expect(data.listOptions).toEqual([{ enabled: false }, { enabled: false }]);
    expect(data.mutations).toEqual([]);
  });
});
