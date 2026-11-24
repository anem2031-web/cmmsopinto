import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatCatalogText,
  getCatalogError,
} from "../../client/src/i18n/catalogUi";

const f = vi.hoisted(() => ({
  name: "Fixture item",
  queries: [] as any[],
  error: null as any,
}));
vi.mock("@/lib/trpc", () => {
  const proxy = (path = ""): any =>
    new Proxy(
      {},
      {
        get(_, key) {
          if (key === "useQuery")
            return (input: any, options: any) => {
              f.queries.push({ path, input, options });
              const data: Record<string, any> = {
                "inventory.bookPages": {
                  pages: [
                    {
                      id: 90,
                      itemName: f.name,
                      warehouseId: 1,
                      quantity: 4,
                      unit: "Piece",
                      isFrozen: 0,
                      movements: { incoming: 5, outgoing: 1 },
                      lots: [
                        {
                          lotId: 6,
                          lotCode: "LOT-6",
                          supplierName: "Supplier fixture",
                          originalQuantity: 5,
                          balanceQuantity: 4,
                          invoiceDate: "2026-11-01",
                          receiptNumber: "RCV-6",
                        },
                      ],
                    },
                  ],
                  master: { id: 7 },
                  nextId: null,
                },
                "inventory.getItemSummary": {
                  itemName: f.name,
                  quantity: 4,
                  unit: "Piece",
                  lastPurchasePrice: 12,
                  internalCode: "INV-7",
                  updatedAt: "2026-11-24",
                },
                "inventory.getPurchaseHistory": [
                  {
                    transactionId: 2,
                    invoiceDate: "2026-11-01",
                    unitCost: 12,
                    quantity: 5,
                    unit: "Piece",
                    vendorName: "Fixture supplier",
                  },
                ],
                "inventory.getLedger": [
                  {
                    transactionId: 3,
                    transactionType: "delivery",
                    inQty: 0,
                    outQty: 1,
                    unit: "Piece",
                    balanceAfter: 4,
                  },
                ],
              };
              return {
                data: data[path],
                error: path === "inventory.bookPages" ? f.error : null,
                isLoading: false,
              };
            };
          return proxy(path ? path + "." + String(key) : String(key));
        },
      }
    );
  return { trpc: proxy() };
});
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: any) => <div>{children}</div>,
  SheetContent: ({ children, dir }: any) => <div dir={dir}>{children}</div>,
  SheetHeader: ({ children }: any) => <header>{children}</header>,
  SheetTitle: ({ children }: any) => <h1>{children}</h1>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children }: any) => <section>{children}</section>,
}));
import { InventoryBookPages } from "../../client/src/components/inventory/InventoryBooks";
import { InventoryItemCard } from "../../client/src/components/inventory/InventoryItemCard";
beforeEach(() => {
  f.name = "Fixture item";
  f.queries = [];
  f.error = null;
});

describe("Catalog static message formatting", () => {
  it("interpolates counts and names once without expanding text entered by users", () => {
    expect(
      formatCatalogText("Move {name}: {count}", {
        name: "{count} $&",
        count: 4,
      })
    ).toBe("Move {count} $&: 4");
    expect(formatCatalogText("{zero} / {missing}", { zero: 0 })).toBe(
      "0 / {missing}"
    );
  });
  it("translates known business constraints without exposing SQL diagnostics", () => {
    expect(
      getCatalogError(
        new Error("صورة الصنف إلزامية؛ يرجى إضافة صورة قبل الحفظ"),
        "en",
        "Save failed"
      )
    ).toContain("image is required");
    expect(
      getCatalogError("لا يمكن الحذف — يوجد 3 تصنيف فرعي مرتبط", "en", "Failed")
    ).toContain("3 child categories");
    expect(
      getCatalogError(
        new Error("Failed query: SELECT secret FROM users"),
        "en",
        "Could not save"
      )
    ).toBe("Could not save");
  });
  it("keeps import validation reasons and row identities in English", () => {
    expect(
      getCatalogError("كود مكرر في الأصناف: 07-001", "en", "Import failed")
    ).toBe("Duplicate item code: 07-001.");
    expect(
      getCatalogError(
        'كود الأب "07" للتصنيف "07-01" غير موجود في الملف (قد يكون موجوداً في قاعدة البيانات)',
        "en",
        "Import failed"
      )
    ).toContain('Parent code "07"');
    expect(
      getCatalogError("الاسم العربي مطلوب للصنف: 07-001", "en", "Import failed")
    ).toContain("Arabic name is required for item 07-001");
  });
  it("preserves dynamic identity values inside a translated message", () => {
    expect(
      getCatalogError(
        "وحدة القياس «قطعة» غير موجودة في تبويب الوحدات",
        "en",
        "Failed"
      )
    ).toBe("Unit “قطعة” does not exist in the Units tab.");
    expect(
      getCatalogError("الكود 07-001 مستخدم مسبقاً", "en", "Failed")
    ).toContain("07-001");
  });
  it("uses the operation fallback for unknown Arabic and keeps existing Arabic wording", () => {
    expect(
      getCatalogError(
        { message: "خطأ جديد غير معروف" },
        "en",
        "Could not import this file"
      )
    ).toBe("Could not import this file");
    expect(
      getCatalogError({ message: "خطأ جديد غير معروف" }, "ar", "Fallback")
    ).toBe("خطأ جديد غير معروف");
    expect(getCatalogError(null, "en", "Retry")).toBe("Retry");
  });
});

describe("Catalog-only opt-in inventory details", () => {
  it("shows English book controls with exactly the original read payload", () => {
    const html = renderToStaticMarkup(
      <InventoryBookPages catalogItemId={7} warehouseId={1} language="en" />
    );
    expect(html).toContain("Detailed movements and documents");
    expect(html).toContain("Warehouse");
    expect(html).toContain("Remaining here");
    expect(html).toContain("Next records");
    expect(html).not.toMatch(/[\u0621-\u064a]/);
    expect(f.queries).toEqual([
      {
        path: "inventory.bookPages",
        input: { catalogItemId: 7, warehouseId: 1, afterId: 0 },
        options: undefined,
      },
    ]);
  });
  it("retains Arabic by default for every other existing inventory caller", () => {
    const html = renderToStaticMarkup(<InventoryBookPages catalogItemId={7} />);
    expect(html).toContain("الحركات والمستندات التفصيلية");
    expect(html).not.toContain("Detailed movements and documents");
  });
  it("keeps master names and units untouched while translating labels", () => {
    f.name = "اسم الصنف الأصلي";
    const html = renderToStaticMarkup(
      <InventoryBookPages catalogItemId={7} language="en" />
    );
    expect(html).toContain("اسم الصنف الأصلي");
    expect(html).toContain("Piece");
    expect(html).toContain("Balance");
  });
  it("localizes an unavailable book without turning a read failure into an empty record", () => {
    f.error = { message: "تعذر الاتصال بقاعدة البيانات" };
    const html = renderToStaticMarkup(
      <InventoryBookPages catalogItemId={7} language="en" />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Unable to connect");
    expect(html).not.toContain("No inventory records");
  });
  it("translates nested history tabs, movement labels and currency without changing query IDs", () => {
    const html = renderToStaticMarkup(
      <InventoryItemCard
        itemId={90}
        open
        onOpenChange={() => {}}
        language="en"
      />
    );
    for (const text of [
      "General information",
      "Receipt history",
      "Movement history",
      "Current balance",
      "Manufacturer barcode",
      "SAR",
      "Issue",
    ])
      expect(html).toContain(text);
    expect(html).not.toMatch(/[\u0621-\u064a]/);
    expect(f.queries.map(q => q.input)).toEqual([
      { id: 90 },
      { id: 90 },
      { id: 90 },
    ]);
  });
});
