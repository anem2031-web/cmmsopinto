import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { APP_ROLE, canRoleAccessPath } from "../../shared/roles";
import { isObserver } from "../../shared/observer-policy";
import { canAccessReturnsCenter, getReturnsCenterPanels, RETURNS_CENTER_PATH, RETURNS_CENTER_SUPPLIER_ROLES, returnsCenterLink } from "../../shared/returns-center";
import { returnsCenterLabels } from "../../client/src/i18n/returnsCenter";

const state = vi.hoisted(() => ({ actor: { id: 7, role: "warehouse", isActive: 1 } as any,
  loading: false, language: "ar", search: "", location: "/returns-center", calls: [] as any[], navigation: [] as string[],
  cells: [] as any[], cursor: 0, key: null as string | null, buttons: [] as any[], inputs: [] as any[],
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: any) => {
  const index = state.cursor++;
  if (!(index in state.cells)) state.cells[index] = typeof initial === "function" ? initial() : initial;
  return [state.cells[index], (next: any) => { state.cells[index] = typeof next === "function" ? next(state.cells[index]) : next; }];
} }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ authenticatedUser: state.actor, user: { id: 99, role: "owner", isActive: 1 }, loading: state.loading }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: state.language, dir: state.language === "en" ? "ltr" : "rtl" }) }));
vi.mock("wouter", () => ({ useSearch: () => state.search, useLocation: () => [state.location, (url: string) => {
  state.navigation.push(url); state.location = url.split("?")[0]; state.search = url.split("?")[1] || "";
}] }));
vi.mock("../../client/src/components/ui/button", () => ({ Button: ({ variant: _variant, ...props }: any) => { state.buttons.push(props); return <button {...props} />; } }));
vi.mock("../../client/src/components/ui/input", () => ({ Input: (props: any) => { state.inputs.push(props); return <input {...props} />; } }));
vi.mock("../../client/src/components/purchase/SupplierReturns", () => ({ SupplierReturns: (props: any) => { state.calls.push({ component: "suppliers", props }); return <div>Existing supplier actions</div>; } }));
vi.mock("../../client/src/components/purchase/PurchaseSpecifications", () => ({ RejectedSpecificationReturns: (props: any) => { state.calls.push({ component: "specifications", props }); return <div>Existing rejected specifications</div>; } }));
vi.mock("../../client/src/components/inventory/WarehouseReturnDocuments", () => ({ WarehouseReturnDocuments: (props: any) => { state.calls.push({ component: "documents", props }); return <div>Existing return documents</div>; } }));
vi.mock("../../client/src/pages/pmv2/Pmv2WarehouseQueue", () => ({ default: (props: any) => { state.calls.push({ component: "pmv2", props }); return <div>Existing PMV2 returns</div>; } }));
vi.mock("../../client/src/pages/maintenance-teams/TicketWarehouseRequests", () => ({ default: (props: any) => { state.calls.push({ component: "tickets", props }); return <div>Existing ticket returns</div>; } }));
vi.mock("../../client/src/pages/operational-issues/OperationalWarehouseRequests", () => ({ default: (props: any) => { state.calls.push({ component: "operational", props }); return <div>Existing operational returns</div>; } }));

import ReturnsCenter, { ReturnsCenterContent, returnsCenterSelection } from "../../client/src/pages/returns/ReturnsCenter";

function elements(tree: any, match: (node: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, match));
  return [...(match(tree) ? [tree] : []), ...elements(tree.props?.children, match)];
}

function render() {
  const tree = ReturnsCenter();
  const content = elements(tree, node => node.type === ReturnsCenterContent)[0];
  // Match React's keyed subtree lifetime while exercising the actual page tree.
  if ((content?.key ?? null) !== state.key) { state.cells = []; state.key = content?.key ?? null; }
  state.cursor = 0; state.calls = []; state.buttons = []; state.inputs = [];
  return { tree, html: renderToStaticMarkup(tree), content };
}

beforeEach(() => {
  state.actor = { id: 7, role: "warehouse", isActive: 1 }; state.loading = false; state.language = "ar";
  state.search = ""; state.location = "/returns-center"; state.calls = []; state.navigation = [];
  state.cells = []; state.cursor = 0; state.key = null; state.buttons = []; state.inputs = [];
});

describe("Returns center: actual active identity and selected-source composition", () => {
  const supplierRoles = ["owner", "admin", "warehouse", "delegate", "delegate_manager", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "it_manager", "purchase_manager", "accountant", "senior_management", "executive_director", "user", "operator", "supervisor", "purchase_requester", "food_warehouse_manager", "food_warehouse_assistant"];
  it.each(Object.values(APP_ROLE))("shows only existing permitted panels for %s and mounts one source", role => {
    state.actor.role = role;
    const { tree, html } = render();
    const expected = [...(supplierRoles.includes(role) ? ["suppliers"] : []), ...(["warehouse", "admin", "owner"].includes(role) ? ["materials", "specifications"] : []), ...(["warehouse", "admin", "owner", "senior_management"].includes(role) ? ["documents"] : [])];
    expect(elements(tree, node => node.props?.role === "tab").map(node => node.props.id)).toEqual(expected.map(panel => `returns-tab-${panel}`));
    expect(state.calls).toHaveLength(expected.length ? 1 : 0);
    expect(html.includes("Existing supplier actions")).toBe(expected.includes("suppliers"));
    expect(elements(tree, node => node.props?.children?.includes?.(returnsCenterLabels("ar").newReturn)).length > 0).toBe(["warehouse", "admin", "owner"].includes(role));
  });
  it.each([{ role: "warehouse", isActive: 0 }, { role: "owner", isActive: false }, { role: "observer", isActive: 1 }, null])("does not mount a hidden source through projected owner or inactive identity: %j", actor => {
    state.actor = actor; state.search = "tab=materials&source=pmv2";
    expect(render().html).toContain(returnsCenterLabels("ar").forbidden);
    expect(state.calls).toEqual([]); expect(state.inputs).toEqual([]);
  });
  it("waits for actual authentication without issuing any child read", () => {
    state.loading = true;
    expect(render().html).toContain(returnsCenterLabels("ar").loading);
    expect(state.calls).toEqual([]);
  });
  it.each([
    ["tab=suppliers", "suppliers", { centerMode: true, search: "" }],
    ["tab=specifications", "specifications", { centerMode: true, search: "" }],
    ["tab=documents", "documents", { category: "all", search: "" }],
    ["tab=materials&source=tickets", "tickets", { section: "returns", embedded: true, search: "" }],
    ["tab=materials&source=pmv2", "pmv2", { section: "returns", embedded: true, search: "" }],
    ["tab=materials&source=operational", "operational", { returnsOnly: true, embedded: true, search: "" }],
  ])("mounts only the existing return screen for %s with presentation-only props", (search, component, props) => {
    state.search = search as string; render();
    expect(state.calls).toEqual([{ component, props }]);
    expect(state.navigation).toEqual([]);
  });
  it("sanitizes unavailable tabs and unrelated deep-link context before mounting a source", () => {
    state.actor.role = "accountant"; state.search = "tab=materials&source=operational&ticketId=999&itemId=456";
    expect(render().html).toContain("Existing supplier actions");
    expect(state.calls).toEqual([{ component: "suppliers", props: { centerMode: true, search: "" } }]);
    state.actor.role = "warehouse"; state.search = "tab=materials&source=unknown&ticketId=999"; render();
    expect(state.calls).toEqual([{ component: "tickets", props: { section: "returns", embedded: true, search: "" } }]);
    expect(returnsCenterSelection("tab=javascript:bad&source=pmv2", getReturnsCenterPanels("warehouse"))).toEqual({ panel: "suppliers", source: "pmv2" });
    expect(returnsCenterSelection("tab=documents", [])).toEqual({ panel: undefined, source: "tickets" });
  });
  it("sends search immediately without a minimum length and resets it when section, source or identity changes", () => {
    render();
    for (const value of ["ب", "Bolt", ""]) {
      state.inputs[0].onChange({ target: { value } }); render();
      expect(state.calls[0].props.search).toBe(value);
    }
    state.inputs[0].onChange({ target: { value: "قديم" } }); render();
    state.search = "tab=materials&source=tickets"; const ticketKey = render().content.key;
    expect(state.calls[0].props.search).toBe("");
    state.inputs[0].onChange({ target: { value: "مسمار" } }); render();
    state.search = "tab=materials&source=pmv2"; const pmv2Key = render().content.key;
    expect(pmv2Key).not.toBe(ticketKey); expect(state.calls[0].props.search).toBe("");
    state.search = "tab=materials&source=tickets"; render();
    expect(state.calls[0].props.search).toBe("");
    state.inputs[0].onChange({ target: { value: "ABC" } }); render();
    state.actor = { id: 8, role: "warehouse", isActive: 1 }; render();
    expect(state.calls[0].props.search).toBe("");
    state.inputs[0].onChange({ target: { value: "ABC" } }); render();
    state.actor.role = "owner"; render();
    expect(state.calls[0].props.search).toBe("");
  });
  it("clears search explicitly and explains current-page search instead of claiming all-record search", () => {
    render(); state.inputs[0].onChange({ target: { value: "ب" } });
    expect(render().html).toContain(returnsCenterLabels("ar").searchHint);
    state.buttons.find(button => button.children === returnsCenterLabels("ar").clearSearch).onClick();
    render(); expect(state.calls[0].props.search).toBe("");
  });
  it("uses safe deep links and drops stale ticket/item context when switching sections", () => {
    state.search = "tab=materials&source=tickets&ticketId=123&itemId=5";
    const { tree } = render();
    elements(tree, node => node.props?.id === "returns-tab-documents")[0].props.onClick();
    expect(state.navigation.at(-1)).toBe(returnsCenterLink("documents"));
    const next = render();
    expect(state.calls[0].component).toBe("documents");
    elements(next.tree, node => node.props?.id === "returns-tab-materials")[0].props.onClick(); render();
    state.buttons.find(button => button.children === returnsCenterLabels("ar").sources.operational).onClick();
    expect(state.navigation.at(-1)).toBe("/returns-center?tab=materials&source=operational");
  });
  it("has one new-return navigation with the selected center context and no automatic mutation", () => {
    state.search = "tab=documents"; render();
    const create = state.buttons.filter(button => Array.isArray(button.children) && button.children.includes(returnsCenterLabels("ar").newReturn));
    expect(create).toHaveLength(1); expect(state.navigation).toEqual([]);
    create[0].onClick();
    expect(state.navigation).toEqual(["/warehouse/return?returnTo=returns-center&returnTab=documents"]);
  });
  it("filters existing documents locally by type without changing reads or other panels", () => {
    state.search = "tab=documents";
    for (const category of ["supplier", "recipient", "all"]) {
      const result = render(); state.cursor = 0;
      const select = elements(ReturnsCenterContent(result.content.props), node => node.type === "select")[0];
      select.props.onChange({ target: { value: category } }); render();
      expect(state.calls).toEqual([{ component: "documents", props: { category, search: "" } }]);
    }
    state.search = "tab=suppliers";
    const result = render(); state.cursor = 0;
    expect(elements(ReturnsCenterContent(result.content.props), node => node.type === "select")).toEqual([]);
  });
  it("resets the document category when leaving its panel or changing actual identity", () => {
    state.search = "tab=documents";
    const chooseSupplier = () => {
      const result = render(); state.cursor = 0;
      elements(ReturnsCenterContent(result.content.props), node => node.type === "select")[0].props.onChange({ target: { value: "supplier" } });
      render(); expect(state.calls[0].props.category).toBe("supplier");
    };
    chooseSupplier(); state.search = "tab=suppliers"; render(); state.search = "tab=documents"; render();
    expect(state.calls[0].props.category).toBe("all");
    chooseSupplier(); state.actor.id = 8; render();
    expect(state.calls[0].props.category).toBe("all");
  });
  it.each(["ar", "en", "ur"])("localizes the center chrome with a bounded mobile tab grid: %s", language => {
    state.language = language;
    const { tree, html } = render(), labels = returnsCenterLabels(language);
    expect(html).toContain(labels.title); expect(html).toContain(labels.panels.documents.title);
    expect(html).toContain(labels.searchHint);
    const nav = elements(tree, node => node.props?.role === "tablist")[0];
    expect(nav.props.className).toContain("grid-cols-1"); expect(nav.props.className).not.toContain("overflow-x-auto");
    expect(elements(tree, node => node.props?.role === "tab")).toHaveLength(4);
  });
});

describe("Actual sidebar and direct layout expressions keep the new center outside observer projection", () => {
  const file = ts.createSourceFile("DashboardLayout.tsx", readFileSync("client/src/components/layout/DashboardLayout.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = new Map<string, string>(), declarations = new Map<string, string>(), icons: Record<string, () => null> = {};
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.initializer) values.set(node.name.getText(file), node.initializer.getText(file));
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(file));
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === "icon" && ts.isIdentifier(node.initializer)) icons[node.initializer.text] = () => null;
    ts.forEachChild(node, find);
  }
  find(file);
  function sidebar(actualRole: string, projectedRole: string, location = RETURNS_CENTER_PATH) {
    const code = `(() => {
      ${["canSeeItem", "canSeeSection", "getNestedValue"].map(name => declarations.get(name)).join("\n")}
      const NAV_SECTIONS = ${values.get("NAV_SECTIONS")};
      const role = ${values.get("role")};
      const returnsCenterAccess = ${values.get("returnsCenterAccess")};
      const canAccessCurrentPath = ${values.get("canAccessCurrentPath")};
      const permittedSections = ${values.get("permittedSections")};
      return { returnsCenterAccess, canAccessCurrentPath, paths: permittedSections.flatMap(section => section.items.map(item => item.path)) };
    })()`;
    return vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      { ...icons, user: { id: 7, role: projectedRole }, authenticatedUser: { id: 7, role: actualRole }, location,
        authLoading: false, t: {}, useMemo: (work: any) => work(), approvedDocumentsAccess: false,
        approvedPricingDocumentPageAllowed: () => false, isObserver, canRoleAccessPath, canAccessReturnsCenter, RETURNS_CENTER_PATH, RETURNS_CENTER_SUPPLIER_ROLES });
  }
  it("hides only the new center for an actual observer projected as admin, without removing legacy navigation or archive access", () => {
    const observer = sidebar("observer", "admin"), admin = sidebar("admin", "admin");
    expect(observer.returnsCenterAccess).toBe(false); expect(observer.canAccessCurrentPath).toBe(false);
    expect(observer.paths).not.toContain(RETURNS_CENTER_PATH);
    expect(observer.paths).toEqual(admin.paths.filter((path: string) => path !== RETURNS_CENTER_PATH));
    expect(observer.paths).toContain("/inventory"); expect(observer.paths).toContain("/purchase-orders");
    expect(sidebar("observer", "admin", "/warehouse/returns").canAccessCurrentPath).toBe(true);
    expect(sidebar("observer", "admin", "/returns-center?tab=documents").canAccessCurrentPath).toBe(false);
  });
  it.each(["owner", "admin", "warehouse"])("keeps the real %s center menu and direct route available", role => {
    const actual = sidebar(role, role, "/returns-center?tab=materials&source=pmv2");
    expect(actual.returnsCenterAccess).toBe(true); expect(actual.canAccessCurrentPath).toBe(true);
    expect(actual.paths.filter((path: string) => path === RETURNS_CENTER_PATH)).toHaveLength(1);
  });
});
