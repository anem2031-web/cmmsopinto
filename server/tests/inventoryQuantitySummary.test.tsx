import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ open: false, buttons: [] as any[] }));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useState: () => [
    state.open,
    (open: boolean) => {
      state.open = open;
    },
  ],
}));
vi.mock("../../client/src/components/ui/button", () => ({
  Button: ({ children, variant, size, ...props }: any) => {
    state.buttons.push({ ...props, children });
    return <button {...props}>{children}</button>;
  },
}));
vi.mock("../../client/src/components/ui/dialog", () => {
  const Box = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return {
    ...Object.fromEntries(
      [
        "DialogContent",
        "DialogDescription",
        "DialogFooter",
        "DialogHeader",
        "DialogTitle",
      ].map(name => [name, Box])
    ),
    Dialog: ({ open, children }: any) =>
      open ? <div role="dialog">{children}</div> : null,
  };
});
import { InventoryQuantitySummary } from "../../client/src/components/inventory/InventoryQuantitySummary";
const totals = [
  { unit: "قطعة", quantity: 3525 },
  { unit: "كجم", quantity: 8 },
  { unit: "رول piece", quantity: 1 },
];
const render = (rows = totals) => {
  state.buttons = [];
  return renderToStaticMarkup(<InventoryQuantitySummary totals={rows} />);
};
beforeEach(() => {
  state.open = false;
  state.buttons = [];
});
it("keeps mixed-unit quantities out of the card and exposes a details action", () => {
  const html = render();
  expect(html).toContain("3 وحدات قياس");
  expect(html).not.toContain("3,525");
  expect(html).not.toContain("رول piece");
  expect(html).not.toContain('role="dialog"');
  expect(
    state.buttons.find(button => button.children === "تفاصيل الكميات").disabled
  ).toBe(false);
});
it("opens separate unit rows with unchanged amounts, reflects current props, and closes", () => {
  render();
  state.buttons.find(button => button.children === "تفاصيل الكميات").onClick();
  let html = render();
  expect(html).toContain('role="dialog"');
  for (const value of ["قطعة", "3,525", "كجم", "رول piece"])
    expect(html).toContain(value);
  expect(html).not.toContain("3,534");
  html = render([{ unit: "حبة", quantity: 7 }]);
  expect(html).toContain("7 حبة");
  expect(html).not.toContain("3,525");
  state.buttons.find(button => button.children === "إغلاق").onClick();
  expect(render()).not.toContain('role="dialog"');
});
it("preserves zero and fractional amounts and handles an empty scope", () => {
  expect(render([{ unit: "كجم", quantity: 0 }])).toContain("0 كجم");
  expect(render([{ unit: "كجم", quantity: 1.25 }])).toContain("1.25 كجم");
  render([]);
  expect(
    state.buttons.find(button => button.children === "تفاصيل الكميات").disabled
  ).toBe(true);
});
