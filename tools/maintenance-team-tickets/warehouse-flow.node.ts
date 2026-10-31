import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { transformSync } from "esbuild";
import { createDemo } from "../../server/maintenance-team-tickets/testing/fixture";
import { MaintenanceTeamTicketService } from "../../server/maintenance-team-tickets/service";
import { materialSection } from "../../shared/maintenance-team-tickets/warehouse-materials";
import { materialRouteNote } from "../../shared/maintenance-team-tickets/material-routing";
import type {
  SupplyResult,
  MaterialGateway,
} from "../../server/maintenance-team-tickets/ports";
import { createTicketTeamExecutionRouter } from "../../server/routers/maintenance-teams/execution.router";
import { SqlTicketTeamAssignmentRepository } from "../../server/routers/maintenance-teams/assignment.repository";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { router as rpcRouter } from "../../server/routers/_shared/procedures";

async function setup(catalogItemId = 102, quantity = 3) {
  const d = createDemo();
  const ticket = (await d.store.read()).tickets[0];
  const a = await d.service.assign(1, { ...ticket, teamId: 21 });
  let seq = 0,
    physicalCalls = 0;
  const verified = new Map<number, SupplyResult>();
  let failAfterTransfer = false,
    invalidPurchase = false;
  const service = new MaintenanceTeamTicketService({
    read: () => d.store.read(),
    transaction: work =>
      d.store.transaction(async (state, effects) => {
        const gateway: MaterialGateway = {
          ...effects,
          sourceInventoryId: async () => 800,
          transferForm: async form => {
            physicalCalls++;
            const source = await effects.transfer({
              operationKey: `physical:${++seq}`,
              destinationWarehouseId: form.toWarehouseId,
              catalogItemId,
              quantity: form.items.reduce((sum, x) => sum + x.quantity, 0),
              unit: "قطعة",
            });
            if (failAfterTransfer) throw new Error("after-stock failure");
            const sources = Array.isArray(source) ? source : [source];
            return {
              batchId: seq,
              batchNumber: `TRB-${seq}`,
              sources,
              results: sources.map(s => ({
                success: true,
                fromInventoryId: 800,
                transferNumber: s.sourceNumber,
              })),
            };
          },
          purchaseForm: async h => {
            physicalCalls++;
            const source = await effects.purchase({
              operationKey: `physical:${++seq}`,
              destinationWarehouseId: 10,
              catalogItemId: h.catalogItemId,
              quantity: h.quantity,
              unit: h.unit,
              location: h.location,
            });
            verified.set(source.sourceId, source);
            return {
              id: source.sourceId + 100,
              poNumber: source.sourceNumber,
              source,
            };
          },
          verifySupply: async (_need, _kind, id) => ({
            ...verified.get(id)!,
            ...(invalidPurchase ? { quantity: 999 } : {}),
          }),
        };
        return work(state, gateway);
      }),
  });
  const cmd = async (key = `cmd:${++seq}`) => ({
    assignmentId: a.id,
    expectedRevision: (await d.store.read()).assignments[0].revision,
    operationKey: key,
  });
  await service.requestMaterials(
    3,
    await cmd(),
    [{ catalogItemId, unit: "قطعة", quantity }],
    []
  );
  const needId = (await d.store.read()).needs[0].id;
  const form = {
    fromWarehouseId: 10,
    toWarehouseId: 20,
    items: [
      {
        fromInventoryId: 800,
        quantity: quantity - (catalogItemId === 102 ? 1 : 0),
        lotTrackingToken: "LOT-1",
      },
    ],
  };
  return {
    ...d,
    service,
    a,
    needId,
    cmd,
    form,
    calls: () => physicalCalls,
    failTransfer: () => {
      failAfterTransfer = true;
    },
    invalidPurchase: () => {
      invalidPurchase = true;
    },
  };
}

test("warehouse preflight is read only and authorizes the warehouse, not technicians", async () => {
  const d = await setup(),
    before = await d.store.read(),
    physical = await d.store.inspectPhysical();
  const h = await d.service.prepareSupply(2, d.a.id, d.needId, "transfer");
  assert.equal(h.quantity, 2);
  assert.equal(h.inventoryId, 800);
  assert.deepEqual(await d.store.read(), before);
  assert.deepEqual(await d.store.inspectPhysical(), physical);
  await assert.rejects(
    d.service.prepareSupply(3, d.a.id, d.needId, "transfer"),
    /للمستودع/
  );
  await assert.rejects(
    d.service.prepareSupply(2, d.a.id, d.needId, "purchase"),
    /النقص/
  );
});
test("real form transfer, warehouse recipient issue, usage and return keep the original lot/document", async () => {
  const d = await setup();
  const c = await d.cmd("form:transfer");
  const result = await d.service.transferFromForm(2, c, d.needId, d.form);
  assert.deepEqual(
    await d.service.transferFromForm(2, c, d.needId, d.form),
    result
  );
  assert.equal(d.calls(), 1);
  await d.service.issueByWarehouse(2, await d.cmd(), d.needId, 4);
  await assert.rejects(
    d.service.receiveMaterial(3, await d.cmd(), d.needId),
    /المرحلة/
  );
  let state = await d.store.read();
  assert.ok(state.deliveries.every(d => d.receivedById === 4));
  assert.equal(state.actions.at(-1)!.actorId, 2);
  assert.equal(state.assignments[0].stage, "ready_to_repair");
  await d.service.submitOutcome(4, await d.cmd(), "fixed", {
    note: "إصلاح",
    usages: [{ catalogItemId: 102, used: 2 }],
  });
  state = await d.store.read();
  assert.equal(materialSection(state, state.needs[0], 0), "returns");
  const original = structuredClone(state.deliveries);
  await d.service.confirmReturn(2, await d.cmd(), d.needId, [
    { lotId: original[0].lotId, quantity: 1 },
  ]);
  state = await d.store.read();
  assert.equal(state.returns.length, 1);
  assert.ok(
    original.some(d => d.deliveryId === state.returns[0].sourceDeliveryId)
  );
  assert.equal(materialSection(state, state.needs[0], 0), null);
});
test("form edits cannot bypass source inventory, quantity, warehouses or mandatory lots", async () => {
  const d = await setup();
  for (const form of [
    { ...d.form, fromWarehouseId: 30 },
    { ...d.form, toWarehouseId: 30 },
    { ...d.form, items: [{ ...d.form.items[0], quantity: 1 }] },
    { ...d.form, items: [{ ...d.form.items[0], fromInventoryId: 999 }] },
    { ...d.form, items: [{ ...d.form.items[0], lotTrackingToken: "" }] },
  ])
    await assert.rejects(
      d.service.transferFromForm(2, await d.cmd(), d.needId, form),
      /نموذج التحويل/
    );
  assert.equal(d.calls(), 0);
});
test("stock and ticket links roll back together on post-transfer failure", async () => {
  const d = await setup(),
    before = await d.store.read(),
    physical = await d.store.inspectPhysical();
  d.failTransfer();
  await assert.rejects(
    d.service.transferFromForm(2, await d.cmd(), d.needId, d.form),
    /after-stock/
  );
  assert.deepEqual(await d.store.read(), before);
  assert.deepEqual(await d.store.inspectPhysical(), physical);
});
test("concurrent warehouse transfers cannot cover the same shortage twice", async () => {
  const d = await setup(),
    first = await d.cmd("one"),
    second = await d.cmd("two");
  const results = await Promise.allSettled([
    d.service.transferFromForm(2, first, d.needId, d.form),
    d.service.transferFromForm(2, second, d.needId, d.form),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(d.calls(), 1);
});
test("warehouse issue rejects outsiders, inactive users, warehouse recipients and forged actor roles", async () => {
  const d = await setup(101, 2);
  for (const recipient of [5, 7, 2])
    await assert.rejects(
      d.service.issueByWarehouse(2, await d.cmd(), d.needId, recipient),
      /فريقك|نشط/
    );
  await assert.rejects(
    d.service.issueByWarehouse(3, await d.cmd(), d.needId, 4),
    /للمستودع/
  );
  assert.equal((await d.store.read()).deliveries.length, 0);
  await d.service.issueByWarehouse(2, await d.cmd(), d.needId, 4);
  await assert.rejects(
    d.service.issueByWarehouse(2, await d.cmd(), d.needId, 4),
    /المرحلة/
  );
});
test("purchase forms buy only uncovered gap; retry cannot create a duplicate document", async () => {
  const d = await setup(102, 11),
    c = await d.cmd("purchase:form");
  const h = await d.service.prepareSupply(2, d.a.id, d.needId, "purchase");
  assert.equal(h.quantity, 2);
  await assert.rejects(
    d.service.prepareSupply(2, d.a.id, d.needId, "transfer"),
    /النقص/
  );
  const result = await d.service.purchaseFromForm(2, c, d.needId, {
    date: "2026-10-12",
  });
  assert.deepEqual(
    await d.service.purchaseFromForm(2, c, d.needId, { date: "2026-10-12" }),
    result
  );
  assert.equal(d.calls(), 1);
  await assert.rejects(
    d.service.purchaseFromForm(2, c, d.needId, { date: "2026-10-13" }),
    /مرجع العملية/
  );
  await assert.rejects(
    d.service.prepareSupply(2, d.a.id, d.needId, "purchase"),
    /النقص/
  );
  const state = await d.store.read();
  assert.equal(state.deliveries.length, 0);
  assert.equal(state.supplies[0].status, "pending");
});
test("invalid purchase source rolls back the created source and its ticket operation", async () => {
  const d = await setup(103, 2),
    before = await d.store.read(),
    physical = await d.store.inspectPhysical();
  d.invalidPurchase();
  await assert.rejects(
    d.service.purchaseFromForm(2, await d.cmd(), d.needId, {}),
    /بند الشراء/
  );
  assert.deepEqual(await d.store.read(), before);
  assert.deepEqual(await d.store.inspectPhysical(), physical);
});
test("warehouse sections depend on actual complete team stock; historical returns remain visible", async () => {
  const d = await setup(),
    state = await d.store.read(),
    n = state.needs[0];
  assert.equal(materialSection(state, n, undefined), "waiting");
  assert.equal(materialSection(state, n, 2), "waiting");
  assert.equal(materialSection(state, n, 3), "ready");
  n.catalogItemId = null;
  assert.equal(materialSection(state, n, 100), "waiting");
});
test("strict API issues from authenticated warehouse to an explicit recipient", async () => {
  const d = await setup(101, 2);
  const router = createTicketTeamExecutionRouter((_id, actor, options) => {
    assert.equal(actor.id, 2);
    assert.equal(options?.recipientId, 4);
    return d.service;
  });
  const caller = rpcRouter({ ticketTeamExecution: router }).createCaller({
    user: { id: 2, role: "warehouse", isActive: 1 },
    req: {},
    res: {},
  } as any).ticketTeamExecution;
  await assert.rejects(
    caller.issue({
      ...(await d.cmd()),
      needId: d.needId,
      recipientId: 4,
      actorId: 3,
    } as any)
  );
  await caller.issue({ ...(await d.cmd()), needId: d.needId, recipientId: 4 });
  assert.equal((await d.store.read()).deliveries[0].receivedById, 4);
});
test("canonical transfer batch uses supplied transaction; default per-item failures remain isolated", async () => {
  const file = "server/_core/db/warehouses.ts",
    text = fs.readFileSync(file, "utf8"),
    ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    n =>
      ts.isFunctionDeclaration(n) &&
      n.name?.text === "createWarehouseTransferBatch"
  )!;
  const js = transformSync(declaration.getText(ast).replace(/^export\s+/, ""), {
    loader: "ts",
  }).code;
  let provider = 0,
    calls: any[] = [],
    fail = false;
  const tx = { insert: () => ({ values: async () => [{ insertId: 12 }] }) };
  const fn = new Function(
    "generateBatchNumber",
    "getDb",
    "warehouseTransferBatches",
    "createWarehouseTransfer",
    `${js};return createWarehouseTransferBatch;`
  )(
    async (supplied: any) => {
      if (supplied) assert.equal(supplied, tx);
      return "TRB-1";
    },
    async () => {
      provider++;
      return tx;
    },
    {},
    async (_item: any, supplied: any) => {
      calls.push(supplied);
      if (fail) throw new Error("lot failed");
      return { transferNumber: "TR-1" };
    }
  );
  const form = {
    fromWarehouseId: 10,
    toWarehouseId: 20,
    createdById: 2,
    items: [{ fromInventoryId: 800, quantity: 2 }],
  };
  await fn(form, tx);
  assert.equal(provider, 0);
  assert.equal(calls[0], tx);
  await assert.rejects(
    fn(
      {
        ...form,
        items: [...form.items, { fromInventoryId: 801, quantity: 1 }],
      },
      tx
    ),
    /صنف واحد/
  );
  fail = true;
  await assert.rejects(fn(form, tx), /lot failed/);
  const result = await fn(form);
  assert.equal(provider, 1);
  assert.equal(result.results[0].success, false);
  assert.equal(calls.at(-1), undefined);
});
test("existing purchase form sends ticket linkage only for tickets; ordinary and PMV2 submits retain their API contract", () => {
  const file = "client/src/pages/purchase/CreatePurchaseOrder.tsx",
    ast = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
  let initializer: ts.Node | undefined;
  function find(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "handleSubmit"
    )
      initializer = node.initializer;
    ts.forEachChild(node, find);
  }
  find(ast);
  const js = transformSync(`const submit = ${initializer!.getText(ast)};`, {
    loader: "ts",
  }).code;
  for (const source of ["ordinary", "pmv2", "tickets"]) {
    const bodies: any[] = [];
    let keys = 0;
    const scope = {
      validatePurchaseForm: () => true,
      validateMaterialLinkedPurchase: () => true,
      isLinkedTicketActionBlocked: false,
      isReturnReplacement: false,
      supplierReturnPlanId: undefined,
      fromIdeaId: undefined,
      ticketId: 1001,
      ticketItemId: 5001,
      hasMaterialPurchaseContext: source !== "ordinary",
      isTicketMaterial: source === "tickets",
      materialRequestItemId: 12,
      purchaseContextPayload: () => ({
        siteId: 1,
        sectionId: 11,
        assetId: 111,
      }),
      notes: "note",
      buildItemsPayload: () => [
        { catalogItemId: 101, quantity: 3, unit: "قطعة" },
      ],
      ticketTeamAssignmentId: 100,
      ticketTeamNeedId: 12,
      ticketTeamRevision: 2,
      ticketWarehouseExtraQuantity: 0,
      ticketOperationKey: { current: null },
      crypto: {
        randomUUID: () => {
          keys++;
          if (source !== "tickets")
            throw new Error("Unexpected operation key in legacy purchase");
          return "test-key";
        },
      },
      params: new URLSearchParams(
        source === "pmv2" ? "pmv2RequestItemId=12" : "ticketTeamNeedId=12"
      ),
      createMut: { mutate: (body: any) => bodies.push(body) },
      toast: {
        error: () => {
          throw new Error("Unexpected validation failure");
        },
      },
      t: {},
    };
    const submit = new Function(...Object.keys(scope), `${js};return submit;`)(
      ...Object.values(scope)
    );
    submit();
    submit();
    assert.equal(bodies.length, 2);
    assert.equal(
      bodies[0].pmv2RequestItemId,
      source === "pmv2" ? 12 : undefined
    );
    assert.equal(
      bodies[0].ticketTeam?.assignmentId,
      source === "tickets" ? 100 : undefined
    );
    assert.equal(keys, source === "tickets" ? 1 : 0);
    if (source === "tickets")
      assert.deepEqual(bodies[0].ticketTeam, bodies[1].ticketTeam);
  }
});
test("existing transfer form reads independent ticket context without inventing a PMV2 request", () => {
  const file = "client/src/pages/inventory/WarehouseTransfer.tsx",
    ast = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
  const code = ast.statements
    .filter(
      n =>
        ts.isFunctionDeclaration(n) &&
        ["parsePositiveInt", "readMaterialTransferHandoff"].includes(
          n.name?.text ?? ""
        )
    )
    .map(n => n.getText(ast))
    .join("\n");
  const js = transformSync(code, { loader: "ts" }).code;
  const common =
    "fromWarehouseId=10&toWarehouseId=20&inventoryId=800&quantity=3&unit=piece";
  const read = (search: string) =>
    new Function("window", `${js};return readMaterialTransferHandoff();`)({
      location: { search },
    });
  const ticket = read(
    `?ticketTeamNeedId=12&ticketTeamAssignmentId=100&ticketTeamRevision=2&ticketId=1001&ticketNumber=MT-1&${common}`
  );
  assert.equal(ticket.source, "tickets");
  assert.equal(ticket.ticketId, 1001);
  assert.equal(ticket.requestId, 100);
  assert.equal(ticket.taskNumber, "MT-1");
  const pmv2 = read(
    `?pmv2RequestItemId=12&pmv2RequestId=200&pmv2TaskNumber=PM-1&${common}`
  );
  assert.equal(pmv2.source, "pmv2");
  assert.equal(pmv2.ticketId, undefined);
  assert.equal(pmv2.requestId, 200);
  assert.equal(
    read(
      `?ticketTeamNeedId=12&pmv2RequestItemId=12&pmv2RequestId=200&${common}`
    ),
    null
  );
});
test("warehouse queue classifies mixed materials and historical returns with one batched read; named queue stays unchanged", async () => {
  const queries: string[] = [],
    dialect = new MySqlDialect();
  const db: any = {
    execute: async (query: any) => {
      const q = dialect.sqlToQuery(query);
      queries.push(q.sql);
      assert.ok(q.sql.startsWith("SELECT"));
      if (q.sql.startsWith("SELECT a.id"))
        return [
          [
            {
              assignmentId: 100,
              ticketId: 1001,
              teamId: 21,
              stage: "waiting_material",
            },
            { assignmentId: 101, ticketId: 1002, teamId: 21, stage: "closed" },
          ],
          [],
        ];
      return [
        [
          {
            assignmentId: 100,
            materialRound: 1,
            currentRound: 1,
            catalogItemId: 101,
            requestedQuantity: 3,
            usedQuantity: null,
            issued: 0,
            returned: 0,
            available: 3,
          },
          {
            assignmentId: 100,
            materialRound: 1,
            currentRound: 1,
            catalogItemId: null,
            requestedQuantity: 3,
            usedQuantity: null,
            issued: 0,
            returned: 0,
            available: 99,
          },
          {
            assignmentId: 101,
            materialRound: 1,
            currentRound: 2,
            catalogItemId: 101,
            requestedQuantity: 3,
            usedQuantity: 2,
            issued: 3,
            returned: 0,
            available: 0,
          },
        ],
        [],
      ];
    },
  };
  const repository = new SqlTicketTeamAssignmentRepository(async () => ({
    db,
    tickets: {} as any,
  }));
  const actor = { id: 2, role: "warehouse", active: true };
  const queue = await repository.queue(actor, { materialsOnly: true });
  assert.deepEqual(queue[0].materialSections, ["ready", "waiting"]);
  assert.deepEqual(queue[1].materialSections, ["returns"]);
  assert.equal(queries.length, 4);
  assert.ok(queries[1].includes("inventory_lot_balances"));
  assert.ok(queries.every(q => !q.includes("pmv2")));
  queries.length = 0;
  const original = await repository.queue(actor);
  assert.equal(queries.length, 1);
  assert.equal(original[0].materialSections, undefined);
});
test("material queue keeps each need identity and requires its own transferred shortage before ready classification", async () => {
  const dialect = new MySqlDialect();
  let own = false;
  const queries: string[] = [];
  const db: any = {
    execute: async (query: any) => {
      const q = dialect.sqlToQuery(query);
      queries.push(q.sql);
      assert.ok(q.sql.startsWith("SELECT"));
      if (q.sql.startsWith("SELECT a.id"))
        return [
          [
            {
              assignmentId: 100,
              ticketId: 1001,
              teamId: 21,
              stage: "waiting_material",
            },
          ],
          [],
        ];
      if (q.sql.includes("FROM ticket_team_actions"))
        return [
          [
            {
              assignmentId: 100,
              kind: "needs_material",
              revision: 1,
              note: materialRouteNote(
                { round: 1, catalogItemId: 101, originalName: "فلتر" } as any,
                2,
                "احتياج"
              ),
            },
          ],
          [],
        ];
      if (q.sql.includes("FROM ticket_team_supply_links s"))
        return [
          [
            {
              needId: own ? 12 : 13,
              kind: "transfer",
              quantity: 2,
              status: "received",
            },
          ],
          [],
        ];
      return [
        [
          {
            id: 12,
            assignmentId: 100,
            itemNameSnapshot: "فلتر",
            originalItemName: "فلتر",
            unitSnapshot: "قطعة",
            materialRound: 1,
            currentRound: 1,
            catalogItemId: 101,
            requestedQuantity: 3,
            usedQuantity: null,
            issued: 0,
            returned: 0,
            available: 3,
          },
        ],
        [],
      ];
    },
  };
  const repository = new SqlTicketTeamAssignmentRepository(async () => ({
    db,
    tickets: {} as any,
  }));
  const actor = { id: 2, role: "warehouse", active: true };
  let queue = await repository.queue(actor, { materialsOnly: true });
  assert.deepEqual(queue[0].materialNeeds, [
    { needId: 12, name: "فلتر", unit: "قطعة", section: "waiting" },
  ]);
  assert.equal(queries.length, 4);
  own = true;
  queue = await repository.queue(actor, { materialsOnly: true });
  assert.equal(queue[0].materialNeeds![0].section, "ready");
  queries.length = 0;
  await repository.queue(actor);
  assert.equal(queries.length, 1);
});
