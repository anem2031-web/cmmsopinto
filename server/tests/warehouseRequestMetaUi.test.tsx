import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";
const state = vi.hoisted(() => ({ language: "en", section: "waiting", creator: "Original creator", sentAt: "2026-11-05 09:15:00" }));
vi.mock("react", async load => ({ ...await load<typeof import("react")>(), useState: (initial: any) => [initial === "waiting" ? state.section : initial, vi.fn()] }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 2, role: "warehouse", isActive: 1 }, loading: false }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: state.language, dir: "ltr", t: ({ar,en,ur} as any)[state.language] }) }));
vi.mock("wouter", () => ({ useLocation: () => ["", vi.fn()] }));
vi.mock("../../client/src/pages/maintenance-teams/ExecutionPanel", () => ({ ExecutionPanel: () => <p>UNCHANGED-EXECUTION</p> }));
vi.mock("../../client/src/components/catalog/MaterialIdentityDialog", () => ({ MaterialIdentityDialog: () => null }));
vi.mock("../../client/src/components/inventory/WarehouseLotSelection", () => ({ WarehouseLotSelection: () => null }));
vi.mock("../../client/src/pages/operational-issues/OperationalStockPanel", () => ({ OperationalStockPanel: () => null }));
vi.mock("../../client/src/pages/operational-issues/PreparedDispatchPanel", () => ({ PreparedDispatchPanel: () => null }));
vi.mock("../../client/src/lib/trpc", () => {
  const proxy = (path = ""): any => new Proxy(() => {}, { get: (_, key) => {
    if (key === "useUtils") return () => proxy("utils");
    if (key === "useMutation") return () => ({ isPending: false, mutate: vi.fn() });
    if (key === "useQuery") return () => {
      const meta = { requestCreatorName: state.creator, requestCreatedAt: state.sentAt };
      const data = path === "pmv2.warehouse.waitingMaterialQueue" ? { total: 1, mainWarehouse: { nameAr: "Main" }, items: [{ ...meta, requestId: 1, requestItemId: 10, itemNameSnapshot: "Material", requestedQuantity: 2, remainingQuantity: 2, availabilityStatus: "unlisted", purchaseLinks: [] }] }
        : path === "pmv2.warehouse.readyToIssueQueue" ? [{ ...meta, routeDecisionActionId: 12, itemName: "Material", canIssue: false, remainingQuantity: 2, technicians: [], fulfillmentAllocations: [], lotAllocations: [] }]
        : path === "ticketTeamAssignments.warehouseRequests" ? [{ assignmentId: 1, ticketId: 11, ticketNumber: "MT-11", materialNeeds: [{ ...meta, needId: 10, name: "Material", unit: "piece", section: state.section }] }]
        : path === "operationalIssues.list" ? { enabled: true, orders: [{ id: 1, orderNumber: "OPR-1", creatorName: state.creator, createdAt: state.sentAt, collectorName: "Different recipient", status: "pending" }] }
        : path === "operationalIssues.detail" ? undefined : [];
      return { data, isLoading: false, isFetching: false, refetch: vi.fn() };
    };
    return proxy(path ? `${path}.${String(key)}` : String(key));
  } });
  return { trpc: proxy() };
});
import { MaterialRequestMeta } from "../../client/src/components/inventory/MaterialRequestMeta";
import TicketWarehouseRequests from "../../client/src/pages/maintenance-teams/TicketWarehouseRequests";
import Pmv2WarehouseQueue from "../../client/src/pages/pmv2/Pmv2WarehouseQueue";
import { OperationalIssueQueue } from "../../client/src/pages/operational-issues/OperationalIssueQueue";
beforeEach(() => Object.assign(state, { language: "en", section: "waiting", creator: "Original creator", sentAt: "2026-11-05 09:15:00" }));
describe("request identity and original sending time on warehouse cards", () => {
  it.each(["waiting", "ready", "returns"])("shows the ticket material author and original request time in %s", section => {
    state.section = section;
    const html = renderToStaticMarkup(<TicketWarehouseRequests />);
    expect(html).toContain("Original creator"); expect(html).toContain("12:15"); expect(html).toContain("UNCHANGED-EXECUTION");
  });
  it.each(["waiting", "ready"])("shows PMV2 request metadata outside the collapsed %s details", section => {
    state.section = section;
    const html = renderToStaticMarkup(<Pmv2WarehouseQueue />);
    expect(html).toContain("Original creator"); expect(html).toContain("12:15");
    expect(html.indexOf("Original creator")).toBeLessThan(html.indexOf("<details"));
  });
  it("shows the operational creator separately from the recipient", () => {
    const html = renderToStaticMarkup(<OperationalIssueQueue process />);
    expect(html).toContain("Original creator"); expect(html).toContain("Different recipient"); expect(html).toContain("12:15");
    expect(renderToStaticMarkup(<OperationalIssueQueue />)).not.toContain("Sent at (Riyadh)");
  });
  it.each(["ar", "en", "ur"])("formats SQL UTC and offset instants consistently in %s", language => {
    const sql = renderToStaticMarkup(<MaterialRequestMeta creatorName="Creator" sentAt="2026-11-05 09:15:00" language={language} />);
    expect(sql).toEqual(renderToStaticMarkup(<MaterialRequestMeta creatorName="Creator" sentAt="2026-11-05T12:15:00+03:00" language={language} />));
  });
  it("keeps unknown historical values unavailable without inventing a current timestamp", () => {
    const html = renderToStaticMarkup(<MaterialRequestMeta sentAt="invalid" language="en" />);
    expect(html.match(/—/g)).toHaveLength(2); expect(html).not.toContain("Invalid Date");
  });
});

describe("purchase cycle warehouse tab visibility", () => {
  const source = readFileSync("client/src/pages/purchase/PurchaseCycle.tsx", "utf8");
  const ast = ts.createSourceFile("cycle.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let list: ts.JsxElement; let flag = "";
  const contentGuards: string[] = [];
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "showDeliveryDocuments") flag = n.initializer!.getText(ast);
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "TabsList") list = n;
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "TabsContent" && /value="(?:delivery|documents)"/.test(n.openingElement.getText(ast))) contentGuards.push(n.parent.getText(ast));
    ts.forEachChild(n, visit);
  }
  visit(ast);
  it.each(["warehouse", "admin", "owner", "delegate", "delegate_manager"])("renders the actual navigation for %s", role => {
    const isAdminOrOwner = ["owner", "admin"].includes(role), isDelegate = isAdminOrOwner || ["delegate", "delegate_manager"].includes(role), isWarehouse = isAdminOrOwner || role === "warehouse";
    const showDeliveryDocuments = vm.runInNewContext(flag, { role, isWarehouse });
    const textProxy: any = new Proxy(() => {}, { get: (_, key) => String(key), apply: () => "" });
    const t = { purchaseOrders: textProxy, workflow: { purchase: textProxy } };
    const exports: any = {};
    const code = ts.transpileModule(`export function nav(){return (${list!.getText(ast)});}`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { exports, React, t, isAdminOrOwner, isDelegate, isWarehouse, role, showDeliveryDocuments,
      pendingEstimate: [], pendingPurchase: [], pendingWarehouse: [], groupedByInvoiceNumber: {}, pendingDelivery: [], inventoryItems: [],
      TabsList: (p: any) => <div {...p} />, TabsTrigger: (p: any) => <button {...p} />, Badge: () => null,
      Clock: () => null, ShoppingCart: () => null, Package: () => null, Archive: () => null, Truck: () => null, FileText: () => null });
    const html = renderToStaticMarkup(exports.nav());
    expect(html.includes('value="delivery"')).toBe(isAdminOrOwner); expect(html.includes('value="documents"')).toBe(isAdminOrOwner);
    expect(html.includes('value="warehouse"')).toBe(isWarehouse); expect(html.includes('value="inventory-entry"')).toBe(isWarehouse);
    if (role === "warehouse") expect(html).toContain("grid-cols-2");
  });
  it("also gates the actual content and its read queries", () => {
    expect(contentGuards).toHaveLength(2); contentGuards.forEach(guard => expect(guard).toMatch(/^showDeliveryDocuments &&/));
    expect(source).toMatch(/deliveryDocsQuery = .*useQuery\(undefined, \{ enabled: showDeliveryDocuments \}\)/);
    expect(source).toMatch(/returnDocsQuery = .*useQuery\(undefined, \{ enabled: showDeliveryDocuments \}\)/);
  });
});
