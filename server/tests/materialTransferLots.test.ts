import { describe, expect, it } from "vitest";
import {
  buildMaterialTransferLotCart,
  groupMaterialTransferPlan,
  materialTransferLotOptions,
} from "../../client/src/lib/material-transfer-lots";
const context = {
  source: "tickets" as "tickets" | "pmv2",
  requestItemId: 5,
  fromWarehouseId: 10,
  toWarehouseId: 20,
  quantity: 6,
  materialName: "مادة",
  unit: "حبة",
};
const inventory = [
  { id: 100, warehouseId: 10, linkedItemId: 1, unit: "حبة", quantity: 11 },
];
const groups = groupMaterialTransferPlan([
  {
    sourceInventoryId: 100,
    catalogItemId: 1,
    materialName: "مادة",
    quantity: 6,
    unit: "حبة",
    originalQuantity: 6,
    lotId: 1,
    lotCode: "LOT1",
    trackingToken: "T1",
  },
]);
const raw = [2, 3, 5, 1].map((balanceQuantity, n) => ({
  lotId: n + 1,
  lotCode: `LOT${n + 1}`,
  trackingToken: `T${n + 1}`,
  catalogItemId: 1,
  issueUnit: "حبة",
  balanceQuantity,
  createdAt: `2026-10-${String(n + 1).padStart(2, "0")}`,
}));
describe.each(["tickets", "pmv2"] as const)(
  "Full material transfer lot selection for %s",
  source => {
    it("prepares FIFO as 2+3+1 in oldest creation order regardless of API order", () => {
      const result = buildMaterialTransferLotCart(
        groups,
        { 100: [...raw].reverse() },
        {},
        { ...context, source },
        inventory
      );
      expect(result.map(row => [row.lotTrackingToken, row.quantity])).toEqual([
        ["T1", 2],
        ["T2", 3],
        ["T3", 1],
      ]);
      expect(
        result.every(row => row.materialNeedId === 5 && row.inventoryId === 100)
      ).toBe(true);
      expect(result.reduce((sum, row) => sum + row.originalQuantity, 0)).toBe(
        6
      );
    });
    it("prepares manual 5+1 without scanner resolution", () => {
      const result = buildMaterialTransferLotCart(
        groups,
        { 100: raw },
        {
          [groups[0].key]: {
            mode: "manual",
            lots: [
              { lotId: 3, quantity: 5 },
              { lotId: 4, quantity: 1 },
            ],
          },
        },
        { ...context, source },
        inventory,
        "للصيانة"
      );
      expect(result.map(row => [row.lotTrackingToken, row.quantity])).toEqual([
        ["T3", 5],
        ["T4", 1],
      ]);
      expect(result.every(row => row.notes === "للصيانة")).toBe(true);
    });
    it.each([
      [{ lotId: 1, quantity: 2 }],
      [
        { lotId: 3, quantity: 5 },
        { lotId: 2, quantity: 2 },
      ],
      [{ lotId: 1, quantity: 6 }],
      [{ lotId: 999, quantity: 6 }],
      [
        { lotId: 3, quantity: 3 },
        { lotId: 3, quantity: 3 },
      ],
      [
        { lotId: 3, quantity: 5.5 },
        { lotId: 4, quantity: 0.5 },
      ],
    ])(
      "rejects short, excessive, overdrawn, foreign, duplicate or fractional lot selection: %j",
      lots => {
        expect(() =>
          buildMaterialTransferLotCart(
            groups,
            { 100: raw },
            { [groups[0].key]: { mode: "manual", lots } },
            { ...context, source },
            inventory
          )
        ).toThrow();
      }
    );
    it("filters wrong units/catalog and blocks stale balances and frozen/source-mismatched stock", () => {
      expect(
        materialTransferLotOptions(groups[0], [
          ...raw,
          { ...raw[0], lotId: 20, issueUnit: "كرتون" },
          { ...raw[0], lotId: 21, catalogItemId: 99 },
        ])
      ).toHaveLength(4);
      for (const rows of [[{ ...raw[0], balanceQuantity: 1 }], []])
        expect(() =>
          buildMaterialTransferLotCart(
            groups,
            { 100: rows },
            {},
            { ...context, source },
            inventory
          )
        ).toThrow();
      for (const stock of [
        [{ ...inventory[0], isFrozen: 1 }],
        [{ ...inventory[0], warehouseId: 99 }],
        [{ ...inventory[0], quantity: 5 }],
      ])
        expect(() =>
          buildMaterialTransferLotCart(
            groups,
            { 100: raw },
            {},
            { ...context, source },
            stock
          )
        ).toThrow();
    });
  }
);
describe("PMV2 approved physical distribution remains fixed", () => {
  const allocation = {
    sourceInventoryId: 101,
    catalogItemId: 2,
    materialName: "بديل",
    quantity: 6,
    unit: "حبة",
    originalQuantity: 4,
    lotId: 8,
    lotCode: "R8",
    trackingToken: "R8",
    replacementPlanId: 7,
    allowedLotIds: [8, 9],
  };
  const mixed = groupMaterialTransferPlan([
    {
      ...groups[0],
      quantity: 2,
      originalQuantity: 2,
      lotId: 1,
      lotCode: "LOT1",
      trackingToken: "T1",
      allowedLotIds: [1],
    },
    allocation,
  ]);
  const stock = [
    ...inventory,
    { id: 101, warehouseId: 10, linkedItemId: 2, unit: "حبة", quantity: 8 },
  ];
  const lots = {
    100: raw,
    101: [
      {
        lotId: 8,
        catalogItemId: 2,
        issueUnit: "حبة",
        balanceQuantity: 3,
        trackingToken: "R8",
        createdAt: "2026-10-01",
      },
      {
        lotId: 9,
        catalogItemId: 2,
        issueUnit: "حبة",
        balanceQuantity: 3,
        trackingToken: "R9",
        createdAt: "2026-10-02",
      },
      {
        lotId: 10,
        catalogItemId: 2,
        issueUnit: "حبة",
        balanceQuantity: 10,
        trackingToken: "UNAPPROVED",
        createdAt: "2026-09-01",
      },
    ],
  };
  it("preserves original 2 plus replacement 6 covering 4, excluding an unapproved older lot", () => {
    const result = buildMaterialTransferLotCart(
      mixed,
      lots,
      {},
      { ...context, source: "pmv2" },
      stock
    );
    expect(
      result.map(row => [row.inventoryId, row.quantity, row.originalQuantity])
    ).toEqual([
      [100, 2, 2],
      [101, 3, 2],
      [101, 3, 2],
    ]);
    expect(result[1].notes).toContain("بديل معتمد");
    expect(result.some(row => row.lotTrackingToken === "UNAPPROVED")).toBe(
      false
    );
  });
  it("rejects replacement lots without a current approved restriction and imprecise physical ratios", () => {
    const unrestricted = groupMaterialTransferPlan([
      { ...allocation, allowedLotIds: undefined },
    ]);
    expect(() =>
      buildMaterialTransferLotCart(
        unrestricted,
        lots,
        {},
        { ...context, quantity: 4, source: "pmv2" },
        stock
      )
    ).toThrow("المعتمدة");
    const imprecise = {
      101: [
        { ...lots[101][0], balanceQuantity: 5 },
        { ...lots[101][1], balanceQuantity: 5 },
      ],
    };
    const only = groupMaterialTransferPlan([allocation]);
    expect(() =>
      buildMaterialTransferLotCart(
        only,
        imprecise,
        {
          [only[0].key]: {
            mode: "manual",
            lots: [
              { lotId: 8, quantity: 5 },
              { lotId: 9, quantity: 1 },
            ],
          },
        },
        { ...context, quantity: 4, source: "pmv2" },
        stock
      )
    ).toThrow("نسبة البديل");
  });
  it("excludes replacement lot identities from the ordinary same-catalog group", () => {
    const original = { ...groups[0], allowedLotIds: [1, 2] };
    expect(
      materialTransferLotOptions(original, raw).map(lot => lot.lotId)
    ).toEqual([1, 2]);
  });
});
