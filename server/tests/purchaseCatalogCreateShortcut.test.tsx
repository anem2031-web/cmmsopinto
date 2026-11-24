import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ROLE, canCreateCatalogItem, canCreateCatalogItemFromPurchaseOrder } from "../../shared/roles";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";

const f = vi.hoisted(() => ({
  language: "ar" as "ar" | "en" | "ur",
  open: false,
  queries: [] as any[],
  buttons: [] as any[],
}));
vi.mock("@/lib/trpc", () => ({ trpc: { catalog: Object.fromEntries(["nodes", "items", "units"].map(name => [name, {
  list: { useQuery: (input: any, options: any) => {
    f.queries.push({ name, input, options });
    return { data: [], isFetching: false, error: null, refetch: vi.fn() };
  } },
}])) } }));
vi.mock("@/contexts/LanguageContext", () => ({ useTranslation: () => ({
  language: f.language, t: { ar, en, ur }[f.language], dir: f.language === "en" ? "ltr" : "rtl", isRTL: f.language !== "en",
}) }));
vi.mock("@/components/ui/dialog", () => ({
  useDialogComposition: () => ({ justEndedComposing: () => false, setComposing: () => {}, markCompositionEnd: () => {} }),
  Dialog: ({ open, children }: any) => { f.open = open; return <div>{children}</div>; },
  DialogContent: ({ children, ...props }: any) => <section {...props}>{children}</section>,
  DialogHeader: ({ children, ...props }: any) => <header {...props}>{children}</header>,
  DialogTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
}));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => {
  f.buttons.push(props); return <button {...props}>{children}</button>;
} }));
import { CatalogPickerDialog } from "../../client/src/components/catalog/CatalogPickerDialog";

beforeEach(() => { f.language = "ar"; f.queries = []; f.buttons = []; f.open = false; });
const render = (props: Partial<React.ComponentProps<typeof CatalogPickerDialog>> = {}) => renderToStaticMarkup(
  <CatalogPickerDialog open onClose={vi.fn()} onSelect={vi.fn()} {...props} />
);

describe("Purchase-order Catalog creation shortcut grant", () => {
  it.each(Object.values(APP_ROLE))("restricts the shortcut for active %s without changing the existing Catalog grant", role => {
    const allowed = ["owner", "admin", "construction_procurement_manager"].includes(role);
    expect(canCreateCatalogItemFromPurchaseOrder({ role, isActive: 1 })).toBe(allowed);
    if (allowed) expect(canCreateCatalogItem(role)).toBe(true);
  });
  it.each(["owner", "admin", "construction_procurement_manager"])("requires a current active actor for %s", role => {
    for (const isActive of [0, undefined, null])
      expect(canCreateCatalogItemFromPurchaseOrder({ role, isActive })).toBe(false);
  });
  it("does not infer a write actor from an absent identity or projected observer role", () => {
    expect(canCreateCatalogItemFromPurchaseOrder(undefined)).toBe(false);
    expect(canCreateCatalogItemFromPurchaseOrder(null)).toBe(false);
    expect(canCreateCatalogItemFromPurchaseOrder({ role: "observer", isActive: 1 })).toBe(false);
  });
});

describe("Catalog picker opt-in action and suspension", () => {
  it.each(["ar", "en", "ur"] as const)("places a translated explicit action in the title row in %s", language => {
    f.language = language;
    const onCreateNew = vi.fn();
    const html = render({ onCreateNew });
    const header = html.match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[0] || "";
    expect(header).toContain({ ar, en, ur }[language].workflow.purchase.catalogPickItem);
    expect(header).toContain({ ar, en, ur }[language].workflow.purchase.catalogCreateItem);
    expect(header).toContain("flex-row");
    expect(header).toContain("justify-between");
    expect(html).toContain('dir="' + (language === "en" ? "ltr" : "rtl") + '"');
    const action = f.buttons.find(button => button.onClick === onCreateNew);
    expect(action.type).toBe("button");
    action.onClick(); expect(onCreateNew).toHaveBeenCalledOnce();
  });
  it("leaves other picker consumers without the action by default", () => {
    const html = render();
    expect(html).not.toContain(ar.workflow.purchase.catalogCreateItem);
    expect(f.buttons).toHaveLength(0);
    expect(f.open).toBe(true);
    expect(f.queries.every(q => q.options.enabled === true)).toBe(true);
  });
  it("hides the picker and pauses its three reads while its creation dialog is active", () => {
    render({ suspended: true, onCreateNew: vi.fn() });
    expect(f.open).toBe(false);
    expect(f.queries.map(q => q.name)).toEqual(["nodes", "units", "items"]);
    expect(f.queries.every(q => q.options.enabled === false)).toBe(true);
  });
  it("keeps the existing picker read contract, exact-unit filter and independent transport", () => {
    render({ requiredUnit: "قطعة", onCreateNew: vi.fn() });
    expect(f.queries.find(q => q.name === "items").input).toEqual({ isActive: true, limit: 80, search: undefined, nodeIds: undefined });
    for (const query of f.queries) expect(query.options.trpc.context.independentRead).toBe(true);
  });
});
