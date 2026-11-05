import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  mode: "" as string, search: "", selectedOrder: null as number | null, reason: "", quantity: 1,
  pmv2Rows: [] as any[], tickets: [] as any[], orders: [] as any[], docs: [] as any[], detail: null as any,
  queries: [] as any[], buttons: [] as any[], panels: [] as any[], prints: [] as any[],
  returnInput: null as any, pmv2Input: null as any, increments: [] as any[], stockRenders: 0,
  refetches: [] as string[], lotQuantities: {} as Record<string, string>,
  errors: {} as Record<string, { message: string }>,
}));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual, useState: (initial: any) => {
    if (fixture.mode === "operational" && initial === null) return [fixture.selectedOrder, vi.fn()];
    if (fixture.mode === "operational" && initial === "") return [fixture.reason, vi.fn()];
    if (fixture.mode === "operational" && initial === 1) return [fixture.quantity, vi.fn()];
    if (fixture.mode === "pmv2" && initial && typeof initial === "object" && !Array.isArray(initial)) return [fixture.lotQuantities, vi.fn()];
    return actual.useState(initial);
  } };
});
vi.mock("../../client/src/components/ui/button", () => ({ Button: ({ children, onClick, disabled, ...props }: any) => {
  fixture.buttons.push({ children, onClick, disabled }); return <button disabled={disabled} {...props}>{children}</button>;
} }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, role: "warehouse", isActive: 1 }, loading: false }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: "ar", dir: "rtl", t: {
  common: { refresh: "تحديث", loading: "جارٍ التحميل" }, workflow: { pmv2: new Proxy({}, { get: (_target, key) => String(key) }) },
} }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/warehouse/returns", vi.fn()] }));
vi.mock("../../client/src/components/catalog/MaterialIdentityDialog", () => ({ MaterialIdentityDialog: () => <p>IDENTITY-DIALOG</p> }));
vi.mock("../../client/src/components/inventory/WarehouseLotSelection", () => ({ WarehouseLotSelection: () => <p>ISSUE-LOTS</p> }));
vi.mock("../../client/src/pages/maintenance-teams/ExecutionPanel", () => ({ ExecutionPanel: (props: any) => { fixture.panels.push(props); return <p>{props.warehouseTicket.ticketNumber} — need{props.warehouseNeedId} — {props.warehouseSection}</p>; } }));
vi.mock("../../client/src/pages/operational-issues/OperationalStockPanel", () => ({ OperationalStockPanel: () => { fixture.stockRenders++; return <p>STOCK-ISSUE</p>; } }));
vi.mock("../../client/src/pages/operational-issues/PreparedDispatchPanel", () => ({ PreparedDispatchPanel: () => { fixture.stockRenders++; return <p>DISPATCH</p>; } }));
vi.mock("../../client/src/components/purchase/SupplierReturns", () => ({ SupplierReturns: () => <p>SUPPLIER-FOLLOWUP</p> }));
vi.mock("../../client/src/components/purchase/PurchaseSpecifications", () => ({ RejectedSpecificationReturns: () => <p>REJECTED-SPECIFICATIONS</p> }));
vi.mock("../../client/src/lib/printReturnDocument", () => ({ fmtDate: (date: any) => date || "—", printReturnDocument: (doc: any, count: any) => { fixture.prints.push(doc); count(); } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("../../client/src/lib/trpc", () => {
  const query = (name: string, data: () => any) => ({ useQuery: (input: any, options: any = {}) => {
    fixture.queries.push({ name, input, options });
    return { data: data(), error: fixture.errors[name] ?? null, isLoading: false, isFetching: false, refetch: async () => { fixture.refetches.push(name); } };
  } });
  const mutation = (save: (input: any) => void = () => {}) => ({ useMutation: (options: any = {}) => ({
    isPending: false, mutate: (input: any) => { save(input); return options.onSuccess?.({ completed: true }); },
    mutateAsync: async (input: any) => { save(input); return {}; },
  }) });
  return { trpc: {
    useUtils: () => ({ ticketTeamExecution: { details: { invalidate: vi.fn() }, balances: { invalidate: vi.fn() } } }),
    pmv2: { warehouse: {
      waitingMaterialQueue: query("waiting", () => ({ total: 0, requests: [], items: [], mainWarehouse: { code: "MAIN", nameAr: "المستودع الرئيسي" } })), readyToIssueQueue: query("ready", () => []), pendingReturns: query("pmv2Returns", () => fixture.pmv2Rows),
      searchMaterialIdentityCandidates: query("identity", () => ({ items: [] })), prepareTransferHandoff: mutation(), preparePurchaseHandoff: mutation(), resolveMaterialIdentity: mutation(),
      issueReadyRequirement: mutation(), linkConfirmedDelivery: mutation(), confirmPendingReturn: mutation(input => { fixture.pmv2Input = input; }),
    } },
    ticketTeamAssignments: { warehouseRequests: query("tickets", () => fixture.tickets) },
    operationalIssues: {
      list: query("operationalList", () => ({ enabled: true, orders: fixture.orders })), detail: query("operationalDetail", () => fixture.detail),
      availability: query("availability", () => ({ items: [] })), approve: mutation(), returnMaterial: mutation(input => { fixture.returnInput = input; }),
    },
    returnDocuments: { list: query("documents", () => fixture.docs), incrementPrint: mutation(input => { fixture.increments.push(input); }) },
  } };
});

import Pmv2WarehouseQueue from "../../client/src/pages/pmv2/Pmv2WarehouseQueue";
import TicketWarehouseRequests from "../../client/src/pages/maintenance-teams/TicketWarehouseRequests";
import OperationalWarehouseRequests from "../../client/src/pages/operational-issues/OperationalWarehouseRequests";
import WarehouseReturnsList from "../../client/src/pages/inventory/WarehouseReturnsList";
import { WarehouseReturnDocuments } from "../../client/src/components/inventory/WarehouseReturnDocuments";

const buttonText = (value: any): string => Array.isArray(value) ? value.map(buttonText).join("") : typeof value === "string" ? value : value?.props?.children ? buttonText(value.props.children) : "";
const button = (text: string) => fixture.buttons.find(item => buttonText(item.children).includes(text));
beforeEach(() => {
  Object.assign(fixture, { mode: "", selectedOrder: null, reason: "", quantity: 1, pmv2Rows: [], tickets: [], orders: [], docs: [], detail: null,
    queries: [], buttons: [], panels: [], prints: [], returnInput: null, pmv2Input: null, increments: [], stockRenders: 0, refetches: [], lotQuantities: {}, errors: {} });
});

describe("returns-only embeds reuse their original source panels", () => {
  it("shows only PMV2 returns, searches actual task/material/lot references and disables unrelated reads", async () => {
    fixture.mode = "pmv2";
    fixture.pmv2Rows = [{ declarationActionId: 9, itemName: "مادة مرتجعة", taskNumber: "PM-101", taskItemTitle: "Task", issuedQuantity: 3, usedQuantity: 1, remainingReturnQuantity: 2, unit: "قطعة", singleLot: false, lots: [{ lotId: 3, lotCode: "LOT-001", returnableQuantity: 2 }] },
      { declarationActionId: 10, itemName: "Different", taskNumber: "PM-102", taskItemTitle: "Hidden", issuedQuantity: 1, usedQuantity: 0, remainingReturnQuantity: 1, unit: "قطعة", singleLot: true, lots: [{ lotId: 4, lotCode: "LOT-002", returnableQuantity: 1 }] }];
    fixture.lotQuantities = { "9:3": "2" };
    const html = renderToStaticMarkup(<Pmv2WarehouseQueue section="returns" embedded search="lot-001" />);
    expect(html).toContain("PM-101"); expect(html).not.toContain("PM-102"); expect(html).not.toContain("warehouseQueueTitle"); expect(html).not.toContain("IDENTITY-DIALOG");
    expect(fixture.queries.find(row => row.name === "waiting").options.enabled).toBe(false);
    expect(fixture.queries.find(row => row.name === "ready").options.enabled).toBe(false);
    expect(fixture.queries.find(row => row.name === "pmv2Returns").options.enabled).not.toBe(false);
    await button("confirmReturnReceipt").onClick();
    expect(fixture.pmv2Input).toEqual({ declarationActionId: 9, lotAllocations: [{ lotId: 3, quantity: 2 }] });
    expect(fixture.refetches).toEqual(["pmv2Returns"]);
  });
  it("preserves PMV2 waiting/ready/returns reads and chrome when no embedding props are supplied", () => {
    const html = renderToStaticMarkup(<Pmv2WarehouseQueue />);
    expect(html).toContain("warehouseQueueTitle"); expect(html).toContain("needsProcessing"); expect(html).toContain("readyForIssue");
    expect(fixture.queries.find(row => row.name === "waiting").options.enabled).toBe(true);
    expect(fixture.queries.find(row => row.name === "ready").options.enabled).toBe(true);
  });
  it("reports a PMV2 return read error without claiming an empty queue or issuing any return", () => {
    fixture.errors.pmv2Returns = { message: "PMV2 return source unavailable" };
    const html = renderToStaticMarkup(<Pmv2WarehouseQueue section="returns" embedded />);
    expect(html).toContain('role="alert"'); expect(html).toContain("PMV2 return source unavailable"); expect(html).not.toContain("noPendingReturns");
    expect(fixture.pmv2Input).toBeNull(); expect(fixture.refetches).toEqual([]);
  });
  it("uses the ticket's existing return section and exact assignment/need IDs without rendering other material sections", () => {
    fixture.tickets = [{ assignmentId: 31, ticketId: 40, ticketNumber: "MT-040", title: "تكييف", teamName: "Team", warehouseName: "Warehouse", materialNeeds: [
      { needId: 1, name: "Waiting", unit: "قطعة", section: "waiting" }, { needId: 2, name: "Ready", unit: "قطعة", section: "ready" }, { needId: 3, name: "مرتجع سلك", unit: "لفة", section: "returns" },
    ] }];
    const html = renderToStaticMarkup(<TicketWarehouseRequests section="returns" embedded search="س" />);
    expect(html).toContain("need3"); expect(html).not.toContain("need1"); expect(html).not.toContain("need2");
    expect(html).not.toContain("جاهزة للصرف"); expect(fixture.panels).toHaveLength(1);
    expect(fixture.panels[0]).toMatchObject({ assignmentId: 31, warehouseNeedId: 3, warehouseSection: "returns", returnsOnly: true, actorId: 7, role: "warehouse" });
  });
  it("retains all original ticket tabs and default waiting section without props", () => {
    fixture.tickets = [{ assignmentId: 31, ticketId: 40, ticketNumber: "MT-040", materialNeeds: [{ needId: 1, name: "Waiting", unit: "قطعة", section: "waiting" }] }];
    const html = renderToStaticMarkup(<TicketWarehouseRequests />);
    expect(html).toContain("تحتاج معالجة"); expect(html).toContain("جاهزة للصرف"); expect(html).toContain("المرتجعات");
    expect(fixture.panels[0]).toMatchObject({ warehouseSection: "waiting", returnsOnly: false });
  });
  it("reports a ticket return read error without an empty-result claim or a mounted action panel", () => {
    fixture.errors.tickets = { message: "Ticket return source unavailable" };
    const html = renderToStaticMarkup(<TicketWarehouseRequests section="returns" embedded />);
    expect(html).toContain('role="alert"'); expect(html).toContain("Ticket return source unavailable"); expect(html).not.toContain("لا توجد طلبات مواد");
    expect(fixture.panels).toEqual([]); expect(fixture.refetches).toEqual([]);
  });
});

describe("operational embed keeps actual issue-document return actions", () => {
  beforeEach(() => {
    fixture.mode = "operational"; fixture.selectedOrder = 10; fixture.reason = "مواد غير مستخدمة"; fixture.quantity = 2;
    fixture.orders = [{ id: 10, orderNumber: "OP-010", status: "approved", siteName: "Main", sectionName: "Section", collectorName: "Collector" }, { id: 11, orderNumber: "OP-011", status: "pending", collectorName: "Other" }];
    fixture.detail = { order: { id: 10, orderNumber: "OP-010", status: "pending", revision: 4, reason: "Original request" }, cost: { issued: 20, returned: 0, net: 20 }, items: [{ id: 2, dispatchContext: {} }], deliveries: [{ id: 1, deliveryDocumentId: 88, deliveryNumber: "DLV-088", lotCode: "LOT-001", quantity: 3, returnedQuantity: 0 }] };
  });
  it("hides approval/issue/stock, does not fetch availability and submits the same exact existing return payload", async () => {
    const html = renderToStaticMarkup(<OperationalWarehouseRequests returnsOnly embedded search="op-010" />);
    expect(html).toContain("OP-010"); expect(html).not.toContain("OP-011"); expect(html).toContain("DLV-088"); expect(html).not.toContain("DISPATCH"); expect(fixture.stockRenders).toBe(0);
    expect(fixture.queries.find(row => row.name === "availability").options.enabled).toBe(false);
    expect(html).toContain("اختر طلب صرف");
    const action = button("مرتجع") || fixture.buttons.find(row => buttonText(row.children).includes("إرجاع"));
    expect(action).toBeDefined(); expect(action.disabled).toBe(false); await action.onClick();
    expect(fixture.returnInput).toMatchObject({ orderId: 10, deliveryDocumentId: 88, quantity: 2, reason: "مواد غير مستخدمة" });
    expect(fixture.returnInput.operationKey).toEqual(expect.any(String)); expect(fixture.refetches).toEqual(["operationalList", "operationalDetail"]);
  });
  it("keeps the original stock panel and availability read outside returns-only mode", () => {
    const html = renderToStaticMarkup(<OperationalWarehouseRequests />);
    expect(html).toContain("DISPATCH"); expect(fixture.stockRenders).toBe(1);
    expect(fixture.queries.find(row => row.name === "availability").options.enabled).toBe(true);
  });
  it("shows no invented pending-return count and requires selecting an actual request first", () => {
    fixture.selectedOrder = null; fixture.detail = null;
    const html = renderToStaticMarkup(<OperationalWarehouseRequests returnsOnly embedded />);
    expect(html).toContain("اختر طلب صرف"); expect(html).not.toContain("DLV-088"); expect(fixture.returnInput).toBeNull();
    expect(fixture.queries.find(row => row.name === "operationalDetail").options.enabled).toBe(false);
  });
});

describe("existing return documents stay printable and source-searchable", () => {
  beforeEach(() => { fixture.docs = [{ id: 1, itemName: "صنف المورد", returnNumber: "RTN-001", receiptNumber: "RCV-001", poNumber: "PR-001", returnedQuantity: 2, returnedByName: "Warehouse", reason: "Damaged" },
    { id: 2, itemName: "صنف الفني", returnNumber: "RTN-002", sourceDeliveryNumber: "DLV-002", returnedQuantity: 1, returnedByName: "Technician", reason: "Unused" }]; });
  it("filters categories/search without replacing document or print callbacks", () => {
    const html = renderToStaticMarkup(<WarehouseReturnDocuments category="recipient" search="dlv-002" />);
    expect(html).toContain("RTN-002"); expect(html).not.toContain("RTN-001");
    button("طباعة الوثيقة").onClick(); expect(fixture.prints).toEqual([fixture.docs[1]]); expect(fixture.increments).toEqual([{ id: 2 }]);
    expect(fixture.queries.filter(row => row.name === "documents")).toHaveLength(1);
  });
  it("keeps the original WarehouseReturnsList sections and both document types by default", () => {
    const html = renderToStaticMarkup(<WarehouseReturnsList />);
    for (const text of ["REJECTED-SPECIFICATIONS", "SUPPLIER-FOLLOWUP", "RTN-001", "RTN-002", "مرتجع جديد"]) expect(html).toContain(text);
  });
  it("reports document read failure without claiming no returns or printing anything", () => {
    fixture.docs = []; fixture.errors.documents = { message: "Return documents unavailable" };
    const html = renderToStaticMarkup(<WarehouseReturnDocuments />);
    expect(html).toContain('role="alert"'); expect(html).toContain("Return documents unavailable"); expect(html).not.toContain("لا توجد مرتجعات");
    expect(fixture.prints).toEqual([]); expect(fixture.increments).toEqual([]);
  });
});
