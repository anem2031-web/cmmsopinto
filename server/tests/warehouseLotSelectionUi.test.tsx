import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  expanded: false,
  buttons: [] as any[],
  inputs: [] as any[],
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useState: () => [
    state.expanded,
    (value: boolean) => {
      state.expanded = value;
    },
  ],
}));
vi.mock("../../client/src/components/ui/button", () => ({
  Button: (props: any) => {
    state.buttons.push(props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));
vi.mock("../../client/src/components/ui/input", () => ({
  Input: (props: any) => {
    state.inputs.push(props);
    return <input {...props} />;
  },
}));
import { WarehouseLotSelection } from "../../client/src/components/inventory/WarehouseLotSelection";
beforeEach(() => {
  state.expanded = false;
  state.buttons = [];
  state.inputs = [];
});
it("opens lot choices without a barcode and selects five plus one to cover six", () => {
  let value: any = { mode: "fifo" };
  const lots = [2, 3, 5, 1].map((quantity, i) => ({
    lotId: i + 1,
    lotCode: `LOT-${i + 1}`,
    quantity,
    unit: "حبة",
  }));
  const render = () => {
    state.buttons = [];
    state.inputs = [];
    return renderToStaticMarkup(
      <WarehouseLotSelection
        lots={lots}
        required={6}
        unit="حبة"
        value={value}
        onChange={next => {
          value = next;
        }}
      />
    );
  };
  expect(render()).toContain("صرف بالأقدم");
  state.buttons.find(button => button["aria-expanded"] === false).onClick();
  expect(render()).toContain("LOT-3");
  expect(value.mode).toBe("manual");
  state.buttons
    .filter(button => button.children === "اختيار اللوت")[2]
    .onClick();
  render();
  state.buttons
    .filter(button => button.children === "اختيار اللوت")[2]
    .onClick();
  const html = render();
  expect(value.lots).toEqual([
    { lotId: 3, quantity: 5 },
    { lotId: 4, quantity: 1 },
  ]);
  expect(html).toContain("6 / 6");
  expect(html).not.toContain("barcode");
  expect(html).not.toContain('role="status"');
});
it("shows a full-requirement blocker for an incomplete manual selection", () => {
  state.expanded = true;
  const html = renderToStaticMarkup(
    <WarehouseLotSelection
      lots={[{ lotId: 1, quantity: 2, unit: "حبة" }]}
      required={6}
      unit="حبة"
      value={{ mode: "manual", lots: [{ lotId: 1, quantity: 2 }] }}
      onChange={vi.fn()}
    />
  );
  expect(html).toContain("2 / 6");
  expect(html).toContain('role="status"');
});
it("keeps the selected quantity input editable when cleared and allows removing the selection separately", () => {
  state.expanded = true;
  let value: any = { mode: "manual", lots: [{ lotId: 1, quantity: 6 }] };
  const render = () => {
    state.buttons = [];
    state.inputs = [];
    return renderToStaticMarkup(
      <WarehouseLotSelection
        lots={[{ lotId: 1, quantity: 6, unit: "حبة" }]}
        required={6}
        unit="حبة"
        value={value}
        onChange={next => {
          value = next;
        }}
      />
    );
  };
  render();
  state.inputs[0].onChange({ target: { value: "" } });
  expect(render()).toContain('role="status"');
  expect(state.inputs).toHaveLength(1);
  state.inputs[0].onChange({ target: { value: "6" } });
  expect(render()).not.toContain('role="status"');
  state.buttons.find(button => button.children === "إلغاء الاختيار").onClick();
  render();
  expect(state.inputs).toHaveLength(0);
  expect(value.lots).toEqual([]);
});
