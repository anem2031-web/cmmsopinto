import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";

const fixture = vi.hoisted(() => ({
  role: "senior_management", itemActive: 1, queries: [] as Array<{ path: string; input: any; options: any }>,
}));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({
  user: { id: 9, role: fixture.role, isActive: 1 }, loading: false,
}) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ t: ar, language: "ar" }) }));
vi.mock("../../client/src/lib/trpc", () => {
  const proxy = (path = ""): any => new Proxy({}, { get(_, key) {
    if (key === "useMutation") return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
    if (key === "useQuery") return (input: any, options: any) => {
      fixture.queries.push({ path, input, options });
      let data: any;
      if (path === "catalog.items.list") data = [{
        id: 44, nodeId: 7, nameAr: "صنف تجريبي", nameEn: "Fixture item", unit: "قطعة", code: "07-001",
        isActive: fixture.itemActive, primaryImageUrl: "/fixture.webp",
      }];
      if (path === "catalog.nodes.list") data = [{ id: 7, nameAr: "تصنيف", nameEn: "Category", code: "07", level: 1, parentId: null }];
      if (path === "catalog.units.list") data = [{ id: 1, nameAr: "قطعة", isActive: 1 }];
      if (path === "catalog.itemSuppliers.listByItem") data = [{
        id: 4, supplierId: 3, supplierNameAr: "المورد التجريبي", supplierNameEn: "Fixture supplier",
        price: "12", currency: "SAR", isPreferred: false,
      }];
      return { data, isLoading: false, isFetching: false, refetch: vi.fn() };
    };
    return proxy(path ? `${path}.${String(key)}` : String(key));
  } });
  return { trpc: proxy() };
});
vi.mock("../../client/src/components/inventory/InventoryBooks", () => ({ InventoryBookPages: () => null }));
vi.mock("../../client/src/components/catalog/CatalogExportButton", () => ({ default: () => <button>CATALOG_EXPORT</button> }));
vi.mock("../../client/src/components/catalog/CatalogImportButton", () => ({ default: () => <button>CATALOG_IMPORT</button> }));
vi.mock("../../client/src/components/ui/dialog", () => ({
  useDialogComposition: () => ({ justEndedComposing: () => false, setComposing: () => {}, markCompositionEnd: () => {} }),
  Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

import ItemsManager from "../../client/src/components/catalog/ItemsManager";
import { SupplierPickerSection } from "../../client/src/components/catalog/SupplierPicker";

beforeEach(() => { fixture.role = "senior_management"; fixture.itemActive = 1; fixture.queries = []; });

describe("Granted Catalog item controls", () => {
  it("shows senior management full item controls including manual create and duplicate", () => {
    const html = renderToStaticMarkup(<ItemsManager />);
    for (const label of ["استعراض", "تعديل", "تعطيل", "CATALOG_EXPORT", "CATALOG_IMPORT"]) expect(html).toContain(label);
    for (const label of [ar.catalog.items.addNew, ar.catalog.items.addFrom]) expect(html).toContain(label);
    expect(html).not.toContain("إعادة تفعيل");
    expect(fixture.queries.find(query => query.path === "catalog.items.list")?.input.includeInactive).toBe(true);
    expect(fixture.queries.find(query => query.path === "catalog.items.previewNextCode")?.options.enabled).toBe(false);
  });
  it("shows reactivation for a disabled item to senior management", () => {
    fixture.itemActive = 0;
    const html = renderToStaticMarkup(<ItemsManager />);
    expect(html).toContain("معطّل");
    expect(html).toContain("إعادة تفعيل");
  });
  it("adds deactivation to construction while retaining its create/edit and excluding import/export", () => {
    fixture.role = "construction_procurement_manager";
    const html = renderToStaticMarkup(<ItemsManager />);
    for (const label of [ar.catalog.items.addNew, ar.catalog.items.addFrom, "تعديل", "تعطيل"]) expect(html).toContain(label);
    for (const label of ["CATALOG_EXPORT", "CATALOG_IMPORT", "إعادة تفعيل"]) expect(html).not.toContain(label);
  });
  it.each(["owner", "admin"])("preserves full existing item controls for %s", role => {
    fixture.role = role;
    const html = renderToStaticMarkup(<ItemsManager />);
    for (const label of [ar.catalog.items.addNew, ar.catalog.items.addFrom, "تعديل", "تعطيل", "CATALOG_EXPORT", "CATALOG_IMPORT"]) expect(html).toContain(label);
    fixture.itemActive = 0;
    expect(renderToStaticMarkup(<ItemsManager />)).toContain("إعادة تفعيل");
  });
  it("preserves IT manager item controls without import/export", () => {
    fixture.role = "it_manager";
    const html = renderToStaticMarkup(<ItemsManager />);
    for (const label of [ar.catalog.items.addNew, ar.catalog.items.addFrom, "تعديل", "تعطيل"]) expect(html).toContain(label);
    expect(html).not.toContain("CATALOG_EXPORT"); expect(html).not.toContain("CATALOG_IMPORT");
  });
});

describe("Item supplier references and controls", () => {
  it("displays supplier data with no link/remove controls or supplier-search query", () => {
    const html = renderToStaticMarkup(<SupplierPickerSection itemId={44} readOnly />);
    expect(html).toContain("المورد التجريبي");
    expect(html).not.toContain("إضافة مورد"); expect(html).not.toContain('title="إزالة المورد"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="تعيين كمورد أساسي"/);
    expect(fixture.queries.map(query => query.path)).toEqual(["catalog.itemSuppliers.listByItem"]);
  });
  it("shows senior management editable supplier controls when readOnly is not supplied", () => {
    expect(renderToStaticMarkup(<SupplierPickerSection itemId={44} />)).toContain("إضافة مورد");
    expect(renderToStaticMarkup(<SupplierPickerSection itemId={44} />)).toContain('title="إزالة المورد"');
  });
});
