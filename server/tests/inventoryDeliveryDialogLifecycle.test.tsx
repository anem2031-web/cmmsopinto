import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";

const state = vi.hoisted(() => ({
  values: [] as any[],
  index: 0,
  buttons: [] as any[],
  selects: [] as any[],
  inputs: [] as any[],
  enabled: true as boolean | undefined,
  role: "warehouse",
  authenticatedRole: null as string | null,
  isActive: 1,
  issueUnitApprovedAt: undefined as string | null | undefined,
  catalogUnit: undefined as string | null | undefined,
  previewConversion: vi.fn(),
  approveConversion: vi.fn(),
  matchCatalogUnit: vi.fn(),
  book: null as any,
  bookPagesQueries: [] as any[],
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = state.index++;
    if (!(index in state.values))
      state.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      state.values[index],
      (value: any) => {
        state.values[index] =
          typeof value === "function" ? value(state.values[index]) : value;
      },
    ];
  },
}));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, role: state.role, isActive: 1 },
    authenticatedUser: { id: 1, role: state.authenticatedRole ?? state.role, isActive: state.isActive },
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/inventory", vi.fn()] }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({
  useTranslation: () => ({ t: ar, language: "ar" }),
}));

vi.mock("../../client/src/lib/trpc", () => {
  const item = {
    id: 5,
    itemName: "صنف اختبار",
    quantity: 10,
    unit: "حبة",
    warehouseId: 1,
  };
  const lots = {
    pages: [
      {
        ...item,
        lots: [
          { lotId: 7, balanceQuantity: 10, issueUnit: "حبة", issueUnitCost: 2 },
        ],
      },
    ],
    nextId: null,
  };
  const port = (path = ""): any =>
    new Proxy(() => {}, {
      get: (_, key) => {
        if (key === "useUtils") return () => port();
        if (key === "useQuery")
          return () => ({
            data:
              path === "inventoryCount.lotTrackingStatus"
                ? state.enabled === undefined
                  ? undefined
                  : { enabled: state.enabled }
                : path === "inventory.list"
                  ? [{
                    ...item,
                    issueUnit: "حبة",
                    issueUnitApprovedAt: state.issueUnitApprovedAt,
                    linkedItemId: state.catalogUnit === undefined ? null : 9,
                    catalogUnit: state.catalogUnit,
                  }]
                  : path === "warehouse.list"
                    ? [{ id: 1, type: "main", nameAr: "الرئيسي" }]
                    : path === "catalog.units.list"
                      ? [{ id: 1, nameAr: "حبة" }, { id: 2, nameAr: "صندوق" }]
                      : [],
            isLoading: false,
            refetch: vi.fn(),
          });
        if (key === "useMutation")
          return () => ({
            isPending: false,
            mutate: vi.fn(),
            mutateAsync: path === "inventory.approveIssueUnitConversion"
              ? state.approveConversion
              : state.matchCatalogUnit,
          });
        if (key === "query" && path === "client.inventory.previewIssueUnitConversion")
          return state.previewConversion;
        if (key === "query") return vi.fn(async (input: any) => {
          if (path === "client.inventory.bookPages") state.bookPagesQueries.push(input);
          return lots;
        });
        if (key === "invalidate") return vi.fn();
        return port(path ? `${path}.${String(key)}` : String(key));
      },
    });
  return { trpc: port() };
});
vi.mock("../../client/src/components/ui/button", () => ({
  Button: ({ variant, size, ...props }: any) => {
    state.buttons.push(props);
    return <button {...props} />;
  },
}));
vi.mock("../../client/src/components/ui/input", () => ({
  Input: (props: any) => {
    state.inputs.push(props);
    return <input {...props} />;
  },
}));
vi.mock("../../client/src/components/ui/dialog", async original => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return {
    ...(await original<any>()),
    ...Object.fromEntries(
      [
        "Dialog",
        "DialogContent",
        "DialogHeader",
        "DialogTitle",
        "DialogTrigger",
        "DialogFooter",
        "DialogDescription",
      ].map(name => [name, Box])
    ),
  };
});
vi.mock("../../client/src/components/ui/select", () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return {
    ...Object.fromEntries(
      ["SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map(
        name => [name, Box]
      )
    ),
    Select: (props: any) => {
      state.selects.push(props);
      return <Box {...props} />;
    },
  };
});
vi.mock(
  "../../client/src/components/inventory/InventoryBooks",
  async original => ({
    ...(await original<any>()),
    InventoryBooks: (props: any) => {
      state.book = props;
      return <div>دفاتر المخزون</div>;
    },
  })
);
import Inventory from "../../client/src/pages/inventory/Inventory";

beforeEach(() => {
  state.values = [];
  state.index = 0;
  state.buttons = [];
  state.selects = [];
  state.inputs = [];
  state.enabled = true;
  state.role = "warehouse";
  state.authenticatedRole = null;
  state.isActive = 1;
  state.issueUnitApprovedAt = undefined;
  state.catalogUnit = undefined;
  state.previewConversion.mockReset();
  state.approveConversion.mockReset();
  state.matchCatalogUnit.mockReset();
  state.book = null;
  state.bookPagesQueries = [];
});
const render = () => {
  state.index = 0;
  state.buttons = [];
  state.selects = [];
  state.inputs = [];
  return renderToStaticMarkup(<Inventory />);
};
const confirm = () =>
  state.buttons.find(button =>
    React.Children.toArray(button.children).includes("تأكيد التسليم")
  );
const cancelDelivery = () => {
  const cancel = state.buttons[state.buttons.indexOf(confirm()) - 1];
  expect(cancel.children).toBe("إلغاء");
  cancel.onClick();
};

it.each(["warehouse", "admin", "owner"])(
  "renders inventory with lot tracking and no delivery selection for %s",
  role => {
    state.role = role;
    expect(render()).toContain("صنف اختبار");
    expect(confirm()).toBeUndefined();
  }
);
it.each([false, undefined])(
  "renders without a selection while lot status is %s",
  enabled => {
    state.enabled = enabled;
    expect(render()).toContain("صنف اختبار");
    expect(confirm()).toBeUndefined();
  }
);
it("keeps the selected-lot requirement and renders safely after cancellation and reopening", () => {
  render();
  state.buttons.find(button => button.title === "تسليم للفني").onClick();
  expect(render()).toContain("QR الدفعة");
  expect(confirm().disabled).toBe(true);
  cancelDelivery();
  expect(render()).toContain("صنف اختبار");
  expect(confirm()).toBeUndefined();
  state.buttons.find(button => button.title === "تسليم للفني").onClick();
  render();
  expect(confirm().disabled).toBe(true);
});
it("keeps FIFO delivery available after choosing a book and renders safely after closing it", async () => {
  state.role = "admin";
  render();
  state.selects[0].onValueChange("1");
  render();
  await state.book.onFifo({ id: 9, nameAr: "دفتر اختبار" }, "حبة");
  expect(render()).toContain("دفتر اختبار");
  expect(confirm().disabled).toBe(false);
  cancelDelivery();
  expect(render()).toContain("دفاتر المخزون");
  expect(confirm()).toBeUndefined();
});
it("keeps an all-warehouse book issue scoped to the warehouse of its row", async () => {
  state.role = "admin";
  expect(render()).toContain("كل المستودعات");
  state.selects[0].onValueChange("all");
  expect(render()).toContain("إجمالي الكميات بكل المستودعات");
  expect(state.book.groupByWarehouse).toBe(true);
  expect(state.book.warehouseId).toBeUndefined();
  await state.book.onFifo({ id: 9, warehouseId: 2, nameAr: "دفتر المستودع الثاني" }, "حبة");
  expect(state.bookPagesQueries).toEqual([{ catalogItemId: 9, warehouseId: 2, afterId: 0, limit: 50 }]);
  expect(render()).toContain("دفتر المستودع الثاني");
  expect(confirm().disabled).toBe(false);
});
it.each(["warehouse","senior_management","observer","accountant","technician"])("hides the inventory issue column action for %s while preserving the book reader",role=>{
  state.role=role;render();state.selects[0].onValueChange("1");render();
  expect(state.book.onFifo).toBeUndefined();
  if(role==="warehouse")expect(state.book.onPick).toBeTypeOf("function");
});
it.each(["owner","admin"])("keeps the inventory issue column action for %s",role=>{
  state.role=role;render();state.selects[0].onValueChange("1");render();expect(state.book.onFifo).toBeTypeOf("function");
});
it.each(["warehouse", "senior_management", "observer", "accountant", "technician"])("hides the inventory issue column for authenticated %s even in a projected owner view", role => {
  state.role = "owner"; state.authenticatedRole = role;
  render(); state.selects[0].onValueChange("1"); render();
  expect(state.book.onFifo).toBeUndefined();
});
it("hides the inventory issue column from an inactive authenticated admin", () => {
  state.role = "admin"; state.authenticatedRole = "admin"; state.isActive = 0;
  render(); state.selects[0].onValueChange("1"); render();
  expect(state.book.onFifo).toBeUndefined();
});

const buttonWithText = (label: string) => state.buttons.find(button => button.children === label);
const issueUnitAction = () => buttonWithText("اعتماد وحدة الصرف");
const confirmIssueUnit = () => buttonWithText("تأكيد اعتماد وحدة الصرف");

it.each([["warehouse", 1, true], ["admin", 1, true], ["owner", 1, true], ["observer", 1, false], ["warehouse", 0, false]])(
  "offers unit approval only to the active authenticated warehouse role %s with status %i",
  (role, isActive, allowed) => {
    state.role = "owner"; // Includes an observer's projected owner view.
    state.authenticatedRole = role;
    state.isActive = isActive;
    state.issueUnitApprovedAt = null;
    render();
    expect(Boolean(issueUnitAction())).toBe(allowed);
  }
);

it("requires a fresh, unblocked preview before one explicit approval", async () => {
  state.issueUnitApprovedAt = null;
  const stockPreview = {
    before: { quantity: 10, unit: "حبة" },
    after: { quantity: 5, unit: "صندوق" },
    requests: [{ kind: "purchase", reference: "PR-13", beforeQuantity: 8, afterQuantity: 4 }],
    blockers: [],
    confirmationToken: "stock-and-links-revision",
  };
  state.previewConversion
    .mockResolvedValueOnce({ ...stockPreview, blockers: ["الكمية غير متطابقة"] })
    .mockResolvedValue(stockPreview);
  state.approveConversion.mockResolvedValueOnce(undefined);
  render();
  issueUnitAction().onClick({ stopPropagation() {} });
  render();
  expect(confirmIssueUnit().disabled).toBe(true);
  state.selects.find(select => select.children[0]?.props.id === "inventory-issue-unit").onValueChange("صندوق");
  state.inputs.find(input => input.id === "inventory-issue-factor").onChange({ target: { value: "0.5" } });
  render();
  expect(buttonWithText("معاينة التحويل").disabled).toBe(false);
  await buttonWithText("معاينة التحويل").onClick();
  expect(render()).toContain("الكمية غير متطابقة");
  expect(confirmIssueUnit().disabled).toBe(true);
  await buttonWithText("معاينة التحويل").onClick();
  expect(render()).toContain("PR-13");
  expect(confirmIssueUnit().disabled).toBe(false);
  state.inputs.find(input => input.id === "inventory-issue-factor").onChange({ target: { value: "0.5" } });
  render();
  expect(confirmIssueUnit().disabled).toBe(true);
  await buttonWithText("معاينة التحويل").onClick();
  render();
  expect(state.approveConversion).not.toHaveBeenCalled();
  await confirmIssueUnit().onClick();
  expect(state.approveConversion).toHaveBeenCalledTimes(1);
  expect(state.approveConversion).toHaveBeenCalledWith({
    inventoryId: 5,
    issueUnit: "صندوق",
    factor: 0.5,
    confirmationToken: "stock-and-links-revision",
  });
  state.issueUnitApprovedAt = "2026-11-11 10:00:00";
  render();
  expect(issueUnitAction()).toBeUndefined();
});

it("requires separate confirmation before matching the linked catalog unit", async () => {
  state.enabled = false;
  state.issueUnitApprovedAt = "2026-11-11 10:00:00";
  state.catalogUnit = "صندوق";
  state.matchCatalogUnit.mockResolvedValueOnce(undefined);
  render();
  expect(issueUnitAction()).toBeUndefined();
  buttonWithText("تغيير وحدة الكتالوج").onClick({ stopPropagation() {} });
  expect(render()).toContain("ستتغير وحدة الكتالوج من");
  expect(state.matchCatalogUnit).not.toHaveBeenCalled();
  await buttonWithText("تأكيد تحديث الكتالوج").onClick();
  expect(state.matchCatalogUnit).toHaveBeenCalledTimes(1);
  expect(state.matchCatalogUnit).toHaveBeenCalledWith({
    inventoryId: 5,
    expectedCatalogUnit: "صندوق",
  });
});

it("exposes the unit action on an active book record within the warehouse screen", () => {
  render();
  state.selects[0].onValueChange("1");
  render();
  const record = { id: 9, itemName: "سجل مخزون", quantity: 4, issueUnitApprovedAt: null };
  expect(renderToStaticMarkup(<>{state.book.renderIssueUnitActions(record)}</>)).toContain("اعتماد وحدة الصرف");
  expect(state.book.renderIssueUnitActions({ ...record, isFrozen: 1 })).toBeNull();
});
