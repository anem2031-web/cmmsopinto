import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ar from "../../client/src/i18n/ar";
import { canDeactivateCatalogItem, canManageCatalogItemLifecycle, canRoleAccessPath, isCatalogAdminRole } from "../../shared/roles";
const fixture = vi.hoisted(() => ({ role: "it_manager", queries: [] as any[], authLoading: false, authenticated: true,
  lifecycle: false, values: [] as any[], stateIndex: 0, effects: [] as Array<() => void> }));
vi.mock("react", async original => {
  const react = await original<typeof import("react")>();
  return { ...react,
    useState: (initial: any) => {
      if (!fixture.lifecycle) return react.useState(initial);
      const index = fixture.stateIndex++;
      if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
      return [fixture.values[index], (value: any) => { fixture.values[index] = typeof value === "function" ? value(fixture.values[index]) : value; }];
    },
    useEffect: (effect: () => void, dependencies: any) => {
      if (fixture.lifecycle) fixture.effects.push(effect);
      else react.useEffect(effect, dependencies);
    },
  };
});
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: fixture.authenticated ? { id: 9, role: fixture.role, isActive: 1 } : null, loading: fixture.authLoading }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ t: ar, language: "ar" }) }));
vi.mock("../../client/src/lib/trpc", () => {
  const proxy = (path = ""): any => new Proxy({}, { get(_, key) {
    if (key === "useQuery") return (_input: any, options: any) => { fixture.queries.push({ path, options }); return { data: undefined }; };
    return proxy(path ? `${path}.${String(key)}` : String(key));
  } }); return { trpc: proxy() };
});
vi.mock("../../client/src/components/catalog/ItemsManager", () => ({ default: () => <p>ITEMS</p> }));
vi.mock("../../client/src/components/catalog/TaxonomyManager", () => ({ default: () => <p>TAXONOMY</p> }));
vi.mock("../../client/src/components/catalog/UnitsManager", () => ({ default: () => <p>UNITS</p> }));
vi.mock("../../client/src/components/catalog/SuppliersManager", () => ({ default: () => <p>SUPPLIERS</p> }));
vi.mock("../../client/src/components/catalog/CatalogItemCandidatesManager", () => ({ default: () => <p>CANDIDATES</p> }));
vi.mock("../../client/src/components/catalog/CatalogSettings", () => ({ default: () => <p>SETTINGS</p> }));
vi.mock("../../client/src/components/catalog/SmartSearch", () => ({ default: () => null }));
vi.mock("../../client/src/components/ui/tabs", () => ({
  Tabs: ({ value, children }: any) => <div data-active-tab={value}>{children}</div>, TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: any) => <button data-tab={value}>{children}</button>,
  TabsContent: ({ value, children }: any) => <section data-content={value}>{children}</section>,
}));
import CatalogDashboard from "../../client/src/pages/catalog/CatalogDashboard";

describe("IT manager item-only Catalog presentation", () => {
  it.each(["owner", "admin", "senior_management"])("preserves the correct initial tab for %s after delayed authentication", role => {
    fixture.lifecycle = true; fixture.values = []; fixture.authenticated = false; fixture.authLoading = true;
    const render = () => {
      fixture.stateIndex = 0; fixture.effects = [];
      const html = renderToStaticMarkup(CatalogDashboard());
      fixture.effects.forEach(effect => effect());
      return html;
    };
    try {
      render();
      fixture.role = role; fixture.authenticated = true; fixture.authLoading = false;
      const resolved = render();
      if (role === "senior_management") {
        expect(resolved).not.toContain('data-content="overview"');
        expect(resolved).not.toContain('data-content="settings"');
        expect(render()).toContain('data-active-tab="items"');
      } else expect(resolved).toContain('data-active-tab="overview"');
    } finally {
      fixture.lifecycle = false; fixture.authenticated = true; fixture.authLoading = false;
    }
  });
  it("preserves senior management Catalog tabs except overview/settings and starts on Items", () => {
    fixture.role = "senior_management"; fixture.queries = [];
    const html = renderToStaticMarkup(<CatalogDashboard />);
    expect(html).toContain('data-tab="items"'); expect(html).toContain("ITEMS");
    expect(html).toContain('data-active-tab="items"');
    for (const tab of ["taxonomy", "units", "suppliers", "new-items"]) {
      expect(html).toContain(`data-tab="${tab}"`); expect(html).toContain(`data-content="${tab}"`);
    }
    for (const tab of ["overview", "settings"]) {
      expect(html).not.toContain(`data-tab="${tab}"`); expect(html).not.toContain(`data-content="${tab}"`);
    }
    expect(html).not.toContain("SETTINGS");
    expect(fixture.queries.find(row => row.path === "catalog.suppliers.stats").options.enabled).toBe(true);
    expect(canRoleAccessPath("senior_management", "/catalog")).toBe(true);
    expect(isCatalogAdminRole("senior_management")).toBe(true);
    expect(canManageCatalogItemLifecycle("senior_management")).toBe(true);
  });
  it("shows items and does not mount other catalog modules or their supplier stats request", () => {
    fixture.role = "it_manager"; fixture.queries = [];
    const html = renderToStaticMarkup(<CatalogDashboard />);
    expect(html).toContain('data-tab="items"'); expect(html).toContain("ITEMS");
    for (const tab of ["overview", "taxonomy", "units", "suppliers", "new-items", "settings"]) {
      expect(html).not.toContain(`data-tab="${tab}"`); expect(html).not.toContain(`data-content="${tab}"`);
    }
    expect(fixture.queries.find(row => row.path === "catalog.suppliers.stats").options.enabled).toBe(false);
    expect(canRoleAccessPath("it_manager", "/catalog")).toBe(true);
    expect(canDeactivateCatalogItem("it_manager")).toBe(true);
    expect(canManageCatalogItemLifecycle("it_manager")).toBe(false);
    expect(isCatalogAdminRole("it_manager")).toBe(false);
    const source = readFileSync("client/src/components/catalog/ItemsManager.tsx", "utf8");
    expect(source).toContain("canDelete={canDeactivateCatalogItem(user?.role)}");
    expect(source).toContain("canReactivate={isCatalogAdmin || canManageLifecycle}");
  });
  it.each(["owner", "admin", "maintenance_manager", "warehouse"])("preserves %s catalog tabs and existing lifecycle controls", role => {
    fixture.role = role;
    const html = renderToStaticMarkup(<CatalogDashboard />);
    for (const tab of ["taxonomy", "items", "units", "suppliers", "new-items"]) expect(html).toContain(`data-tab="${tab}"`);
    expect(html.includes('data-tab="overview"')).toBe(isCatalogAdminRole(role));
    expect(html.includes('data-tab="settings"')).toBe(isCatalogAdminRole(role));
    expect(canManageCatalogItemLifecycle(role)).toBe(true);
  });
  it.each(["it_member", "technician", "operator", "accountant", "delegate"])("does not grant %s catalog or item deactivation access", role => {
    expect(canRoleAccessPath(role, "/catalog")).toBe(false);
    expect(canDeactivateCatalogItem(role)).toBe(false);
  });
});
