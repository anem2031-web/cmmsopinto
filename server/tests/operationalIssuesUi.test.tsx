import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";
import { operationalIssueText } from "../../client/src/i18n/operationalIssues";
import { operationalDispatchText } from "../../client/src/i18n/operationalDispatch";
import { warehouseRequestsSelection } from "../../shared/maintenance-team-tickets/warehouse-navigation";

const state = vi.hoisted(() => ({ language: "ar", role: "maintenance_manager", enabled: true, search: "?source=operational" }));
const dictionaries = { ar, en, ur };
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 10, role: state.role, isActive: 1 } }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: state.language, t: dictionaries[state.language as keyof typeof dictionaries], dir: state.language === "en" ? "ltr" : "rtl" }) }));
vi.mock("../../client/src/components/catalog/CatalogPickerDialog", () => ({ CatalogPickerDialog: () => null }));
vi.mock("wouter", () => ({ useSearch: () => state.search, useLocation: () => ["", vi.fn()] }));
vi.mock("../../client/src/pages/pmv2/Pmv2WarehouseQueue", () => ({ default: () => <p>Existing PMV2 queue</p> }));
vi.mock("../../client/src/pages/maintenance-teams/TicketWarehouseRequests", () => ({ default: () => <p>Existing ticket queue</p> }));
vi.mock("../../client/src/lib/trpc", () => {
  const proxy = (path = ""): any => new Proxy(() => {}, { get(_target, key) {
    if (key === "useUtils") return () => proxy("utils");
    if (key === "useMutation") return () => ({ isPending: false, mutateAsync: vi.fn() });
    if (key === "invalidate" || key === "refetch") return vi.fn();
    if (key === "useQuery") return () => ({ data: path === "operationalIssues.status" ? { enabled: state.enabled }
      : path === "operationalIssues.list" ? { enabled: state.enabled, orders: [{ id: 1, orderNumber: "OPR-TEST-1", status: "pending", collectorName: "Test technician", siteName: "Site", sectionName: "Section" }] }
      : path === "operationalIssues.preparationOptions" ? {ready:true,warehouses:[],sites:[],sections:[]}
      : path === "operationalIssues.stockChoices" ? {items:[],next:null}
      : path === "operationalIssues.choices" ? { collectors: [] } : path === "operationalIssues.detail" ? undefined : [], isLoading: false, error: null, refetch: vi.fn() });
    return proxy(path ? `${path}.${String(key)}` : String(key));
  } });
  return { trpc: proxy() };
});
import OperationalIssues from "../../client/src/pages/operational-issues/OperationalIssues";
import OperationalWarehouseRequests from "../../client/src/pages/operational-issues/OperationalWarehouseRequests";
import WarehouseRequestsPage from "../../client/src/pages/pmv2/WarehouseRequestsPage";

describe("Independent operational issue pages and existing warehouse source tabs", () => {
  it.each(["maintenance_manager", "it_manager", "warehouse", "owner", "admin"].flatMap(role => ["ar", "en", "ur"].map(language => ({ role, language }))))("renders the inventory form and warehouse queue using the program components for $role in $language", ({ role, language }) => {
    state.language = language; state.role = role; state.enabled = true;
    const text = operationalIssueText[language as keyof typeof operationalIssueText];
    const html = renderToStaticMarkup(<OperationalIssues />);
    expect(html).toContain(text.newOrder); expect(html).toContain(text.warehouse);
    expect(html).toContain(operationalDispatchText[language as keyof typeof operationalDispatchText].save); expect(html).toContain("OPR-TEST-1");
    const queue = renderToStaticMarkup(<OperationalWarehouseRequests />); expect(queue).toContain(text.title); expect(queue).toContain("OPR-TEST-1");
  });
  it.each(["observer"])("does not expose order creation to %s", role => {
    state.role = role; state.language = "ar"; state.enabled = true;
    const html = renderToStaticMarkup(<OperationalIssues />);
    expect(html).not.toContain(operationalDispatchText.ar.save); expect(html).toContain("OPR-TEST-1");
  });
  it("does not mount the new form before manual rollout", () => {
    state.role = "maintenance_manager"; state.enabled = false;
    const html = renderToStaticMarkup(<OperationalIssues />);
    expect(html).toContain(operationalIssueText.ar.disabled); expect(html).not.toContain(operationalIssueText.ar.save);
  });
  it("adds the third tab and keeps both existing source selections", () => {
    state.role = "warehouse"; state.enabled = true; state.search = "?source=operational";
    const html = renderToStaticMarkup(<WarehouseRequestsPage />);
    expect((html.match(/role="tab"/g) || []).length).toBe(5);
    expect(html).toContain("OPR-TEST-1");
    expect(warehouseRequestsSelection("?source=tickets&ticketId=12")).toEqual({ source: "tickets", ticketId: 12 });
    expect(warehouseRequestsSelection("").source).toBe("pmv2");
    state.search = "?source=tickets"; expect(renderToStaticMarkup(<WarehouseRequestsPage />)).toContain("Existing ticket queue");
    state.search = ""; expect(renderToStaticMarkup(<WarehouseRequestsPage />)).toContain("Existing PMV2 queue");
  });
});
