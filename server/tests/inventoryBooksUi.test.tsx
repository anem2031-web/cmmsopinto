import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
const state = vi.hoisted(() => ({
  values: [] as any[],
  index: 0,
  buttons: [] as any[],
  queries: [] as any[],
  error: null as any,
  nextBooksOffset: null as number | null,
}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: any) => {
      const index = state.index++;
      if (!(index in state.values)) state.values[index] = initial;
      return [
        state.values[index],
        (value: any) => {
          state.values[index] =
            typeof value === "function" ? value(state.values[index]) : value;
        },
      ];
    },
  };
});
vi.mock("../../client/src/components/ui/button", async original => {
  const actual = await original<any>();
  return {
    Button: (props: any) => {
      state.buttons.push(props);
      return <actual.Button {...props} />;
    },
  };
});
vi.mock("../../client/src/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock("../../client/src/components/inventory/InventoryItemCard", () => ({
  InventoryItemCard: ({ itemId }: any) => <div>history #{itemId}</div>,
}));
vi.mock("../../client/src/lib/trpc", () => ({
  trpc: {
    inventory: {
      books: {
        useQuery: (input: any) => {
          state.queries.push(input);
          return {
            error: state.error,
            data: {
              books: [
                {
                  id: 9,
                  nameAr: "دجاج 1100 جم",
                  code: "CAT-9",
                  pageCount: 2,
                  linkedWork: input.includeLinkedWork ? [{kind:"ticket",reference:"MT-TEST-1",quantity:2,unit:"حبة",warehouseId:1}] : [],
                  totals: [
                    {
                      unit: "كجم",
                      isFrozen: 1,
                      quantity: 0,
                      incoming: 50,
                      outgoing: 50,
                    },
                    {
                      unit: "حبة",
                      isFrozen: 0,
                      quantity: 13,
                      incoming: 13,
                      outgoing: 0,
                    },
                  ],
                },
              ].flatMap(book => input.groupByWarehouse ? [
                { ...book, warehouseId: 1, warehouseName: "المخزن الرئيسي" },
                { ...book, warehouseId: 2, warehouseName: "مستودع الفرع", totals: [
                  { unit: "حبة", isFrozen: 0, quantity: 21, incoming: 24, outgoing: 3 },
                ] },
              ] : [book]),
              nextId: input.afterId ? null : state.nextBooksOffset,
            },
          };
        },
      },
      bookPages: {
        useQuery: (input: any) => {
          state.queries.push(input);
          return {
            error: state.error,
            data: {
              master: { id: 9, nameAr: "دجاج 1100 جم", unit: "صندوق" },
              pages: [
                {
                  id: 100,
                  itemName: "الاسم القديم",
                  unit: "كجم",
                  quantity: 0,
                  isFrozen: 1,
                  warehouseId: 1,
                  movements: { incoming: 50, outgoing: 50 },
                  lots: [
                    {
                      lotId: 1,
                      lotCode: "LOT-OLD",
                      sourceType: "receipt",
                      receiptItemId: 11,
                      balanceQuantity: 0,
                      originalQuantity: 50,
                      issueUnit: "كجم",
                      supplierName: "مورد قديم",
                      invoiceDate: "2026-08-29",
                    },
                  ],
                },
                {
                  id: 200,
                  itemName: "اسم المورد الجديد",
                  unit: "حبة",
                  quantity: 13,
                  isFrozen: 0,
                  warehouseId: 1,
                  movements: { incoming: 13, outgoing: 0 },
                  lots: [
                    {
                      lotId: 2,
                      lotCode: "LOT-NEW",
                      trackingToken: "new-token",
                      sourceType: "receipt",
                      receiptItemId: 22,
                      balanceQuantity: 13,
                      originalQuantity: 13,
                      issueUnit: "حبة",
                      supplierName: "مورد جديد",
                      invoiceDate: "2026-09-03",
                    },
                  ],
                },
                {
                  id: 300,
                  itemName: "رصيد افتتاحي",
                  unit: "حبة",
                  quantity: 1,
                  isFrozen: 0,
                  warehouseId: 1,
                  movements: { incoming: 1, outgoing: 0 },
                  lots: [
                    {
                      lotId: 3,
                      lotCode: "OPENING",
                      sourceType: "opening_balance",
                      balanceQuantity: 1,
                      originalQuantity: 1,
                      issueUnit: "حبة",
                    },
                  ],
                },
              ],
              nextId: null,
            },
          };
        },
      },
    },
  },
}));
import {
  InventoryBooks,
  InventoryBookPages,
  loadBookLots,
} from "../../client/src/components/inventory/InventoryBooks";
import { InventoryQuantitySummary } from "../../client/src/components/inventory/InventoryQuantitySummary";
beforeEach(() => {
  state.values = [];
  state.index = 0;
  state.buttons = [];
  state.queries = [];
  state.error = null;
  state.nextBooksOffset = null;
});
const render = (node: React.ReactElement) => {
  state.index = 0;
  state.buttons = [];
  return renderToStaticMarkup(node);
};
it("shows one master and independent unit totals; the arrow opens the existing historical pages", () => {
  let html = render(
    <InventoryBooks warehouseId={1} search="اسم قديم" includeZero />
  );
  expect(html).toContain("دجاج 1100 جم");
  expect(html).toContain("تاريخ مجمّد");
  expect(html).not.toContain("LOT-OLD");
  state.buttons
    .find(button => button["aria-label"] === "تفاصيل دفتر دجاج 1100 جم")
    .onClick();
  html = render(
    <InventoryBooks warehouseId={1} search="اسم قديم" includeZero />
  );
  expect(html).toContain("الاسم القديم");
  expect(html).toContain("LOT-OLD");
  expect(html).toContain("مورد جديد");
  expect(state.queries[0]).toMatchObject({
    warehouseId: 1,
    search: "اسم قديم",
    includeZero: true,
  });
});
it("supplier return offers only the selected receipt lot and retains supplier/date details", () => {
  const pick = vi.fn();
  const html = render(
    <InventoryBookPages
      catalogItemId={9}
      warehouseId={1}
      onPick={pick}
      supplierReturn
    />
  );
  expect(html).toContain("تاريخ الشراء");
  expect(html).toContain("مورد قديم");
  expect(html).toContain("مورد جديد");
  const choices = state.buttons.filter(
    button => button.children === "اختيار اللوت"
  );
  expect(choices.map(button => button.disabled)).toEqual([true, false, true]);
  choices[1].onClick();
  expect(pick).toHaveBeenCalledWith(
    expect.objectContaining({
      lot: expect.objectContaining({
        lotCode: "LOT-NEW",
        trackingToken: "new-token",
      }),
      page: expect.objectContaining({ id: 200 }),
    })
  );
});
it("offers printing only when requested and passes the selected lot's own tracking token", () => {
  const print = vi.fn();
  const view = <InventoryBooks layout="table" warehouseId={1} onPrintLot={print} />;
  render(view);
  state.buttons
    .find(button => button["aria-label"] === "تفاصيل دفتر دجاج 1100 جم")
    .onClick();
  render(view);
  const buttons = state.buttons.filter(button => button.children === "عرض / طباعة QR");
  expect(buttons.map(button => button.disabled)).toEqual([true, false, true]);
  buttons[1].onClick();
  expect(print).toHaveBeenCalledWith(expect.objectContaining({
    lot: expect.objectContaining({ lotId: 2, lotCode: "LOT-NEW", trackingToken: "new-token" }),
    page: expect.objectContaining({ id: 200 }),
  }));
  state.values = [];
  render(<InventoryBookPages catalogItemId={9} />);
  expect(state.buttons.some(button => button.children === "عرض / طباعة QR")).toBe(false);
});
it("passes the catalog unit and stock record to the opt-in warehouse unit action", () => {
  const actions = vi.fn(() => <span>إجراء الوحدة</span>);
  const view = (
    <InventoryBooks layout="table" warehouseId={1} renderIssueUnitActions={actions} />
  );
  render(view);
  expect(actions).not.toHaveBeenCalled();
  state.buttons
    .find(button => button["aria-label"] === "تفاصيل دفتر دجاج 1100 جم")
    .onClick();
  expect(render(view)).toContain("إجراء الوحدة");
  expect(actions).toHaveBeenCalledWith(expect.objectContaining({
    id: 200,
    linkedItemId: 9,
    catalogUnit: "صندوق",
  }));
  actions.mockClear();
  state.values = [];
  expect(render(<InventoryBookPages catalogItemId={9} />)).not.toContain("إجراء الوحدة");
  expect(actions).not.toHaveBeenCalled();
});
it("FIFO is an explicit opt-in action for a nonfrozen unit group", () => {
  const fifo = vi.fn();
  render(<InventoryBooks warehouseId={1} onFifo={fifo} />);
  const choices = state.buttons.filter(
    button => button.children === "اختيار الصنف — الأقدم تلقائيًا"
  );
  expect(choices).toHaveLength(1);
  choices[0].onClick();
  expect(fifo).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), "حبة");
  render(<InventoryBooks warehouseId={1} />);
  expect(
    state.buttons.filter(
      button => button.children === "اختيار الصنف — الأقدم تلقائيًا"
    )
  ).toHaveLength(0);
});
it("renders warehouse books as table rows, retaining unit groups and expanding the original lot details", () => {
  const pick = vi.fn();
  const fifo = vi.fn();
  state.nextBooksOffset = 36;
  const view = (
    <InventoryBooks
      layout="table"
      warehouseId={1}
      search="اسم قديم"
      includeZero
      onPick={pick}
      onFifo={fifo}
    />
  );
  let html = render(view);
  expect(html).toContain("<table");
  expect(html).toMatch(/<th[^>]*>م<\/th><th[^>]*>الصنف<\/th>/);
  expect(html).toMatch(/<tr[^>]*><td[^>]*>1<\/td>/);
  for (const label of [
    "الصنف",
    "الكود",
    "الرصيد",
    "الوحدة",
    "الوارد",
    "المنصرف",
    "السجلات",
    "الصرف",
    "CAT-9",
    "تاريخ مجمّد",
    "كجم",
    "حبة",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("LOT-NEW");
  const fifoChoices = state.buttons.filter(
    button => button.children === "صرف بالأقدم"
  );
  expect(fifoChoices).toHaveLength(1);
  fifoChoices[0].onClick();
  expect(fifo).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), "حبة");
  state.buttons
    .find(button => button["aria-label"] === "تفاصيل دفتر دجاج 1100 جم")
    .onClick();
  html = render(view);
  expect(html).toContain('colSpan="9"');
  expect(html).toContain("LOT-OLD");
  expect(html).toContain("LOT-NEW");
  const lots = state.buttons.filter(
    button => button.children === "اختيار اللوت"
  );
  expect(lots[0].disabled).toBe(true);
  lots[1].onClick();
  expect(pick).toHaveBeenCalledWith(
    expect.objectContaining({
      page: expect.objectContaining({ id: 200 }),
      lot: expect.objectContaining({ lotCode: "LOT-NEW" }),
    })
  );
  state.buttons.find(button => button["aria-expanded"] === true).onClick();
  expect(render(view)).not.toContain("LOT-NEW");
  expect(state.queries[0]).toMatchObject({
    warehouseId: 1,
    search: "اسم قديم",
    includeZero: true,
  });
  state.buttons.find(button => button.children === "الدفاتر التالية").onClick();
  expect(render(view)).toMatch(/<tr[^>]*><td[^>]*>37<\/td>/);
  expect(render(React.cloneElement(view, { search: "بحث جديد" }))).toMatch(/<tr[^>]*><td[^>]*>1<\/td>/);
});
it("keeps table read-only without callbacks and preserves the existing card layout by default", () => {
  let html = render(<InventoryBooks layout="table" warehouseId={1} />);
  expect(html).not.toContain("صرف بالأقدم");
  expect(html).not.toContain(">الصرف</th>");
  state.buttons
    .find(button => button["aria-label"] === "تفاصيل دفتر دجاج 1100 جم")
    .onClick();
  html = render(<InventoryBooks layout="table" warehouseId={1} />);
  expect(html).toContain('colSpan="8"');
  expect(html).not.toContain("اختيار اللوت");
  expect(render(<InventoryBooks warehouseId={1} />)).not.toContain("<table");
});
it("keeps the same catalog item in separate warehouse rows and scopes expansion and FIFO to its row", () => {
  const fifo = vi.fn();
  const view = <InventoryBooks layout="table" groupByWarehouse onFifo={fifo} />;
  let html = render(view);
  expect(html).toContain(">المستودع</th>");
  expect(html).toContain("المخزن الرئيسي");
  expect(html).toContain("مستودع الفرع");
  expect(state.queries[0]).toMatchObject({ groupByWarehouse: true });
  expect(state.queries[0].warehouseId).toBeUndefined();
  const choices = state.buttons.filter(button => button.children === "صرف بالأقدم");
  expect(choices).toHaveLength(2);
  choices[1].onClick();
  expect(fifo).toHaveBeenCalledWith(expect.objectContaining({ id: 9, warehouseId: 2 }), "حبة");
  state.buttons.find(button => button["aria-controls"] === "inventory-book-9:2-details").onClick();
  state.queries = [];
  html = render(view);
  expect(html).toContain('<div id="inventory-book-9:2-details">');
  expect(html).not.toContain('<div id="inventory-book-9:1-details">');
  expect(html).toContain('colSpan="10"');
  expect(state.queries).toHaveLength(2);
  expect(state.queries[1]).toMatchObject({ catalogItemId: 9, warehouseId: 2 });
});
it("does not hide a server failure behind an empty result", () => {
  state.error = { message: "database offline" };
  expect(render(<InventoryBooks warehouseId={1} />)).toContain('role="alert"');
});
it("loads subsequent selected-book pages explicitly and never silently truncates the FIFO pool", async () => {
  const read = vi.fn(async (input: any) =>
    input.afterId === 0
      ? {
          pages: [{ id: 1, isFrozen: 0, unit: "حبة", lots: [{ lotId: 1 }] }],
          nextId: 1,
        }
      : {
          pages: [{ id: 2, isFrozen: 1, unit: "كجم", lots: [{ lotId: 2 }] }],
          nextId: null,
        }
  );
  const lots = await loadBookLots(read, 9, 1);
  expect(read).toHaveBeenCalledTimes(2);
  expect(lots).toHaveLength(2);
  expect(lots[1].isFrozen).toBe(1);
  await expect(
    loadBookLots(async () => ({ pages: [], nextId: 1 }), 9, 1)
  ).rejects.toThrow("سجلات كثيرة");
});
it("renders the actual ledger views for isolated visual review without a database", () => {
  const book = (
    <InventoryBooks
      layout="table"
      warehouseId={1}
      onFifo={vi.fn()}
      onPick={vi.fn()}
      supplierReturn
    />
  );
  const collapsed = render(book);
  state.buttons
    .find(button => button["aria-label"] === "تفاصيل دفتر دجاج 1100 جم")
    .onClick();
  const expanded = render(book);
  const quantitySummary = render(
    <InventoryQuantitySummary
      totals={[
        { unit: "قطعة", quantity: 3525 },
        { unit: "كيس", quantity: 76 },
        { unit: "لفة", quantity: 13 },
        { unit: "جالون", quantity: 30 },
        { unit: "باكج", quantity: 13 },
        { unit: "علبة", quantity: 273 },
        { unit: "كرتون", quantity: 34 },
        { unit: "حبة", quantity: 475 },
        { unit: "باكيت", quantity: 11 },
        { unit: "برميل", quantity: 2 },
        { unit: "درزن", quantity: 1 },
        { unit: "م2", quantity: 40 },
        { unit: "رول piece", quantity: 1 },
        { unit: "شيت", quantity: 2 },
        { unit: "كجم", quantity: 8 },
      ]}
    />
  );
  fs.mkdirSync("tools/inventory-books/artifacts", { recursive: true });
  fs.writeFileSync(
    "tools/inventory-books/artifacts/preview.html",
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body class="bg-background text-foreground"><main class="mx-auto max-w-7xl space-y-6 p-5"><h1 class="font-bold text-2xl">دفتر صنف الكتالوج</h1><p class="rounded border bg-amber-50 p-3">معاينة اختبار معزولة — بيانات وهمية، دون اتصال بقاعدة البيانات</p><div class="grid grid-cols-1 md:grid-cols-3 gap-3">${quantitySummary}</div><h2 class="font-bold">الدفتر مغلق — إجماليات منفصلة حسب الوحدة</h2>${collapsed}<h2 class="font-bold">الدفتر مفتوح — السجلات واللوتات واختيار المرتجع</h2>${expanded}</main></body></html>`
  );
});


it("displays the maintenance reference and quantity only when requested by the inventory page", () => {
  const html = render(<InventoryBooks layout="table" warehouseId={1} showLinkedWork />);
  expect(html).toContain("ارتباط الصيانة");
  expect(html).toContain("MT-TEST-1");
  expect(html).toContain("2 حبة");
  expect(state.queries[0].includeLinkedWork).toBe(true);
  state.queries = [];
  expect(render(<InventoryBooks layout="table" warehouseId={1} />)).not.toContain("ارتباط الصيانة");
  expect(state.queries[0].includeLinkedWork).toBeUndefined();
});
