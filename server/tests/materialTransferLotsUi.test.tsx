import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const raw = [2, 3, 5, 1].map((balanceQuantity, n) => ({
  lotId: n + 1,
  lotCode: `LOT${n + 1}`,
  trackingToken: `T${n + 1}`,
  catalogItemId: 1,
  issueUnit: "حبة",
  balanceQuantity,
  createdAt: `2026-10-0${n + 1}`,
}));
const state = vi.hoisted(() => ({
  values: [] as any[],
  cursor: 0,
  buttons: [] as any[],
  inputs: [] as any[],
  query: vi.fn(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useState: (initial: any) => {
    const index = state.cursor++;
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
vi.mock("../../client/src/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: { inventory: { listLots: { query: state.query } } },
    }),
  },
}));
vi.mock("../../client/src/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => {
    state.buttons.push({ children, ...props });
    return <button {...props}>{children}</button>;
  },
}));
vi.mock("../../client/src/components/ui/input", () => ({
  Input: (props: any) => {
    state.inputs.push(props);
    return <input {...props} />;
  },
}));
import { MaterialTransferLotPicker } from "../../client/src/components/inventory/MaterialTransferLotPicker";
import { groupMaterialTransferPlan } from "../../client/src/lib/material-transfer-lots";
const groups = groupMaterialTransferPlan([
  {
    sourceInventoryId: 100,
    catalogItemId: 1,
    materialName: "سلك",
    quantity: 6,
    unit: "حبة",
    originalQuantity: 6,
    lotId: 1,
    lotCode: "LOT1",
    trackingToken: "T1",
  },
]);
const inventory = [
  { id: 100, warehouseId: 10, linkedItemId: 1, unit: "حبة", quantity: 11 },
];
const prepared = vi.fn(),
  invalidate = vi.fn();
function render(source: "tickets" | "pmv2" = "tickets", disabled = false) {
  state.cursor = 0;
  state.buttons = [];
  state.inputs = [];
  return renderToStaticMarkup(
    <MaterialTransferLotPicker
      groups={groups}
      context={{
        source,
        requestItemId: 5,
        fromWarehouseId: 10,
        toWarehouseId: 20,
        quantity: 6,
        materialName: "سلك",
        unit: "حبة",
      }}
      inventory={inventory}
      disabled={disabled}
      onInvalidate={invalidate}
      onPrepared={prepared}
    />
  );
}
const add = () =>
  state.buttons.find(
    button => button.children === "إضافة اللوتات المحددة للعملية"
  );
beforeEach(() => {
  state.values = [{ 100: raw }, {}, false, "", "", false];
  state.query.mockReset().mockResolvedValue(raw);
  prepared.mockClear();
  invalidate.mockClear();
});
describe.each(["tickets", "pmv2"] as const)(
  "Material transfer selector for %s",
  source => {
    it("offers FIFO/manual without barcode and refreshes actual lots before preparing", async () => {
      const html = render(source);
      expect(html).toContain("تحويل بالأقدم");
      expect(html).toContain("اختيار اللوتات");
      expect(html).not.toContain("كاميرا");
      expect(html).not.toContain("QR");
      expect(add().disabled).toBe(false);
      await add().onClick();
      expect(state.query).toHaveBeenCalledTimes(1);
      expect(state.query).toHaveBeenCalledWith({ inventoryId: 100 });
      expect(prepared.mock.calls[0][0].map((row: any) => row.quantity)).toEqual(
        [2, 3, 1]
      );
      expect(invalidate).toHaveBeenCalled();
    });
    it("selects 5+1 manually and disables preparation for short or excessive quantities", async () => {
      render(source);
      state.buttons.find(button => button["aria-expanded"] === false).onClick();
      render(source);
      expect(add().disabled).toBe(true);
      state.buttons
        .filter(button => button.children === "اختيار اللوت")[2]
        .onClick();
      render(source);
      expect(add().disabled).toBe(true);
      state.buttons
        .filter(button => button.children === "اختيار اللوت")[2]
        .onClick();
      render(source);
      expect(add().disabled).toBe(false);
      await add().onClick();
      expect(
        prepared.mock.calls[0][0].map((row: any) => [
          row.lotTrackingToken,
          row.quantity,
        ])
      ).toEqual([
        ["T3", 5],
        ["T4", 1],
      ]);
      render(source);
      state.inputs
        .find(input => input["aria-label"] === "كمية اللوت LOT3")
        .onChange({ target: { value: "4" } });
      render(source);
      expect(add().disabled).toBe(true);
      state.inputs
        .find(input => input["aria-label"] === "كمية اللوت LOT3")
        .onChange({ target: { value: "6" } });
      render(source);
      expect(add().disabled).toBe(true);
      expect(invalidate).toHaveBeenCalled();
    });
    it("refuses a stale/failed read and permits reload without any stock mutation", async () => {
      render(source);
      state.query.mockResolvedValueOnce([{ ...raw[0], balanceQuantity: 1 }]);
      await add().onClick();
      let html = render(source);
      expect(prepared).not.toHaveBeenCalled();
      expect(html).toContain('role="alert"');
      await state.buttons
        .find(button => button.children === "تحديث اللوتات")
        .onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      render(source);
      expect(state.query).toHaveBeenCalledTimes(2);
    });
    it("prevents preparation while the form is disabled", async () => {
      render(source, true);
      expect(add().disabled).toBe(true);
      await add().onClick();
      expect(prepared).not.toHaveBeenCalled();
      expect(state.query).not.toHaveBeenCalled();
    });
  }
);
