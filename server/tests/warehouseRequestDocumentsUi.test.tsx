import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ search: "", language: "ar", role: "warehouse", rows: [] as any[], query: [] as any[], detail: vi.fn(), print: vi.fn(), nav: vi.fn(), mounted: [] as string[], cells: [] as any[], cursor: 0, inputs: [] as any[], buttons: [] as any[], tabs: [] as any[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: any) => {
  const i = f.cursor++; if (!(i in f.cells)) f.cells[i] = typeof initial === "function" ? initial() : initial;
  return [f.cells[i], (value: any) => { f.cells[i] = typeof value === "function" ? value(f.cells[i]) : value; }];
} }));
vi.mock("wouter", () => ({ useSearch: () => f.search, useLocation: () => ["", f.nav] }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ authenticatedUser: { id: 1, role: f.role, isActive: 1 }, user: { id: 1, role: "admin", isActive: 1 } }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: f.language, dir: "rtl" }) }));
vi.mock("../../client/src/components/ui/tabs", () => ({
  Tabs: (p: any) => { f.tabs.push(p); return <div>{p.children}</div>; }, TabsList: (p: any) => <div>{p.children}</div>, TabsTrigger: (p: any) => <span>{p.children}</span>, TabsContent: (p: any) => <div>{p.children}</div>,
}));
vi.mock("../../client/src/components/ui/button", () => ({ Button: (p: any) => { f.buttons.push(p); return <button>{p.children}</button>; } }));
vi.mock("../../client/src/components/ui/input", () => ({ Input: (p: any) => { f.inputs.push(p); return <input {...p}/>; } }));
vi.mock("../../client/src/components/ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? <section>{children}</section> : null, DialogContent: (p: any) => <div>{p.children}</div>, DialogHeader: (p: any) => <div>{p.children}</div>, DialogTitle: (p: any) => <h2>{p.children}</h2> }));
vi.mock("../../client/src/pages/pmv2/Pmv2WarehouseQueue", () => ({ default: () => { f.mounted.push("pmv2"); return <p>PMV2 operations</p>; } }));
vi.mock("../../client/src/pages/maintenance-teams/TicketWarehouseRequests", () => ({ default: (p: any) => { f.mounted.push("tickets"); return <p>Ticket operations {p.ticketId}</p>; } }));
vi.mock("../../client/src/pages/operational-issues/OperationalWarehouseRequests", () => ({ default: () => { f.mounted.push("operational"); return <p>Operational operations</p>; } }));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ warehouseRequestDocuments: { detail: { fetch: f.detail } } }),
  warehouseRequestDocuments: { list: { useQuery: (input: any, options: any) => { f.query.push({ input, options }); return { data: { rows: f.rows, total: f.rows.length, page: input.page, pageSize: 20 }, isLoading: false, refetch: vi.fn() }; } }, recordPrint: { useMutation: () => ({ mutateAsync: f.print }) } },
} }));
import WarehouseRequestsPage from "../../client/src/pages/pmv2/WarehouseRequestsPage";
import WarehouseRequestDocuments, { buildWarehouseRequestHtml } from "../../client/src/pages/pmv2/WarehouseRequestDocuments";
const text = (v: any): string => Array.isArray(v) ? v.map(text).join("") : React.isValidElement(v) ? text((v.props as any).children) : typeof v === "string" ? v : "";
const render = (element = <WarehouseRequestsPage/>) => { f.cursor = 0; f.inputs = []; f.buttons = []; f.tabs = []; return renderToStaticMarkup(element); };
beforeEach(() => { f.search = ""; f.role = "warehouse"; f.language = "ar"; f.cells = []; f.query = []; f.mounted = []; vi.clearAllMocks(); f.rows = [{ id: 100, kind: "delivery", number: "DLV-100", createdAt: "2026-11-07", referenceNumber: "OPR-672", referenceTitle: "إنارة الموقع", itemName: "مصباح", quantity: 2, unit: "حبة", itemCount: 1, recipientName: "المستلم", issuerName: "المصدر", warehouseName: "المخزن", lotCode: "LOT-1", source: "operational" }]; f.detail.mockResolvedValue({ row: f.rows[0], document: { deliveryNumber: "DLV-100", itemName: "مصباح", quantity: 2, deliveredToName: "المستلم", deliveredByName: "المصدر", createdAt: "2026-11-07", poItemId: 0 } }); });
afterEach(() => vi.unstubAllGlobals());
describe("warehouse source operations and existing document panels", () => {
  it.each(["pmv2", "tickets", "operational"])("defaults %s to the unchanged operations and mounts documents only when selected", source => {
    f.search = `?source=${source}&ticketId=12`;
    const html = render(); expect(html).toContain("العمليات"); expect(html).toContain("المستندات");
    expect(f.mounted).toEqual([source]); expect(f.query).toHaveLength(0);
    f.search += "&panel=documents"; f.mounted = []; render();
    expect(f.mounted).toHaveLength(0); expect(f.query[0].input).toMatchObject({ source, sort: "newest", page: 1 });
  });
  it("preserves a ticket deep link when opening documents and clears documents on a source change", () => {
    f.search = "?source=tickets&ticketId=12"; render();
    f.tabs[1].onValueChange("documents"); expect(f.nav).toHaveBeenCalledWith("/scheduled-maintenance/warehouse-requests?source=tickets&ticketId=12&panel=documents");
    f.tabs[0].onValueChange("operational"); expect(f.nav).toHaveBeenLastCalledWith("/scheduled-maintenance/warehouse-requests?source=operational");
  });
  it("shows identifiable card details and passes live ticket/order search to the paginated query", () => {
    let html = render(<WarehouseRequestDocuments source="operational"/>);
    for (const value of ["DLV-100", "OPR-672", "مصباح", "المستلم", "المخزن", "LOT-1"]) expect(html).toContain(value);
    f.inputs.find(p => p.id === "warehouse-document-search").onChange({ target: { value: "672" } }); render(<WarehouseRequestDocuments source="operational"/>);
    expect(f.query.at(-1).input).toMatchObject({ search: "672", page: 1 });
  });
  it("opens details from a fresh source-scoped read and does not print when opening details", async () => {
    render(<WarehouseRequestDocuments source="operational"/>);
    f.buttons.find(p => text(p.children).trim() === "تفاصيل").onClick();
    await vi.waitFor(() => expect(f.detail).toHaveBeenCalledWith({ source: "operational", kind: "delivery", id: 100 }, { staleTime: 0 }));
    expect(f.print).not.toHaveBeenCalled();
    expect(render(<WarehouseRequestDocuments source="operational"/>)).toContain("DLV-100");
  });
  it("prints the existing document with a fresh source check and its scoped counter, without the legacy PO counter", async () => {
    const write = vi.fn(), print = vi.fn();
    const popup = { opener: {}, document: { write, close: vi.fn(), querySelector: () => ({ remove: vi.fn() }), fonts: { ready: Promise.resolve() }, images: [] }, print, focus: vi.fn(), close: vi.fn() };
    vi.stubGlobal("window", { open: () => popup });
    render(<WarehouseRequestDocuments source="operational"/>);
    f.buttons.find(p => text(p.children).trim() === "طباعة").onClick();
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(f.detail).toHaveBeenCalledWith({ source: "operational", kind: "delivery", id: 100 }, { staleTime: 0 });
    expect(f.print).toHaveBeenCalledWith({ source: "operational", kind: "delivery", id: 100 });
    expect(write.mock.calls[0][0]).toContain("DLV-100");
    expect(write.mock.calls[0][0]).not.toContain("purchaseOrders.incrementPrintCount");
  });
  it.each(["technician", "delegate", "accountant", "senior_management", "observer"])("does not enable document reads for %s using an admin projection", role => {
    f.role = role; render(<WarehouseRequestDocuments source="tickets"/>);
    expect(f.query[0].options.enabled).toBe(false);
  });
  it("reuses the current DLV template and original number without issuing another document", async () => {
    const result = await f.detail();
    const html = await buildWarehouseRequestHtml(result.row, result.document);
    expect(html).toContain("DLV-100"); expect(html).toContain("مصباح"); expect(html).toContain("المستلم");
  });
});
