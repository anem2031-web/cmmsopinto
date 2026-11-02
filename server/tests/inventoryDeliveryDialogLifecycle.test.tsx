import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";

const state = vi.hoisted(() => ({
  values: [] as any[],
  index: 0,
  buttons: [] as any[],
  selects: [] as any[],
  enabled: true as boolean | undefined,
  role: "warehouse",
  book: null as any,
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
  useAuth: () => ({ user: { id: 1, role: state.role } }),
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
                  ? [item]
                  : path === "warehouse.list"
                    ? [{ id: 1, type: "main", nameAr: "الرئيسي" }]
                    : [],
            isLoading: false,
            refetch: vi.fn(),
          });
        if (key === "useMutation")
          return () => ({ isPending: false, mutate: vi.fn() });
        if (key === "query") return vi.fn(async () => lots);
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
  state.enabled = true;
  state.role = "warehouse";
  state.book = null;
});
const render = () => {
  state.index = 0;
  state.buttons = [];
  state.selects = [];
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
