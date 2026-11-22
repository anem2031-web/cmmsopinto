import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { operationalDispatchText } from "../../client/src/i18n/operationalDispatch";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";
const state = vi.hoisted(() => ({
  language: "ar",
  role: "warehouse",
  hookMode: false,
  cursor: 0,
  states: [] as any[],
  refs: [] as any[],
  refCursor: 0,
  calls: [] as any[],
  ready: true,
  linkedWork: [] as any[],
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<any>("react");
  return {
    ...actual,
    useState: (initial: any) => {
      if (!state.hookMode) return actual.useState(initial);
      const index = state.cursor++;
      if (!(index in state.states))
        state.states[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        state.states[index],
        (value: any) => {
          state.states[index] =
            typeof value === "function" ? value(state.states[index]) : value;
        },
      ];
    },
    useRef: (initial: any) => {
      if (!state.hookMode) return actual.useRef(initial);
      const index = state.refCursor++;
      return state.refs[index] ?? (state.refs[index] = { current: initial });
    },
  };
});
vi.mock("../../client/src/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 20, role: state.role, isActive: 1 } }),
}));
const dictionaries = { ar, en, ur };
vi.mock("../../client/src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    language: state.language,
    t: dictionaries[state.language as keyof typeof dictionaries],
    dir: state.language === "en" ? "ltr" : "rtl",
  }),
}));
vi.mock("../../client/src/components/catalog/CatalogPickerDialog", () => ({
  CatalogPickerDialog: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../client/src/lib/trpc", () => {
  const proxy = (path = ""): any =>
    new Proxy(() => {}, {
      get(_target, key) {
        if (key === "useUtils") return () => proxy("utils");
        if (key === "invalidate") return vi.fn(async () => {});
        if (key === "query" && path.endsWith("operationalIssues.preparedSelection")) return async (input: any) => input.catalogItemIds.map((id: number) => ({ itemId: id, linkedWork: state.linkedWork }));
        if (key === "useMutation")
          return () => ({
            isPending: false,
            mutateAsync: async (input: any) => {
              state.calls.push({ path, input });
              return { id: 1 };
            },
          });
        if (key === "useQuery")
          return (input: any) => ({
            isLoading: false,
            isFetching: false,
            isError: false,
            error: null,
            data: path.endsWith("preparationOptions")
              ? {
                  ready: state.ready,
                  warehouses: [{ id: 1, nameAr: "الرئيسي" }],
                  sites: [{ id: 1, name: "موقع" }],
                  sections: [{ id: 2, siteId: 1, name: "قسم" }],
                }
              : path.endsWith("choices")
                ? {
                    collectors: [
                      { id: 101, name: "الفني المحدد" },
                      { id: 102, name: "المستلم البديل" },
                    ],
                  }
                : path.endsWith("preparedSelection")
                  ? (input.catalogItemIds || []).map((id: number) => ({
                      itemId: id,
                      unit: "حبة",
                      totalQuantity: 10,
                      needsReview: false,
                      linkedWork: state.linkedWork,
                      lots: [
                        {
                          lotId: id,
                          inventoryId: id,
                          lotCode: `LOT${id}`,
                          quantity: 10,
                          receivedAt: "2026-01-01",
                        },
                      ],
                    }))
                  : path.endsWith("stockChoices")
                    ? { items: [], next: null }
                    : [],
          });
        return proxy(path ? `${path}.${String(key)}` : String(key));
      },
    });
  return { trpc: proxy() };
});
import { PreparedIssueForm } from "../../client/src/pages/operational-issues/PreparedIssueForm";
import { PreparedDispatchPanel } from "../../client/src/pages/operational-issues/PreparedDispatchPanel";
const context = {
  version: 1,
  warehouseId: 1,
  warehouseName: "الرئيسي",
  siteId: 1,
  siteName: "الموقع",
  sectionId: 2,
  sectionName: "القسم",
  collectorId: 101,
  collectorName: "الفني المحدد",
  source: "inventory",
};
const props = () => ({
  order: {
    id: 1,
    orderNumber: "OPR-1",
    status: "approved",
    revision: 1,
  } as any,
  lines: [1, 2].map(
    id =>
      ({
        id,
        catalogItemId: id,
        itemName: `صنف ${id}`,
        quantity: 2,
        issuedQuantity: 0,
        unit: "حبة",
        dispatchContext: context,
      }) as any
  ),
  stocks: [1, 2].map(
    id =>
      ({
        itemId: id,
        totalQuantity: 10,
        unit: "حبة",
        needsReview: false,
        purchase: null,
        lots: [
          {
            lotId: id,
            inventoryId: id,
            lotCode: `LOT${id}`,
            quantity: 10,
            receivedAt: "2026-01-01",
          },
        ],
      }) as any
  ),
  canProcess: true,
  loading: false,
  procurementReady: true,
  dispatch: [],
  refresh: vi.fn(async () => {}),
});
function tree(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(tree);
  if (typeof node !== "object") return [];
  return [node, ...tree(node.props?.children)];
}
const find = (node: any, check: (el: any) => boolean) => tree(node).find(check);
const render = (component: () => any) => {
  state.cursor = 0;
  state.refCursor = 0;
  return component();
};
beforeEach(() => {
  state.language = "ar";
  state.role = "warehouse";
  state.ready = true;
  state.linkedWork = [];
  state.hookMode = false;
  state.cursor = 0;
  state.refCursor = 0;
  state.states = [];
  state.refs = [];
  state.calls = [];
});
describe("Operational UI", () => {
  it.each(["ar", "en", "ur"])(
    "renders one confirmation for multiple items and optional notes/recipient in %s",
    language => {
      state.language = language;
      const html = renderToStaticMarkup(<PreparedDispatchPanel {...props()} />),
        t =
          operationalDispatchText[
            language as keyof typeof operationalDispatchText
          ];
      expect(html.split(t.confirm)).toHaveLength(2);
      expect(html).toContain(t.actual);
      expect(html).toContain(t.notes);
      expect(html).toContain("الفني المحدد");
      expect(html).not.toContain('type="number"');
      expect(html).not.toContain("اختر اللوت");
    }
  );
  it("shows completed actual recipient/notes without editable selectors", () => {
    const p = props();
    p.order.status = "completed";
    p.dispatch = [
      { itemId: 1, actualCollectorName: "المستلم البديل", notes: "كشف إكسل" },
    ] as any;
    const html = renderToStaticMarkup(<PreparedDispatchPanel {...p} />);
    expect(html).toContain("المستلم البديل");
    expect(html).toContain("كشف إكسل");
    expect(html).not.toContain(operationalDispatchText.ar.confirm);
  });
  it("read-only viewers never receive a dispatch action", () => {
    const html = renderToStaticMarkup(
      <PreparedDispatchPanel {...props()} canProcess={false} />
    );
    expect(html).not.toContain(operationalDispatchText.ar.confirm);
    expect(html).not.toContain('role="combobox"');
  });
  it("submits every line once with optional actual receiver and notes", async () => {
    state.hookMode = true;
    const p = props();
    state.states = [{ 1: { actualCollectorId: "102", notes: "كشف إكسل" } }];
    const node = render(() => PreparedDispatchPanel(p));
    const button = find(
      node,
      e => e.props.children === operationalDispatchText.ar.confirm
    );
    await button.props.onClick();
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
      path: "operationalIssues.issuePrepared",
      input: {
        orderId: 1,
        items: [
          { itemId: 1, actualCollectorId: 102, notes: "كشف إكسل" },
          { itemId: 2, actualCollectorId: null, notes: "" },
        ],
      },
    });
  });
  it("disables whole-order confirmation when any line has insufficient stock", () => {
    state.hookMode = true;
    const p = props();
    p.stocks[1].totalQuantity = 0;
    p.stocks[1].lots = [];
    const node = render(() => PreparedDispatchPanel(p));
    expect(
      find(node, e => e.props.children === operationalDispatchText.ar.confirm)
        .props.disabled
    ).toBe(true);
  });
  it.each(["warehouse", "it_manager", "owner", "admin"])(
    "catalog source is visible only to owner/admin: %s",
    role => {
      state.hookMode = true;
      state.role = role;
      state.states = ["1", "سبب", [], true, false, false];
      const node = render(PreparedIssueForm);
      expect(
        !!find(
          node,
          e => e.props.children === operationalDispatchText.ar.catalog
        )
      ).toBe(["owner", "admin"].includes(role));
      expect(
        find(
          node,
          e => e.props.children === operationalDispatchText.ar.inventory
        )
      ).toBeTruthy();
    }
  );
  it("sends per-line selections and inventory units with a single save-and-send", async () => {
    state.hookMode = true;
    state.states = [
      "1",
      "سبب",
      [
        {
          catalogItemId: 5,
          name: "صنف",
          quantity: 2,
          siteId: "1",
          sectionId: "2",
          collectorId: "101",
          source: "inventory",
        },
      ],
      false,
      false,
      false,
    ];
    const node = render(PreparedIssueForm);
    expect(find(node, e => e.props.id === "qty-5")).toBeTruthy();
    const save = find(
      node,
      e => e.props.children === operationalDispatchText.ar.save
    );
    expect(save.props.disabled).toBe(false);
    await save.props.onClick();
    expect(state.calls[0]).toMatchObject({
      path: "operationalIssues.createPrepared",
      input: {
        warehouseId: 1,
        items: [
          {
            catalogItemId: 5,
            quantity: 2,
            unit: "حبة",
            siteId: 1,
            sectionId: 2,
            collectorId: 101,
            source: "inventory",
          },
        ],
      },
    });
  });
  it("does not permit adding item 21 or changing warehouse after choosing items", () => {
    state.hookMode = true;
    state.states = [
      "1",
      "سبب",
      Array.from({ length: 20 }, (_, i) => ({
        catalogItemId: i + 1,
        name: `Item${i}`,
        quantity: 1,
        siteId: "1",
        sectionId: "2",
        collectorId: "101",
        source: "inventory",
      })),
      false,
      false,
      false,
    ];
    const node = render(PreparedIssueForm);
    expect(
      find(node, e => e.props.children === operationalDispatchText.ar.add).props
        .disabled
    ).toBe(true);
    expect(
      find(node, e => e.props.id === "dispatch-warehouse").props.disabled
    ).toBe(true);
  });
  it("keeps creation unavailable before manual schema setup", () => {
    state.ready = false;
    const html = renderToStaticMarkup(<PreparedIssueForm />);
    expect(html).toContain(operationalDispatchText.ar.setup);
    expect(html).not.toContain(operationalDispatchText.ar.save);
  });
});


it("does not add linked stock and shows its maintenance reference", async () => {
  state.hookMode = true; state.states = ["1", "سبب", [], false, true, false];
  state.linkedWork = [{kind:"ticket", reference:"MT-TEST-01", quantity:1, unit:"حبة", warehouseId:1}];
  const toast = (await import("sonner")).toast;
  const node=render(PreparedIssueForm);
  const picker=find(node, e => e.props?.warehouseId === 1 && typeof e.props?.onSelect === "function");
  picker.props.onSelect(5,"صنف");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.states[2]).toEqual([]);
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("MT-TEST-01"));
});
