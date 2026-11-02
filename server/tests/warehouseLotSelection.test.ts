import { expect, it } from "vitest";
import { selectFullIssueLots } from "../../shared/warehouse-lot-selection";
const lots = () =>
  [2, 3, 5, 1].map((quantity, index) => ({
    lotId: index + 1,
    quantity,
    unit: "حبة",
    createdAt: `2026-10-0${index + 1}`,
  }));
it("covers six from 2/3/5/1 in creation order rather than input or expiry order", () => {
  const source = lots().reverse();
  expect(
    selectFullIssueLots(source, 6, "حبة").map(row => [row.lotId, row.quantity])
  ).toEqual([
    [1, 2],
    [2, 3],
    [3, 1],
  ]);
  expect(source[0].quantity).toBe(1);
});
it("accepts a manual 5+1 from later lots as one full requirement", () =>
  expect(
    selectFullIssueLots(lots(), 6, "حبة", {
      mode: "manual",
      lots: [
        { lotId: 3, quantity: 5 },
        { lotId: 4, quantity: 1 },
      ],
    }).map(row => row.quantity)
  ).toEqual([5, 1]));
it.each([
  [{ lotId: 1, quantity: 2 }],
  [
    { lotId: 3, quantity: 5 },
    { lotId: 2, quantity: 3 },
  ],
  [{ lotId: 4, quantity: 6 }],
  [{ lotId: 99, quantity: 6 }],
  [
    { lotId: 2, quantity: 3 },
    { lotId: 2, quantity: 3 },
  ],
])(
  "rejects shortage, excess, over-lot quantity, foreign and duplicate IDs: %j",
  choices =>
    expect(() =>
      selectFullIssueLots(lots(), 6, "حبة", { mode: "manual", lots: choices })
    ).toThrow()
);
it("rejects mixed units and aggregate insufficient stock without changing options", () => {
  expect(() => selectFullIssueLots(lots(), 6, "كجم")).toThrow();
  expect(() => selectFullIssueLots(lots(), 12, "حبة")).toThrow();
  expect(lots().map(row => row.quantity)).toEqual([2, 3, 5, 1]);
});
it("uses stable lot IDs for equal dates and handles zero stock", () => {
  const same = lots()
    .reverse()
    .map(row => ({ ...row, createdAt: "2026-10-01" }));
  expect(selectFullIssueLots(same, 6, "حبة").map(row => row.lotId)).toEqual([
    1, 2, 3,
  ]);
  expect(() => selectFullIssueLots([], 6, "حبة")).toThrow();
});
it("preserves an approved alternative ratio and caps its combined allowance", () => {
  const source = [
    {
      lotId: 1,
      quantity: 5,
      unit: "قطعة",
      originalPerUnit: 2,
      coverageKey: "plan-1",
      coverageLimit: 6,
    },
  ];
  expect(
    selectFullIssueLots(source, 6, "حبة", {
      mode: "manual",
      lots: [{ lotId: 1, quantity: 3 }],
    })
  ).toHaveLength(1);
  expect(() =>
    selectFullIssueLots(source, 8, "حبة", {
      mode: "manual",
      lots: [{ lotId: 1, quantity: 4 }],
    })
  ).toThrow("حصة البديل");
});
it("rejects inexact per-lot replacement ratios instead of rounding need coverage", () => {
  const source = [
    {
      lotId: 1,
      quantity: 6,
      unit: "قطعة",
      originalPerUnit: 2 / 3,
      coverageKey: "plan",
      coverageLimit: 4,
    },
  ];
  expect(() =>
    selectFullIssueLots(source, 2, "حبة", {
      mode: "manual",
      lots: [{ lotId: 1, quantity: 1 }],
    })
  ).toThrow("بدقة");
  expect(
    selectFullIssueLots(source, 2, "حبة", {
      mode: "manual",
      lots: [{ lotId: 1, quantity: 3 }],
    })
  ).toHaveLength(1);
});
