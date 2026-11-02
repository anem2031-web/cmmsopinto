import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const memory = vi.hoisted(() => ({
  db: null as any,
  state: null as any,
  failIssue: 0,
  failLink: 0,
  calls: [] as any[],
}));
vi.mock("../_core/db/client", () => ({ getDb: async () => memory.db }));
vi.mock("../pmv2/adapters/current-system", () => ({
  currentCatalogAdapter: {},
  currentDeliveryAdapter: {},
  currentInventoryAdapter: {},
  currentRecipientReturnAdapter: {},
  currentMaintenanceTargetAdapter: {
    listSections: async () => [{ id: 2, siteId: 1, name: "Section" }],
  },
  currentInventoryIssueAdapter: {
    issueDelivery: async (input: any, tx: any) => {
      expect(tx).toBe(memory.db);
      memory.calls.push(input);
      if (memory.failIssue === memory.calls.length)
        throw Error("issue failure");
      const id = Number(input.lotTrackingToken.slice(3));
      if (memory.state.stock[id - 1] < input.quantity)
        throw Error("stale lot balance");
      memory.state.stock[id - 1] -= input.quantity;
      const document = {
        deliveryNumber: `DLV-${memory.state.documents.length + 1}`,
        ...input,
      };
      memory.state.documents.push(document);
      return document;
    },
  },
}));
import { Pmv2TeamIssueHandoffService } from "../pmv2/materials/team-issue-handoff-service";
function fixture() {
  memory.calls = [];
  memory.failIssue = 0;
  memory.failLink = 0;
  const snapshot = {
    version: 1,
    route: "team_inventory",
    catalogItemId: 9,
    itemNameSnapshot: "test",
    requestedQuantity: 6,
    unit: "حبة",
    teamWarehouseId: 5,
    availableQuantity: 11,
    shortageQuantity: 0,
    lotsRequired: true,
  };
  memory.state = {
    stock: [2, 3, 5, 1],
    documents: [],
    actions: [],
    links: [],
    actor: { id: 20, role: "warehouse", isActive: 1 },
    requirement: {
      actionId: 40,
      requesterUserId: 3,
      visitId: 1,
      note: JSON.stringify(snapshot),
      taskId: 1,
      taskNumber: "PM-TEST",
      taskStatus: "waiting_material",
      programTargetId: 2,
      taskItemId: 2,
      taskItemTitle: "test",
      itemStatus: "waiting_material",
      itemResult: "needs_material",
      teamId: 3,
      teamCode: "TEAM",
      teamWarehouseId: 5,
    },
  };
  const db: any = {
    execute: async () => [[]],
    select: (fields: any) => {
      let table = "";
      const query: any = {
        from: (value: any) => {
          table = getTableName(value);
          return query;
        },
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        then: (ok: any, fail: any) =>
          Promise.resolve(
            table === "users"
              ? [memory.state.actor]
              : table === "catalog_items"
                ? [{ id: 9, isActive: 1 }]
                : table === "pmv2_program_targets"
                  ? [{ siteId: 1, sectionId: 2 }]
                  : table === "pmv2_item_actions"
                    ? fields.actionId
                      ? [memory.state.requirement]
                      : memory.state.actions
                    : []
          ).then(ok, fail),
      };
      return query;
    },
    transaction: async (work: any) => {
      const before = structuredClone(memory.state);
      try {
        return await work(db);
      } catch (error) {
        memory.state = before;
        throw error;
      }
    },
  };
  memory.db = db;
  const service = new Pmv2TeamIssueHandoffService();
  vi.spyOn(service, "linkConfirmedDelivery").mockImplementation(
    async (_actor: any, input: any, _audit: any, tx: any) => {
      expect(tx).toBe(db);
      if (memory.failLink === memory.state.links.length + 1)
        throw Error("link failure");
      memory.state.links.push(input);
      return { linkedQuantity: 1 } as any;
    }
  );
  const candidate = {
    taskItemId: 2,
    routeDecisionActionId: 40,
    warehouseId: 5,
    catalogItemId: 9,
    remainingQuantity: 6,
    taskNumber: "PM-TEST",
    availableLotOptions: [2, 3, 5, 1].map((quantity, i) => ({
      lotId: i + 1,
      quantity,
      unit: "حبة",
      inventoryId: 10,
      catalogItemId: 9,
      trackingToken: `LOT${i + 1}`,
      createdAt: `2026-01-0${i + 1}`,
    })),
  };
  return {
    candidate,
    issue: (selection: any = { mode: "fifo" }) =>
      (service as any).issueSelectedRequirement(
        db,
        20,
        selection,
        candidate,
        101
      ),
  };
}
beforeEach(() => vi.restoreAllMocks());
describe("PMV2 full multi-lot issue transaction orchestration", () => {
  it("issues 2+3+1 oldest quantities and links them in the same transaction", async () => {
    const f = fixture();
    expect(await f.issue()).toMatchObject({
      completed: true,
      partial: false,
      issuedQuantity: 6,
    });
    expect(memory.state.stock).toEqual([0, 0, 4, 1]);
    expect(memory.state.links).toHaveLength(3);
    expect(memory.calls.map(c => c.quantity)).toEqual([2, 3, 1]);
    expect(
      memory.calls.every(
        c => c.costTarget.beneficiarySectionId === 2 && c.deliveredToId === 101
      )
    ).toBe(true);
  });
  it("issues selected 5+1 instead of oldest lots", async () => {
    const f = fixture();
    await f.issue({
      mode: "manual",
      lots: [
        { lotId: 3, quantity: 5 },
        { lotId: 4, quantity: 1 },
      ],
    });
    expect(memory.state.stock).toEqual([2, 3, 0, 0]);
    expect(memory.state.links).toHaveLength(2);
  });
  it.each(["issue", "link", "stale"])(
    "rolls back every stock/document/link when a later %s fails",
    async failure => {
      const f = fixture();
      if (failure === "issue") memory.failIssue = 2;
      if (failure === "link") memory.failLink = 2;
      if (failure === "stale") memory.state.stock[1] = 0;
      const before = structuredClone(memory.state);
      await expect(f.issue()).rejects.toThrow();
      expect(memory.state).toEqual(before);
    }
  );
  it.each(["technician", "it_member", "delegate", "observer"])(
    "rechecks and rejects %s before any issue",
    async role => {
      const f = fixture();
      memory.state.actor.role = role;
      await expect(f.issue()).rejects.toThrow("للمستودع");
      expect(memory.calls).toEqual([]);
    }
  );
  it.each([
    "inactive",
    "cancelled",
    "completed",
    "changedWarehouse",
    "changedResult",
  ])("rejects stale authority/workflow: %s", async change => {
    const f = fixture();
    if (change === "inactive") memory.state.actor.isActive = 0;
    else if (change === "changedWarehouse")
      memory.state.requirement.teamWarehouseId = 99;
    else if (change === "changedResult")
      memory.state.requirement.itemResult = "repaired";
    else memory.state.requirement.taskStatus = change;
    await expect(f.issue()).rejects.toThrow();
    expect(memory.calls).toEqual([]);
  });
  it.each([
    [{ lotId: 1, quantity: 2 }],
    [{ lotId: 99, quantity: 6 }],
    [
      { lotId: 1, quantity: 3 },
      { lotId: 2, quantity: 3 },
    ],
  ])(
    "rejects partial, foreign, or excessive lot choices before writing",
    async (...lots: any[]) => {
      const f = fixture();
      await expect(f.issue({ mode: "manual", lots })).rejects.toThrow();
      expect(memory.calls).toEqual([]);
    }
  );
  it("does not reuse a successful issue after the full requirement is recorded", async () => {
    const f = fixture();
    memory.state.actions = [
      {
        id: 1,
        performedById: 20,
        note: JSON.stringify({
          version: 2,
          deliveryDocumentId: 1,
          routeDecisionActionId: 40,
          catalogItemId: 9,
          quantity: 6,
        }),
      },
    ];
    await expect(f.issue()).rejects.toThrow("المتبقي");
    expect(memory.calls).toEqual([]);
  });
});
