import { test } from "node:test";
import assert from "node:assert/strict";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  loadExecution,
  persistExecution,
  SqlExecutionStore,
} from "../../server/routers/maintenance-teams/execution.repository";
import {
  ProductionMaterialGateway,
  type InventoryWriters,
} from "../../server/routers/maintenance-teams/execution.materials";
import { bridgeTicketExecution } from "../../server/routers/maintenance-teams/execution.workflow";
import { materialRouteNote } from "../../shared/maintenance-team-tickets/material-routing";
import { assertLegacyTeamExecutionAllowed } from "../../server/routers/maintenance-teams/execution.guard";
import { MaintenanceTeamTicketService } from "../../server/maintenance-team-tickets/service";
import { createDemo } from "../../server/maintenance-team-tickets/testing/fixture";
import type { Snapshot } from "../../shared/maintenance-team-tickets/model";
import fs from "node:fs";
import ts from "typescript";
import { transformSync } from "esbuild";
import { createTicketTeamExecutionRouter } from "../../server/routers/maintenance-teams/execution.router";
import { TICKET_TEAM_EXECUTION_OVERRIDE_ROLES } from "../../shared/maintenance-team-tickets/execution-permissions";
import { TICKET_MATERIAL_REQUEST_EVENT } from "../../shared/maintenance-team-tickets/warehouse-navigation";
import { createTicketMaterialPurchase } from "../../server/routers/maintenance-teams/purchase-form";
import { router as rpcRouter } from "../../server/routers/_shared/procedures";

const dialect = new MySqlDialect();
const tech = { id: 3, role: "technician", active: true };
const manager = { id: 1, role: "maintenance_manager", active: true };
const warehouse = { id: 2, role: "warehouse", active: true };
async function snapshot(): Promise<Snapshot> {
  const d = createDemo();
  await d.service.assign(1, {
    ticketId: 1001,
    ticketItemId: 5001,
    ticketNumber: "SIM-MT-001",
    title: "عطل لوحة الإنارة",
    teamId: 21,
    responsibleManagerId: 1,
    location: { siteId: 1, sectionId: 11, assetId: 111 },
  });
  return d.store.read();
}
function harness(
  options: {
    outsider?: boolean;
    foreignItem?: boolean;
    fail?: string;
    cancelledPurchase?: boolean;
    inactiveUnit?: boolean;
    extraUsers?: Array<{
      id: number;
      name: string;
      role: string;
      isActive: number;
    }>;
  } = {}
) {
  let sequence = 2000;
  const assignment: any = {
    id: 100,
    ticketId: 1001,
    ticketItemId: 5001,
    ticketNumber: "SIM-MT-001",
    titleSnapshot: "Test",
    teamId: 21,
    warehouseId: 20,
    responsibleManagerId: 1,
    siteId: 1,
    sectionId: 11,
    assetId: 111,
    stage: "action_required",
    outcome: null,
    revision: 0,
    materialRound: 1,
    assignedById: 1,
    workflowModel: "sub_ticket",
    itemTicketId: options.foreignItem ? 999 : 1001,
    ticketStatus: "under_inspection",
    itemStatus: "under_inspection",
  };
  const actions: any[] = [],
    operations: any[] = [];
  const writes: Array<{ text: string; params: any[] }> = [];
  let committed: typeof writes = [];
  const tx = {
    async execute(query: any): Promise<any> {
      const q = dialect.sqlToQuery(query),
        text = q.sql,
        params = q.params;
      if (options.fail && text.includes(options.fail))
        throw new Error("injected failure");
      if (!text.startsWith("SELECT")) {
        writes.push({ text, params });
        if (text.startsWith("INSERT INTO ticket_team_actions"))
          actions.push({
            id: ++sequence,
            assignmentId: params[0],
            actorId: params[1],
            kind: params[2],
            note: params[3],
            revision: params[4],
            operationKey: params[5],
            createdAt: new Date(),
          });
        if (text.startsWith("INSERT INTO ticket_team_operations"))
          operations.push({
            operationKey: params[0],
            fingerprint: params[3],
            resultJson: params[4],
          });
        if (text.startsWith("UPDATE ticket_team_assignments"))
          Object.assign(assignment, {
            stage: params[0],
            outcome: params[1],
            revision: params[2],
            materialRound: params[3],
          });
        return [{ insertId: ++sequence, affectedRows: 1 }, []];
      }
      let rows: any[] = [];
      if (text.startsWith("SELECT teamId,ticketId")) rows = [assignment];
      else if (text.includes("FROM maintenance_teams"))
        rows = [
          {
            id: 21,
            name: "Team",
            warehouseId: 20,
            isActive: 1,
            createdById: 1,
            updatedById: 1,
          },
        ];
      else if (text.includes("FROM ticket_team_assignments a"))
        rows = [assignment];
      else if (text.includes("FROM maintenance_team_members"))
        rows = options.outsider
          ? []
          : [
              {
                teamId: 21,
                userId: 3,
                isActive: 1,
                joinedAt: new Date(),
                leftAt: null,
                updatedById: 1,
              },
            ];
      else if (text.includes("FROM users"))
        rows = [
          { id: 1, name: "Manager", role: "maintenance_manager", isActive: 1 },
          { id: 2, name: "Warehouse", role: "warehouse", isActive: 1 },
          { id: 3, name: "Tech", role: "technician", isActive: 1 },
          ...(options.extraUsers ?? []),
        ].filter(u => params.includes(u.id));
      else if (text.includes("FROM warehouses"))
        rows = [{ id: 20, nameAr: "Branch", isActive: 1 }];
      else if (text.includes("FROM catalog_items"))
        rows = [
          {
            id: 101,
            nameAr: "Item",
            unit: "قطعة",
            isActive: 1,
            inactiveUnit: options.inactiveUnit ? 1 : 0,
          },
        ];
      else if (text.includes("FROM ticket_team_supply_links"))
        rows = options.cancelledPurchase
          ? [
              {
                id: 10,
                needId: 11,
                sourceKind: "purchase",
                sourceId: 12,
                sourceNumber: "PR-1",
                linkedQuantity: 3,
                status: "pending",
              },
            ]
          : [];
      else if (text.includes("FROM purchase_order_items"))
        rows = [
          {
            ticketId: 1001,
            ticketItemId: 5001,
            status: "purchase_cancelled",
            poStatus: "approved",
          },
        ];
      else if (text.includes("FROM ticket_team_actions")) rows = actions;
      else if (text.includes("FROM ticket_team_operations")) rows = operations;
      else if (text.includes("COUNT(*)")) rows = [{ total: 1 }];
      else if (text.includes("FROM ticket_items"))
        rows = [{ id: 5001, ticketId: 1001, maintenancePath: "A" }];
      else if (text.includes("supervisorId")) rows = [{ supervisorId: 9 }];
      else if (text.startsWith("SELECT id FROM tickets")) rows = [{ id: 1001 }];
      return [rows, []];
    },
  };
  const db = {
    ...tx,
    async transaction<T>(work: (tx: typeof tx) => Promise<T>) {
      const old = structuredClone({ assignment, actions, operations }),
        start = writes.length;
      try {
        const value = await work(tx);
        committed.push(...writes.slice(start));
        return value;
      } catch (e) {
        Object.assign(assignment, old.assignment);
        actions.splice(0, actions.length, ...old.actions);
        operations.splice(0, operations.length, ...old.operations);
        writes.splice(start);
        throw e;
      }
    },
  };
  return { tx, db, assignment, writes, committed: () => committed };
}
const noEffects: any = new Proxy(
  {},
  {
    get: () => async () => {
      throw new Error("unexpected physical effect");
    },
  }
);

test("canonical purchase form adapter links within injected outer transaction and replays original document", async () => {
  for (const extra of [0, 3]) {
    const h = harness();
    h.assignment.stage = "waiting_material";
    const originalExecute = h.tx.execute.bind(h.tx);
    let calls = 0;
    h.tx.execute = async query => {
      const q = dialect.sqlToQuery(query);
      if (q.sql.includes("FROM ticket_team_material_needs"))
        return [
          [
            {
              id: 12,
              assignmentId: 100,
              materialRound: 1,
              catalogItemId: 101,
              itemNameSnapshot: "Item",
              originalItemName: "Item",
              unitSnapshot: "قطعة",
              requestedQuantity: 3,
              usedQuantity: null,
              requestedById: 3,
              warehouseId: 20,
            },
          ],
          [],
        ];
      if (q.sql.includes("FROM inventory WHERE")) return [[], []];
      if (q.sql.includes("FROM warehouses WHERE type="))
        return [[{ id: 10 }], []];
      if (q.sql.includes("FROM purchase_order_items"))
        return [
          [
            {
              id: 900,
              quantity: 3 + extra,
              unit: "قطعة",
              catalogItemId: 101,
              ticketId: 1001,
              ticketItemId: 5001,
              poNumber: "PR-900",
              poStatus: "pending_review",
            },
          ],
          [],
        ];
      return originalExecute(query);
    };
    const input = {
      ticketTeam: {
        assignmentId: 100,
        needId: 12,
        expectedRevision: 0,
        operationKey: "ticket-po-900",
        warehouseExtraQuantity: extra,
      },
      ticketId: 1001,
      ticketItemId: 5001,
      siteId: 1,
      sectionId: 11,
      assetId: 111,
      items: [{ catalogItemId: 101, unit: "قطعة", quantity: 3 + extra }],
    };
    const create = async () => {
      calls++;
      return {
        id: 800,
        poNumber: "PR-900",
        source: {
          sourceId: 900,
          sourceNumber: "PR-900",
          quantity: 3 + extra,
          status: "pending" as const,
        },
      };
    };
    const first = await h.db.transaction(tx =>
      createTicketMaterialPurchase(tx, warehouse, input, create)
    );
    assert.equal(first.id, 800);
    assert.equal(first.created, true);
    assert.ok(
      h.writes.some(
        q =>
          q.text.startsWith("INSERT INTO ticket_team_supply_links") &&
          q.params.includes(900)
      )
    );
    const replay = await h.db.transaction(tx =>
      createTicketMaterialPurchase(tx, warehouse, input, create)
    );
    assert.equal(replay.id, 800);
    assert.equal(replay.created, false);
    assert.equal(calls, 1);
    const sourceLink = h.writes.find(q =>
      q.text.startsWith("INSERT INTO ticket_team_supply_links")
    )!;
    assert.equal(sourceLink.params[4], 3);
    const operation = h.writes.find(q =>
      q.text.startsWith("INSERT INTO ticket_team_operations")
    )!;
    const savedContext = JSON.parse(operation.params[3]).payload.form
      .ticketTeam;
    assert.equal(
      Object.hasOwn(savedContext, "warehouseExtraQuantity"),
      extra > 0
    );
    await assert.rejects(
      h.db.transaction(tx =>
        createTicketMaterialPurchase(
          tx,
          warehouse,
          { ...input, ticketItemId: 999 },
          create
        )
      ),
      /مرجع العملية/
    );
  }
});

test("purchase form adapter rejects another ticket/location/quantity before creating any PO", async () => {
  for (const changed of [
    { ticketItemId: 999 },
    { siteId: 2 },
    { items: [{ catalogItemId: 101, unit: "قطعة", quantity: 4 }] },
  ]) {
    const h = harness();
    h.assignment.stage = "waiting_material";
    const execute = h.tx.execute.bind(h.tx);
    h.tx.execute = async query => {
      const q = dialect.sqlToQuery(query);
      if (q.sql.includes("FROM ticket_team_material_needs"))
        return [
          [
            {
              id: 12,
              assignmentId: 100,
              materialRound: 1,
              catalogItemId: 101,
              itemNameSnapshot: "Item",
              originalItemName: "Item",
              unitSnapshot: "قطعة",
              requestedQuantity: 3,
              usedQuantity: null,
              requestedById: 3,
              warehouseId: 20,
            },
          ],
          [],
        ];
      if (q.sql.includes("FROM inventory WHERE")) return [[], []];
      if (q.sql.includes("FROM warehouses WHERE type="))
        return [[{ id: 10 }], []];
      return execute(query);
    };
    let calls = 0;
    const input = {
      ticketTeam: {
        assignmentId: 100,
        needId: 12,
        expectedRevision: 0,
        operationKey: "invalid-po",
      },
      ticketId: 1001,
      ticketItemId: 5001,
      siteId: 1,
      sectionId: 11,
      assetId: 111,
      items: [{ catalogItemId: 101, unit: "قطعة", quantity: 3 }],
      ...changed,
    };
    await assert.rejects(
      h.db.transaction(tx =>
        createTicketMaterialPurchase(tx, warehouse, input, async () => {
          calls++;
          throw new Error("unexpected PO creation");
        })
      ),
      /نموذج الشراء/
    );
    assert.equal(calls, 0);
    assert.equal(h.writes.length, 0);
  }
});
test("ticket supply becomes received only with canonical approval, receipt date, quantity and main-warehouse lots", async () => {
  for (const [date, lotBalance, status, expected] of [
    ["2026-10-11", 3, "approved", "received"],
    [null, 3, "approved", "pending"],
    ["2026-10-11", 2, "approved", "pending"],
    ["2026-10-11", 3, "pending_review", "pending"],
  ] as const) {
    const h = harness();
    h.assignment.stage = "waiting_material";
    const execute = h.tx.execute.bind(h.tx);
    h.tx.execute = async query => {
      const q = dialect.sqlToQuery(query);
      if (q.sql.includes("FROM ticket_team_material_needs"))
        return [
          [
            {
              id: 12,
              assignmentId: 100,
              materialRound: 1,
              catalogItemId: 101,
              itemNameSnapshot: "Item",
              originalItemName: "Item",
              unitSnapshot: "قطعة",
              requestedQuantity: 3,
              usedQuantity: null,
              requestedById: 3,
              warehouseId: 20,
            },
          ],
          [],
        ];
      if (q.sql.includes("FROM ticket_team_supply_links"))
        return [
          [
            {
              id: 13,
              needId: 12,
              sourceKind: "purchase",
              sourceId: 900,
              sourceNumber: "PR-900",
              linkedQuantity: 3,
              status: "pending",
            },
          ],
          [],
        ];
      if (q.sql.includes("FROM purchase_order_items"))
        return [
          [
            {
              ticketId: 1001,
              ticketItemId: 5001,
              catalogItemId: 101,
              unit: "قطعة",
              status: "received",
              poStatus: status,
              receivedAt: date,
              receivedQuantity: 3,
            },
          ],
          [],
        ];
      if (q.sql.includes("FROM inventory_lots"))
        return [[{ quantity: lotBalance }], []];
      return execute(query);
    };
    const state = await loadExecution(h.tx, 100, warehouse, {}, false);
    assert.equal(state.supplies[0].status, expected);
    assert.equal(state.deliveries.length, 0);
    assert.equal(h.writes.length, 0);
  }
});

test("SQL execution authorizes active membership and rejects foreign ticket item", async () => {
  const good = await loadExecution(harness().tx, 100, tech, {}, true);
  assert.equal(good.assignments[0].ticketNumber, "SIM-MT-001");
  await assert.rejects(
    loadExecution(harness({ outsider: true }).tx, 100, tech, {}, true),
    /صلاحية/
  );
  await assert.rejects(
    loadExecution(harness({ foreignItem: true }).tx, 100, tech, {}, true),
    /ربط/
  );
  await assert.rejects(
    loadExecution(harness().tx, 100, { ...manager, id: 6 }, {}, true),
    /صلاحية/
  );
});

test("SQL authorizes global executors from current active database roles without team membership", async () => {
  for (const role of TICKET_TEAM_EXECUTION_OVERRIDE_ROLES) {
    const actor = { id: 90, role, active: true };
    const user = { id: 90, name: "Actual executor", role, isActive: 1 };
    const state = await loadExecution(
      harness({ outsider: true, extraUsers: [user] }).tx,
      100,
      actor,
      {},
      true
    );
    assert.equal(state.assignments[0].responsibleManagerId, 1);
    assert.equal(state.users.find(u => u.id === actor.id)!.role, role);
    for (const isActive of [0])
      await assert.rejects(
        loadExecution(
          harness({ extraUsers: [{ ...user, isActive }] }).tx,
          100,
          actor,
          {},
          true
        ),
        /صلاحية/
      );
    await assert.rejects(
      loadExecution(
        harness({ extraUsers: [{ ...user, role: "accountant" }] }).tx,
        100,
        actor,
        {},
        true
      ),
      /صلاحية/
    );
  }
});
test("technician's later SQL read retains the privileged executor's actual name in history", async () => {
  const before = await snapshot(),
    state = structuredClone(before),
    a = state.assignments[0];
  a.stage = "awaiting_review";
  a.outcome = "ok";
  a.revision++;
  state.actions.push({
    id: 200,
    assignmentId: a.id,
    actorId: 90,
    kind: "ok",
    note: "Actual execution",
    revision: a.revision,
    at: "now",
    operationKey: "manager-history",
  });
  const h = harness({
    extraUsers: [
      {
        id: 90,
        name: "Actual manager name",
        role: "construction_procurement_manager",
        isActive: 1,
      },
    ],
  });
  await persistExecution(h.tx, before, state, {
    id: 90,
    role: "construction_procurement_manager",
    active: true,
  });
  const read = await loadExecution(h.tx, 100, tech, {}, false);
  assert.equal(read.actions.at(-1)!.actorId, 90);
  assert.equal(read.users.find(u => u.id === 90)!.name, "Actual manager name");
});
test("cancelled purchases no longer reserve demand; inactive units cannot be newly requested", async () => {
  const h = harness({ cancelledPurchase: true, inactiveUnit: true });
  const s = await loadExecution(
    h.tx,
    100,
    warehouse,
    { catalogIds: [101] },
    true
  );
  assert.equal(s.supplies[0].status, "cancelled");
  assert.equal(s.catalog[0].active, false);
});
test("SQL store saves one action/audit/operation and replays retry without another mutation", async () => {
  const translated: any[] = [];
  const h = harness(),
    store = new SqlExecutionStore(100, tech, {}, async () => ({
      db: h.db,
      gateway: () => noEffects,
      queueActionTranslations: async actions => { assert.ok(h.committed().length > 0); translated.push(...actions); },
    }));
  const service = new MaintenanceTeamTicketService(store),
    c = { assignmentId: 100, expectedRevision: 0, operationKey: "retry-once" };
  await service.submitOutcome(3, c, "fixed", { note: "Repaired", usages: [] });
  const count = h.committed().length;
  await service.submitOutcome(3, c, "fixed", { note: "Repaired", usages: [] });
  assert.equal(h.committed().length, count);
  assert.equal(h.assignment.revision, 1);
  assert.equal(translated.length, 1);
  assert.equal(translated[0].note, "Repaired");
  await assert.rejects(
    service.submitOutcome(3, { ...c, operationKey: "different" }, "blocked", {
      note: "Blocked",
      usages: [],
    }),
    /حدّث الصفحة/
  );
  assert.equal(
    h.committed().filter(x => x.text.startsWith("INSERT INTO audit_logs"))
      .length,
    1
  );
});
test("SQL failures in audit and operation persistence roll back entire team action", async () => {
  const translated: any[] = [];
  for (const fail of [
    "INSERT INTO audit_logs",
    "INSERT INTO ticket_team_operations",
  ]) {
    const h = harness({ fail }),
      service = new MaintenanceTeamTicketService(
        new SqlExecutionStore(100, tech, {}, async () => ({
          db: h.db,
          gateway: () => noEffects,
          queueActionTranslations: async actions => { translated.push(...actions); },
        }))
      );
    await assert.rejects(
      service.submitOutcome(
        3,
        { assignmentId: 100, expectedRevision: 0, operationKey: fail },
        "blocked",
        { note: "No access", usages: [] }
      ),
      /injected/
    );
    assert.equal(h.committed().length, 0);
    assert.equal(h.assignment.revision, 0);
    assert.equal(translated.length, 0);
  }
});
test("a failure after physical issue rolls back issue and all team links in the same transaction", async () => {
  const h = harness({ fail: "INSERT INTO audit_logs" });
  const effects = {
    ...noEffects,
    availability: async () => 5,
    issue: async (input: any) => {
      const { sql } = await import("drizzle-orm");
      await h.tx.execute(
        sql`INSERT INTO physical_test_document VALUES (${input.quantity})`
      );
      return [
        {
          deliveryId: 77,
          deliveryNumber: "DN-77",
          lotId: 88,
          inventoryTransactionId: 99,
          catalogItemId: 101,
          warehouseId: 20,
          quantity: 5,
          unit: "قطعة",
          receivedById: 3,
        },
      ];
    },
  };
  const service = new MaintenanceTeamTicketService(
    new SqlExecutionStore(100, tech, { catalogIds: [101] }, async () => ({
      db: h.db,
      gateway: () => effects as any,
    }))
  );
  await assert.rejects(
    service.requestMaterials(
      3,
      { assignmentId: 100, expectedRevision: 0, operationKey: "atomic-issue" },
      [{ catalogItemId: 101, quantity: 5, unit: "قطعة" }],
      [101]
    ),
    /injected/
  );
  assert.equal(h.committed().length, 0);
  assert.equal(h.assignment.revision, 0);
});
test("new needs and delivery links use real auto IDs rather than domain temporary IDs", async () => {
  const before = await snapshot(),
    s = structuredClone(before),
    a = s.assignments[0];
  a.revision++;
  s.needs.push({
    id: 900,
    assignmentId: a.id,
    catalogItemId: 101,
    name: "Item",
    originalName: "Item",
    unit: "قطعة",
    requested: 2,
    used: null,
    requestedById: 3,
    warehouseId: 20,
    round: 1,
  });
  s.deliveries.push({
    id: 901,
    needId: 900,
    deliveryId: 77,
    deliveryNumber: "DN-77",
    lotId: 88,
    inventoryTransactionId: 99,
    quantity: 2,
    receivedById: 3,
    used: null,
    returned: 0,
  });
  const h = harness();
  await persistExecution(h.tx, before, s, tech);
  const delivery = h.writes.find(x =>
    x.text.startsWith("INSERT INTO ticket_team_delivery_links")
  )!;
  assert.equal(delivery.params[0], 2001);
  assert.equal(delivery.params[1], 77);
  assert.equal(delivery.params[3], 88);
});
test("existing need identity review persists approved unit and quantity without overwriting technician source", async () => {
  const before = await snapshot(), a = before.assignments[0];
  before.needs.push({ id: 900, assignmentId: a.id, catalogItemId: 101, name: "Linked", originalName: "وصف الفني الأصلي", unit: "حبة قديمة", requested: 3, used: null, requestedById: 3, warehouseId: 20, round: 1 });
  const state = structuredClone(before); state.assignments[0].revision++;
  Object.assign(state.needs[0], { name: "قاطع كهربائي", unit: "قطعة", requested: 8 });
  const h = harness();
  await persistExecution(h.tx, before, state, warehouse);
  const update = h.writes.find(q => q.text.startsWith("UPDATE ticket_team_material_needs"))!;
  assert.ok(update.text.includes("unitSnapshot=?")); assert.ok(update.text.includes("requestedQuantity=?"));
  assert.deepEqual(update.params, [101, "قاطع كهربائي", "قطعة", 8, null, 900, a.id]);
  assert.ok(!update.text.includes("originalItemName=")); assert.ok(!update.text.includes("requestedById="));
  assert.equal(state.needs[0].originalName, before.needs[0].originalName);
});

function stockGateway(
  s: Snapshot,
  options: { lots?: boolean; failure?: boolean; available?: number } = {},
  actor = tech
) {
  const calls: any[] = [],
    tx = {
      async execute(query: any): Promise<any> {
        const q = dialect.sqlToQuery(query);
        if (q.sql.includes("FROM warehouses"))
          return [[{ id: 20, isActive: 1 }], []];
        if (q.sql.includes("FROM inventory WHERE"))
          return [
            [
              {
                id: 70,
                quantity: options.available ?? 5,
                issueUnit: "قطعة",
                unit: "قطعة",
                isFrozen: 0,
              },
            ],
            [],
          ];
        if (q.sql.includes("FROM inventory_lot_balances"))
          return [
            [
              {
                lotId: 80,
                quantity: 2,
                trackingToken: "TOKEN-A",
                issueUnit: "قطعة",
                catalogItemId: 101,
              },
              {
                lotId: 81,
                quantity: 3,
                trackingToken: "TOKEN-B",
                issueUnit: "قطعة",
                catalogItemId: 101,
              },
            ],
            [],
          ];
        if (q.sql.includes("FROM delivery_documents"))
          return [[{ id: 77, lotId: 80, deliveredToId: 3 }], []];
        throw new Error(`Unexpected SQL: ${q.sql}`);
      },
    };
  const writers: InventoryWriters = {
    lotsEnabled: () => options.lots !== false,
    issue: async (input, current) => {
      assert.equal(current, tx);
      calls.push(input);
      if (options.failure && calls.length === 2)
        throw new Error("issue failure");
      return {
        deliveryDocumentId: 77 + calls.length,
        deliveryNumber: `DN-${calls.length}`,
        lotId: input.lotTrackingToken === "TOKEN-A" ? 80 : 81,
        inventoryTransactionId: 99 + calls.length,
      };
    },
    recipientReturn: async (input, current) => {
      assert.equal(current, tx);
      calls.push(input);
      return {
        returnId: 50,
        returnNumber: "WR-50",
        returnedQuantity: input.returnedQuantity,
      };
    },
    transfer: async () => {
      throw new Error("unexpected");
    },
    createPurchase: async () => {
      throw new Error("unexpected");
    },
    createItems: async () => {
      throw new Error("unexpected");
    },
  };
  return {
    gateway: new ProductionMaterialGateway(
      tx,
      s,
      actor,
      {},
      async () => writers
    ),
    calls,
    tx,
    writers,
  };
}
const issueInput = {
  operationKey: "issue",
  ticketId: 1001,
  ticketNumber: "SIM-MT-001",
  warehouseId: 20,
  catalogItemId: 101,
  quantity: 5,
  unit: "قطعة",
  receiverId: 3,
  location: { siteId: 1, sectionId: 11, assetId: 111 },
};
test("production issue splits real lots, actual self recipient and cost allocation through original writer", async () => {
  const f = stockGateway(await snapshot()),
    deliveries = await f.gateway.issue(issueInput);
  assert.deepEqual(
    f.calls.map(x => [x.quantity, x.lotTrackingToken]),
    [
      [2, "TOKEN-A"],
      [3, "TOKEN-B"],
    ]
  );
  assert.ok(
    f.calls.every(
      x =>
        x.deliveredToId === 3 &&
        x.ticketId === 1001 &&
        x.costAllocations[0].beneficiaryAssetId === 111
    )
  );
  assert.deepEqual(
    deliveries.map(d => d.lotId),
    [80, 81]
  );
});
test("warehouse original lot issue records the warehouse performer separately from the selected technician", async () => {
  const state = await snapshot(),
    f = stockGateway(state, {}, warehouse);
  const deliveries = await f.gateway.issue(issueInput);
  assert.ok(
    f.calls.every(
      x =>
        x.performedById === 2 &&
        x.deliveredToId === 3 &&
        x.assignedTechnicianId === 3
    )
  );
  assert.ok(deliveries.every(x => x.receivedById === 3));
  state.users.find(x => x.id === 3)!.active = false;
  const disabled = stockGateway(state, {}, warehouse);
  await assert.rejects(disabled.gateway.issue(issueInput), /الاستلام/);
  assert.equal(disabled.calls.length, 0);
});
test("privileged executor's original lot issues retain both actual performer and recipient", async () => {
  for (const role of TICKET_TEAM_EXECUTION_OVERRIDE_ROLES) {
    const actor = { id: 90, role, active: true };
    const f = stockGateway(await snapshot(), {}, actor);
    await f.gateway.issue({ ...issueInput, receiverId: actor.id });
    assert.equal(f.calls.length, 2);
    assert.ok(
      f.calls.every(
        x =>
          x.performedById === actor.id &&
          x.deliveredToId === actor.id &&
          x.assignedTechnicianId === actor.id
      )
    );
    assert.deepEqual(
      f.calls.map(x => x.lotTrackingToken),
      ["TOKEN-A", "TOKEN-B"]
    );
  }
});
test("no canonical issue on insufficient stock, wrong actual recipient or disabled lots", async () => {
  for (const options of [{ available: 4 }, { lots: false }]) {
    const f = stockGateway(await snapshot(), options);
    await assert.rejects(f.gateway.issue(issueInput));
    assert.equal(f.calls.length, 0);
  }
  const f = stockGateway(await snapshot());
  await assert.rejects(
    f.gateway.issue({ ...issueInput, receiverId: 4 }),
    /الاستلام/
  );
  assert.equal(f.calls.length, 0);
});
test("returns call canonical return against original physical document and same transaction", async () => {
  const s = await snapshot();
  s.deliveries.push({
    id: 901,
    needId: 900,
    deliveryId: 77,
    deliveryNumber: "DN-77",
    lotId: 80,
    inventoryTransactionId: 99,
    quantity: 2,
    receivedById: 3,
    used: 1,
    returned: 0,
  });
  const f = stockGateway(s);
  const result = await f.gateway.returnToWarehouse({
    operationKey: "return",
    sourceDeliveryId: 77,
    quantity: 1,
    actorId: 3,
  });
  assert.equal(result.returnId, 50);
  assert.equal(f.calls[0].sourceDeliveryDocumentId, 77);
});
test("purchase creates header and one linked item through existing writers in the same transaction", async () => {
  const s = await snapshot(),
    calls: any[] = [];
  const tx = {
    async execute(query: any): Promise<any> {
      const q = dialect.sqlToQuery(query);
      if (q.sql.startsWith("INSERT INTO purchase_order_number_counter"))
        return [{ insertId: 55 }, []];
      if (q.sql.includes("FROM purchase_order_items"))
        return [[{ id: 99 }], []];
      if (q.sql.includes("FROM users")) return [[], []];
      throw new Error(q.sql);
    },
  };
  const writers: InventoryWriters = {
    ...stockGateway(s).writers,
    createPurchase: async (input, current) => {
      assert.equal(current, tx);
      calls.push(input);
      return 88;
    },
    createItems: async (input, current) => {
      assert.equal(current, tx);
      calls.push(input);
    },
  };
  const g = new ProductionMaterialGateway(
    tx,
    s,
    warehouse,
    { requiredDate: "2026-10-20" },
    async () => writers
  );
  const source = await g.purchase({
    operationKey: "po",
    destinationWarehouseId: 10,
    catalogItemId: 101,
    quantity: 3,
    unit: "قطعة",
    location: s.assignments[0].location,
  });
  assert.equal(calls[0].ticketId, 1001);
  assert.equal(calls[0].ticketItemId, 5001);
  assert.equal(calls[0].status, "pending_review");
  assert.equal(calls[1].length, 1);
  assert.equal(calls[1][0].purchaseOrderId, 88);
  assert.equal(calls[1][0].requiredDate, "2026-10-20");
  assert.equal(source.sourceId, 99);
  const invalid = new ProductionMaterialGateway(
    tx,
    s,
    warehouse,
    { requiredDate: "2026-02-30" },
    async () => writers
  );
  await assert.rejects(
    invalid.purchase({
      operationKey: "po-invalid",
      destinationWarehouseId: 10,
      catalogItemId: 101,
      quantity: 3,
      unit: "قطعة",
      location: s.assignments[0].location,
    }),
    /تاريخ/
  );
  assert.equal(calls.length, 2);
});
test("purchase receipt verifies canonical receipt and rejects changed catalog or insufficient physical lot balance", async () => {
  const s = await snapshot(),
    a = s.assignments[0];
  s.needs.push({
    id: 12,
    assignmentId: a.id,
    catalogItemId: 101,
    name: "Item",
    originalName: "Item",
    unit: "قطعة",
    requested: 3,
    used: null,
    requestedById: 3,
    warehouseId: 20,
    round: 1,
  });
  s.supplies.push({
    id: 13,
    needId: 12,
    kind: "purchase",
    sourceId: 14,
    sourceNumber: "PR-1",
    quantity: 3,
    status: "pending",
  });
  for (const [catalogItemId, balance, valid] of [
    [101, 3, true],
    [102, 3, false],
    [101, 2, false],
  ] as const) {
    const tx = {
      async execute(query: any): Promise<any> {
        const q = dialect.sqlToQuery(query);
        assert.ok(q.sql.startsWith("SELECT"));
        if (q.sql.includes("FROM warehouses")) return [[{ id: 10 }], []];
        if (q.sql.includes("FROM purchase_order_items"))
          return [
            [
              {
                ticketId: 1001,
                ticketItemId: 5001,
                poNumber: "PR-1",
                poStatus: "received",
                status: "delivered_to_warehouse",
                catalogItemId,
                unit: "قطعة",
                quantity: 3,
                receivedQuantity: 3,
                receivedAt: new Date(),
              },
            ],
            [],
          ];
        if (q.sql.includes("SUM(b.quantity)"))
          return [[{ quantity: balance }], []];
        throw new Error(q.sql);
      },
    };
    const g = new ProductionMaterialGateway(tx, s, warehouse, {}, async () => {
      throw new Error("must not simulate physical receipt");
    });
    if (valid)
      assert.equal(
        (await g.receivePurchase({ operationKey: "verify", sourceId: 14 }))
          .status,
        "received"
      );
    else
      await assert.rejects(
        g.receivePurchase({ operationKey: "verify", sourceId: 14 })
      );
  }
});
test("approved results bridge to existing ready-for-closure A/B and notify supervisor without closing", async () => {
  for (const materials of [false, true]) {
    const before = await snapshot(),
      s = structuredClone(before),
      a = s.assignments[0];
    a.revision++;
    a.stage = "closed";
    a.outcome = "fixed";
    if (materials)
      s.needs.push({
        id: 900,
        assignmentId: a.id,
        catalogItemId: 101,
        name: "Item",
        originalName: "Item",
        unit: "قطعة",
        requested: 2,
        used: 1,
        requestedById: 3,
        warehouseId: 20,
        round: 1,
      });
    s.actions.push(
      {
        id: 1,
        assignmentId: a.id,
        actorId: 3,
        kind: "fixed",
        note: "Repair details",
        revision: 0,
        operationKey: "fixed",
        at: "now",
      },
      {
        id: 2,
        assignmentId: a.id,
        actorId: 1,
        kind: "approve_result",
        note: "Approved",
        revision: a.revision,
        operationKey: "approve",
        at: "now",
      }
    );
    const h = harness();
    await bridgeTicketExecution(h.tx, before, s, manager);
    const update = h.writes.find(x =>
      x.text.startsWith("UPDATE ticket_items")
    )!;
    assert.match(update.text, /ready_for_closure/);
    assert.equal(update.params[0], materials ? "B" : "A");
    assert.doesNotMatch(
      h.writes.map(x => x.text).join(" "),
      /status='closed'|pmv2_/
    );
    assert.ok(
      h.writes.some(
        x => x.text.includes("INSERT INTO notifications") && x.params[0] === 9
      )
    );
  }
});
test("legacy named/IT flow bypasses team guard; only completed team execution permits actual closure", async () => {
  await assertLegacyTeamExecutionAllowed(
    { id: 1, workflowModel: "department_tasks" },
    undefined,
    "execution",
    {
      execute: async () => {
        throw new Error("must not query");
      },
    }
  );
  const tx = { execute: async () => [[{ id: 1, stage: "closed" }], []] };
  await assertLegacyTeamExecutionAllowed(
    { id: 1, workflowModel: "sub_ticket" },
    undefined,
    "closure",
    tx
  );
  await assert.rejects(
    assertLegacyTeamExecutionAllowed(
      { id: 1, workflowModel: "sub_ticket" },
      undefined,
      "execution",
      tx
    ),
    /مسند لفريق/
  );
});
test("execution router uses authenticated actor, rejects forged actor input and unsupported roles before factory", async () => {
  const demo = createDemo(),
    t = (await demo.store.read()).tickets[0];
  const a = await demo.service.assign(1, { ...t, teamId: 21 });
  let calls = 0;
  const r = createTicketTeamExecutionRouter(() => {
    calls++;
    return demo.service;
  });
  // Match the production namespace so the central technician RPC guard is
  // exercised before the injected domain service, rather than a bare subrouter.
  const app = rpcRouter({ ticketTeamExecution: r });
  const ctx = (id: number, role: string): any => ({
    user: { id, role, isActive: 1 },
    req: { ip: "test", get: () => "test" },
    res: {},
  });
  const c = {
    assignmentId: a.id,
    expectedRevision: a.revision,
    operationKey: "api-fixed",
    outcome: "fixed" as const,
    note: "Actual repair",
    usages: [],
  };
  await assert.rejects(
    app.createCaller(ctx(3, "technician")).ticketTeamExecution.outcome({ ...c, actorId: 1 } as any)
  );
  assert.equal(calls, 0);
  await assert.rejects(
    app.createCaller(ctx(9, "accountant")).ticketTeamExecution.details({ assignmentId: a.id })
  );
  assert.equal(calls, 0);
  await assert.rejects(
    app.createCaller(ctx(5, "technician")).ticketTeamExecution.outcome(c),
    /فريقك/
  );
  await app.createCaller(ctx(3, "technician")).ticketTeamExecution.outcome(c);
  assert.equal((await demo.store.read()).actions.at(-1)?.actorId, 3);
});
test("material requests notify active warehouse users with the consolidated-tab event; other outcomes retain team routing", async () => {
  const before = await snapshot(),
    state = structuredClone(before),
    a = state.assignments[0],
    writes: any[] = [];
  a.stage = "waiting_material";
  a.revision++;
  state.actions.push({
    id: 201,
    assignmentId: a.id,
    actorId: 3,
    kind: "needs_material",
    note: "طلب مادة",
    revision: a.revision,
    at: "now",
    operationKey: "notify-material",
  });
  const tx = {
    execute: async (query: any) => {
      const q = dialect.sqlToQuery(query);
      if (q.sql.startsWith("SELECT maintenanceResponsibleDepartment,assignedToId,reportedById FROM tickets"))
        return [[{ maintenanceResponsibleDepartment: "maintenance_report_department_general", assignedToId: null, reportedById: null }], []];
      if (q.sql.startsWith("SELECT")) {
        assert.match(q.sql, /isActive=1 AND role='warehouse'/);
        return [[{ id: 2 }], []];
      }
      writes.push(q);
      return [{ affectedRows: 1 }, []];
    },
  };
  await bridgeTicketExecution(tx, before, state, tech);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].params.includes(TICKET_MATERIAL_REQUEST_EVENT));
  assert.equal(writes[0].params[0], 2);
  assert.ok(writes[0].params.includes(a.ticketId));
  state.actions.at(-1)!.note = materialRouteNote(
    { round: 1, originalName: "مادة", catalogItemId: 101 } as any,
    2,
    "تسجيل احتياج المادة"
  );
  writes.length = 0;
  await bridgeTicketExecution(tx, before, state, tech);
  assert.ok(
    writes[0].params.includes(`${a.ticketNumber}: تسجيل احتياج المادة`)
  );
  assert.ok(writes[0].params.includes(TICKET_MATERIAL_REQUEST_EVENT));
  state.actions.at(-1)!.kind = "materials_started";
  writes.length = 0;
  await bridgeTicketExecution(tx, before, state, tech);
  assert.equal(writes.length, 0);
  state.actions.at(-1)!.note = "يوجد عائق";
  state.actions.at(-1)!.kind = "blocked";
  writes.length = 0;
  await bridgeTicketExecution(tx, before, state, tech);
  assert.equal(writes[0].params[0], a.responsibleManagerId);
  assert.ok(writes[0].params.includes("ticket_team_action"));
  assert.ok(!writes[0].params.includes(TICKET_MATERIAL_REQUEST_EVENT));
});
test("execution API grants global execution but rejects construction review and actor impersonation", async () => {
  for (const role of TICKET_TEAM_EXECUTION_OVERRIDE_ROLES) {
    const d = createDemo();
    await d.store.transaction(async s => {
      s.users.push({ id: 90, name: "Actual executor", role, active: true });
    });
    const t = (await d.store.read()).tickets[0],
      a = await d.service.assign(1, { ...t, teamId: 21 });
    const router = createTicketTeamExecutionRouter((id, actor) => {
      assert.equal(id, a.id);
      assert.equal(actor.id, 90);
      assert.equal(actor.role, role);
      return d.service;
    });
    const caller = router.createCaller({
      user: { id: 90, role, isActive: 1 },
      req: {},
      res: {},
    } as any);
    assert.equal(
      (await caller.details({ assignmentId: a.id })).assignments.length,
      1
    );
    const c = {
      assignmentId: a.id,
      expectedRevision: a.revision,
      operationKey: `api:${role}`,
      outcome: "fixed" as const,
      note: "Actual repair",
      usages: [],
    };
    await assert.rejects(caller.outcome({ ...c, actorId: 3 } as any));
    await caller.outcome(c);
    assert.equal((await d.store.read()).actions.at(-1)!.actorId, 90);
    if (!["owner", "admin"].includes(role))
      await assert.rejects(
        caller.review({
          assignmentId: a.id,
          expectedRevision: a.revision + 1,
          operationKey: `review:${role}`,
          decision: "approve_result",
          note: "Review",
        }),
        e => (e as { code?: string }).code === "FORBIDDEN"
      );
  }
});
test("external approval enters existing C workflow and cannot fabricate return/handover", async () => {
  const before = await snapshot(),
    s = structuredClone(before),
    a = s.assignments[0];
  before.assignments[0].stage = "external_requested";
  a.stage = "external_in_progress";
  a.revision++;
  s.actions.push({
    id: 1,
    assignmentId: a.id,
    actorId: 1,
    kind: "approve_external",
    note: "Approved external work",
    revision: a.revision,
    operationKey: "external",
    at: "now",
  });
  const h = harness();
  await bridgeTicketExecution(h.tx, before, s, manager);
  assert.ok(
    h.writes.some(
      x =>
        x.text.startsWith("UPDATE ticket_items") &&
        x.text.includes("maintenancePath='C'") &&
        x.text.includes("work_approved")
    )
  );
  s.actions.at(-1)!.kind = "external_handover";
  s.operations.push({
    key: "external",
    fingerprint: JSON.stringify({ payload: { recipientId: 3 } }),
    result: {},
  });
  await assert.rejects(
    bridgeTicketExecution(h.tx, before, s, warehouse),
    /أكمل دورة/
  );
});

// Compile only the actual function declaration, with every boundary injected.
// No core module, server entry point, environment, or DB client is imported.
test("canonical writers honor provided transaction and keep default transaction behavior", async () => {
  const cases = [
    {
      file: "server/_core/db/warehouses.ts",
      name: "createWarehouseTransfer",
      input: {
        fromWarehouseId: 1,
        toWarehouseId: 2,
        fromInventoryId: 3,
        quantity: 1,
        createdById: 2,
      },
      deps: {
        isInventoryLotsEnabled: () => false,
        warehouses: { id: 1 },
        eq: () => true,
      },
    },
    {
      file: "server/_core/db/warehouse-returns.ts",
      name: "createRecipientWarehouseReturn",
      input: {
        sourceDeliveryDocumentId: 1,
        returnedQuantity: 1,
        reason: "Return",
        returnedById: 2,
      },
      deps: { normalizeInventoryQuantity: Number, sql: () => ({}) },
    },
    {
      file: "server/_core/db/external-maintenance.ts",
      name: "handoverExternalMaintenanceAsset",
      input: { jobId: 1, warehouseUserId: 2, actualRecipientId: 3 },
      deps: { sql: () => ({}) },
    },
  ];
  for (const c of cases) {
    const source = ts.createSourceFile(
      c.file,
      fs.readFileSync(c.file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const declaration = source.statements.find(
      n => ts.isFunctionDeclaration(n) && n.name?.text === c.name
    )!;
    const js = transformSync(
      declaration.getText(source).replace(/^export\s+/, ""),
      { loader: "ts", target: "es2022" }
    ).code;
    let provider = 0,
      transactions = 0,
      entered = 0;
    const tx = {
      async execute() {
        entered++;
        throw new Error("boundary reached");
      },
      select() {
        entered++;
        throw new Error("boundary reached");
      },
    };
    const dependencies = {
      ...c.deps,
      getDb: async () => {
        provider++;
        return {
          transaction: async (work: any) => {
            transactions++;
            return work(tx);
          },
        };
      },
      withTransaction: async (work: any) => {
        transactions++;
        return work(tx);
      },
    };
    const fn = new Function(
      ...Object.keys(dependencies),
      `${js}\nreturn ${c.name};`
    )(...Object.values(dependencies));
    await assert.rejects(fn(c.input, tx), /boundary reached/);
    assert.equal(provider, 0);
    assert.equal(transactions, 0);
    assert.equal(entered, 1);
    await assert.rejects(fn(c.input), /boundary reached/);
    assert.equal(transactions, 1);
    assert.equal(entered, 2);
  }
});
test("legacy purchase synchronization cannot regress team result, while named synchronization remains active", async () => {
  const file = "server/routers/purchase/ticket-purchase-workflow.ts";
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  for (const name of [
    "syncPathBTicketFromTicketId",
    "syncPathBTicketItemFromItemId",
  ]) {
    const declaration = source.statements.find(
      n => ts.isFunctionDeclaration(n) && n.name?.text === name
    )!;
    const js = transformSync(
      declaration.getText(source).replace(/^export\s+/, ""),
      { loader: "ts", target: "es2022" }
    ).code;
    for (const team of [true, false]) {
      const updates: any[] = [],
        ticket = {
          id: 1,
          workflowModel: "sub_ticket",
          status: "ready_for_closure",
          maintenancePath: "B",
        };
      const db = {
        getTicketById: async () => ticket,
        getTicketItemById: async () => ({
          ...ticket,
          ticketId: 1,
          itemNumber: 1,
        }),
        getPurchaseOrdersByTicketId: async () => [
          { id: 2, status: "received" },
        ],
        getPurchaseOrdersByTicketItemId: async () => [
          { id: 2, status: "received" },
        ],
        getPOItems: async () => [
          { purchaseOrderId: 2, status: "delivered_to_warehouse" },
        ],
        updateTicket: async (...args: any[]) => {
          updates.push(args);
        },
        updateTicketItem: async (...args: any[]) => {
          updates.push(args);
        },
        syncSingleTicketItem: async (...args: any[]) => {
          updates.push(args);
        },
        addTicketStatusHistory: async () => {},
      };
      const deps = {
        db,
        TERMINAL_TICKET_STATUSES: new Set(["closed"]),
        readTeamTicketExecution: async () =>
          team ? { id: 1, stage: "closed" } : undefined,
        derivePathBTicketPurchaseStatus: () => "work_approved",
        activePathBItemsAfterReplacement: async (items: any[]) => items,
      };
      const fn = new Function(...Object.keys(deps), `${js}\nreturn ${name};`)(
        ...Object.values(deps)
      );
      await fn(1, 3);
      assert.equal(updates.length === 0, team);
    }
  }
});
test("single and batch purchase delivery share a guard before any recipient/stock work for team tickets", async () => {
  const file = "server/routers/purchase/purchase-orders.router.ts",
    source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
  const declaration = source.statements.find(
    n =>
      ts.isFunctionDeclaration(n) &&
      n.name?.text === "assertActualDeliveryRecipient"
  )!;
  const js = transformSync(declaration.getText(source), {
    loader: "ts",
    target: "es2022",
  }).code;
  let reads = 0;
  const deps = {
    assertLegacyTeamExecutionAllowed: async () => {
      throw new Error("team delivery blocked");
    },
    db: {
      getUserById: async () => {
        reads++;
      },
    },
  };
  const fn = new Function(
    ...Object.keys(deps),
    `${js}\nreturn assertActualDeliveryRecipient;`
  )(...Object.values(deps));
  await assert.rejects(fn(3, { id: 1 }), /team delivery blocked/);
  assert.equal(reads, 0);
  assert.equal(
    (
      fs
        .readFileSync(file, "utf8")
        .match(/await assertActualDeliveryRecipient\(/g) ?? []
    ).length,
    2
  );
});
