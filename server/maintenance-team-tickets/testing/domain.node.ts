import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemo } from "./fixture";
import {
  remainingReturn,
  TeamTicketError,
  type Command,
  type Assignment,
} from "../../../shared/maintenance-team-tickets/model";
let operation = 0;
const cmd = (a: Assignment): Command => ({
  assignmentId: a.id,
  expectedRevision: a.revision,
  operationKey: `test:${++operation}`,
});
const completion = (note = "تم تغيير الجزء واختبار التشغيل") => ({
  note,
  usages: [] as Array<{ catalogItemId: number; used: number }>,
});
const receiptCommands = new Map<string, number[]>();
async function requestConfirmed(
  service: ReturnType<typeof createDemo>["service"],
  actorId: number,
  c: Command,
  inputs: Array<{
    catalogItemId?: number;
    name?: string;
    unit: string;
    quantity: number;
  }>
) {
  if (!receiptCommands.has(c.operationKey)) {
    const preview = await service.previewMaterials(
      actorId,
      c.assignmentId,
      inputs
    );
    receiptCommands.set(
      c.operationKey,
      preview.rows
        .filter(n => n.catalogItemId && n.shortage === 0)
        .map(n => n.catalogItemId!)
    );
  }
  return service.requestMaterials(
    actorId,
    c,
    inputs,
    receiptCommands.get(c.operationKey)
  );
}
async function setup() {
  const d = createDemo();
  const ticket = (await d.store.read()).tickets[0];
  const { assignmentMode: _m, closed: _c, ...ref } = ticket;
  const a = await d.service.assign(1, { ...ref, teamId: 21 });
  return {
    ...d,
    a,
    ref,
    current: async () =>
      (await d.store.read()).assignments.find(x => x.id === a.id)!,
  };
}
async function rejectsCode(
  run: Promise<unknown>,
  code: TeamTicketError["code"]
) {
  await assert.rejects(
    run,
    e => e instanceof TeamTicketError && e.code === code
  );
}

test("all active members see the same assigned ticket; no exclusive claim", async () => {
  const d = await setup();
  assert.equal((await d.service.requiredNow(3))[0].id, d.a.id);
  assert.equal((await d.service.requiredNow(4))[0].id, d.a.id);
  assert.equal((await d.service.read(5)).assignments.length, 0);
  assert.equal((await d.service.read(5)).tickets.length, 0);
});
test("outsider and inactive users cannot execute", async () => {
  const d = await setup();
  await rejectsCode(
    d.service.submitOutcome(5, cmd(d.a), "ok", completion("")),
    "FORBIDDEN"
  );
  await rejectsCode(d.service.read(7), "FORBIDDEN");
});
test("foreign manager cannot review the ticket", async () => {
  const d = await setup();
  await d.service.submitOutcome(3, cmd(d.a), "ok", completion(""));
  await rejectsCode(
    d.service.review(6, cmd(await d.current()), "approve_result", "اعتماد"),
    "FORBIDDEN"
  );
});
test("ticket and item ownership verified; named tickets excluded", async () => {
  const d = await setup();
  await rejectsCode(
    d.service.assign(1, { ...d.ref, ticketId: 999, teamId: 21 }),
    "INVALID"
  );
  const named = (await d.store.read()).tickets[3];
  const { closed: _c, assignmentMode: _m, ...ref } = named;
  await rejectsCode(d.service.assign(1, { ...ref, teamId: 21 }), "INVALID");
  assert.equal((await d.store.read()).tickets[3].assignmentMode, "name");
});
test("duplicate assignment cannot create two executions", async () => {
  const d = await setup();
  await assert.rejects(d.service.assign(1, { ...d.ref, teamId: 21 }));
  assert.equal((await d.store.read()).assignments.length, 1);
});
test("empty team, inactive warehouse and mismatched location rejected", async () => {
  const d = createDemo();
  const team = await d.service.createTeam(1, {
    name: "فريق جديد",
    warehouseId: 20,
  });
  const {
    closed: _c,
    assignmentMode: _m,
    ...ref
  } = (await d.store.read()).tickets[0];
  await rejectsCode(
    d.service.assign(1, { ...ref, teamId: team.id }),
    "INVALID"
  );
  await rejectsCode(
    d.service.createTeam(1, { name: "فريق", warehouseId: 999 }),
    "INVALID"
  );
  await rejectsCode(
    d.service.assign(1, {
      ...ref,
      teamId: 21,
      location: { siteId: 2, sectionId: 11 },
    }),
    "INVALID"
  );
});
test("team management requires manager and internal active technician", async () => {
  const d = createDemo();
  await rejectsCode(
    d.service.createTeam(3, { name: "فريق", warehouseId: 20 }),
    "FORBIDDEN"
  );
  await rejectsCode(d.service.setMembership(1, 21, 2, true), "INVALID");
  await rejectsCode(d.service.setMembership(1, 21, 7, true), "FORBIDDEN");
});
test("duplicate team names blocked; membership reactivation reuses row", async () => {
  const d = createDemo();
  await rejectsCode(
    d.service.createTeam(1, { name: " فريق الصيانة العامة ", warehouseId: 20 }),
    "CONFLICT"
  );
  await d.service.setMembership(1, 21, 3, false);
  await d.service.setMembership(1, 21, 3, true);
  assert.equal(
    (await d.store.read()).memberships.filter(
      m => m.teamId === 21 && m.userId === 3
    ).length,
    1
  );
});
test("cannot orphan open execution by disabling team or last member", async () => {
  const d = await setup();
  await rejectsCode(d.service.setTeamActive(1, 21, false), "CONFLICT");
  await d.service.setMembership(1, 21, 3, false);
  await rejectsCode(d.service.setMembership(1, 21, 4, false), "CONFLICT");
  await rejectsCode(
    d.service.submitOutcome(3, cmd(d.a), "ok", completion("")),
    "FORBIDDEN"
  );
});
test("ok records healthy finding, not a fabricated repair, and removes whole team action", async () => {
  const d = await setup();
  await d.service.submitOutcome(4, cmd(d.a), "ok", completion(""));
  assert.equal((await d.current()).outcome, "ok");
  assert.equal((await d.service.requiredNow(3)).length, 0);
  assert.equal((await d.store.read()).actions.at(-1)!.actorId, 4);
  assert.match((await d.store.read()).actions.at(-1)!.note, /لا يحتاج إصلاح/);
});
test("fix details required; blank submission rolls back", async () => {
  const d = await setup();
  await rejectsCode(
    d.service.submitOutcome(3, cmd(d.a), "fixed", completion(" ")),
    "INVALID"
  );
  assert.equal((await d.current()).revision, d.a.revision);
});
test("fix without requested material can record other materials", async () => {
  const d = await setup();
  await d.service.submitOutcome(3, cmd(d.a), "fixed", {
    ...completion(),
    otherMaterials: "استخدم شريط عزل من عهدة سابقة",
  });
  assert.match((await d.store.read()).actions.at(-1)!.note, /شريط عزل/);
  assert.equal((await d.store.read()).deliveries.length, 0);
});
test("parallel outcomes: exactly one wins and one actor is logged", async () => {
  const d = await setup();
  const results = await Promise.allSettled([
    d.service.submitOutcome(3, cmd(d.a), "ok", completion("")),
    d.service.submitOutcome(4, cmd(d.a), "fixed", completion()),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await d.store.read()).actions.length, 2);
});
test("same operation retry returns original result; changed payload rejected", async () => {
  const d = await setup();
  const c = cmd(d.a);
  const first = await d.service.submitOutcome(3, c, "ok", completion(""));
  assert.deepEqual(
    await d.service.submitOutcome(3, c, "ok", completion("")),
    first
  );
  await rejectsCode(
    d.service.submitOutcome(3, c, "fixed", completion()),
    "CONFLICT"
  );
  assert.equal((await d.store.read()).actions.length, 2);
});
test("blocked requires reason; responsible return reopens for every active member", async () => {
  const d = await setup();
  await rejectsCode(
    d.service.submitOutcome(3, cmd(d.a), "blocked", completion("")),
    "INVALID"
  );
  await d.service.submitOutcome(
    3,
    cmd(d.a),
    "blocked",
    completion("تعذر الوصول")
  );
  assert.equal((await d.service.requiredNow(4)).length, 0);
  await d.service.review(
    1,
    cmd(await d.current()),
    "return_to_team",
    "تم توفير الوصول"
  );
  assert.equal((await d.service.requiredNow(4)).length, 1);
});
test("external request requires reason and does not approve path C itself", async () => {
  const d = await setup();
  await rejectsCode(
    d.service.submitOutcome(3, cmd(d.a), "external", completion("")),
    "INVALID"
  );
  await d.service.submitOutcome(
    3,
    cmd(d.a),
    "external",
    completion("فحص الضاغط عند ورشة متخصصة")
  );
  assert.equal((await d.current()).stage, "external_requested");
  await rejectsCode(
    d.service.review(3, cmd(await d.current()), "approve_external", "موافق"),
    "FORBIDDEN"
  );
});
test("external handover stays warehouse-owned and verifies actual active team receiver", async () => {
  const d = await setup();
  await d.service.submitOutcome(
    3,
    cmd(d.a),
    "external",
    completion("إصلاح خارجي")
  );
  await d.service.review(
    1,
    cmd(await d.current()),
    "approve_external",
    "اعتماد المسؤول المحاكى"
  );
  await rejectsCode(
    d.service.review(
      1,
      cmd(await d.current()),
      "external_handover",
      "انتهت دورة C المحاكية",
      4
    ),
    "FORBIDDEN"
  );
  await rejectsCode(
    d.service.review(
      2,
      cmd(await d.current()),
      "external_handover",
      "انتهت دورة C المحاكية",
      5
    ),
    "FORBIDDEN"
  );
  await d.service.review(
    2,
    cmd(await d.current()),
    "external_handover",
    "محاكاة اكتمال دورة C وتسليم الأصل",
    4
  );
  assert.equal((await d.current()).stage, "reinstall_required");
  await rejectsCode(
    d.service.submitOutcome(4, cmd(await d.current()), "ok", completion("")),
    "CONFLICT"
  );
  await d.service.submitOutcome(
    3,
    cmd(await d.current()),
    "fixed",
    completion("إعادة تركيب واختبار")
  );
});
test("explicitly confirmed full team stock received through gateway, distributed over original lots", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 101, unit: "قطعة", quantity: 4 },
  ]);
  assert.equal((await d.current()).stage, "ready_to_repair");
  assert.deepEqual(
    (await d.store.read()).deliveries.map(x => x.quantity),
    [2, 2]
  );
  assert.equal(
    (await d.store.inspectPhysical()).lots
      .filter(l => l.warehouseId === 20 && l.catalogItemId === 101)
      .reduce((n, l) => n + l.quantity, 0),
    1
  );
});
test("shortage creates need only, never partial self-issue", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 102, unit: "قطعة", quantity: 3 },
  ]);
  assert.equal((await d.current()).stage, "waiting_material");
  assert.equal((await d.store.read()).deliveries.length, 0);
  await rejectsCode(
    d.service.receiveMaterial(
      4,
      cmd(await d.current()),
      (await d.store.read()).needs[0].id
    ),
    "CONFLICT"
  );
});
test("material input rejects empty, duplicate, fractional and negative quantities", async () => {
  const d = await setup();
  const good = { catalogItemId: 101, unit: "قطعة", quantity: 1 };
  for (const input of [
    [],
    [good, good],
    [{ ...good, quantity: 0.5 }],
    [{ ...good, quantity: -1 }],
  ])
    await rejectsCode(
      requestConfirmed(d.service, 3, cmd(d.a), input),
      "INVALID"
    );
  assert.equal((await d.store.read()).needs.length, 0);
});
test("failed multi-item issue rolls back mock documents, stock and need together", async () => {
  const d = await setup();
  const before = await d.store.inspectPhysical();
  d.store.failIssueForCatalog = 102;
  await rejectsCode(
    requestConfirmed(d.service, 3, cmd(d.a), [
      { catalogItemId: 101, unit: "قطعة", quantity: 2 },
      { catalogItemId: 102, unit: "قطعة", quantity: 1 },
    ]),
    "UNAVAILABLE"
  );
  assert.deepEqual(await d.store.inspectPhysical(), before);
  assert.equal((await d.store.read()).needs.length, 0);
});
test("warehouse transfer covers shortage only; another member receives full requirement", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 102, unit: "قطعة", quantity: 3 },
  ]);
  const n = (await d.store.read()).needs[0];
  const supply = await d.service.provideMaterial(
    2,
    cmd(await d.current()),
    n.id,
    "transfer"
  );
  assert.equal(supply.source.quantity, 2);
  await d.service.issueByWarehouse(2, cmd(await d.current()), n.id, 4);
  assert.equal((await d.current()).stage, "ready_to_repair");
  assert.ok((await d.store.read()).deliveries.every(x => x.receivedById === 4));
});
test("warehouse purchase stays pending; warehouse receipt does not equal technician receipt", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 103, unit: "قطعة", quantity: 2 },
  ]);
  const n = (await d.store.read()).needs[0];
  await d.service.provideMaterial(2, cmd(await d.current()), n.id, "purchase");
  const supply = (await d.store.read()).supplies[0];
  await rejectsCode(
    d.service.provideMaterial(2, cmd(await d.current()), n.id, "purchase"),
    "CONFLICT"
  );
  await d.service.receivePurchase(2, cmd(await d.current()), supply.id);
  assert.equal((await d.current()).stage, "waiting_material");
  await rejectsCode(
    d.service.receiveMaterial(3, cmd(await d.current()), n.id),
    "CONFLICT"
  );
  await d.service.provideMaterial(2, cmd(await d.current()), n.id, "transfer");
  await d.service.issueByWarehouse(2, cmd(await d.current()), n.id, 3);
  assert.equal((await d.current()).stage, "ready_to_repair");
});
test("main stock covers shortage: purchase blocked and full transfer required", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 102, unit: "قطعة", quantity: 3 },
  ]);
  await rejectsCode(
    d.service.provideMaterial(
      2,
      cmd(await d.current()),
      (await d.store.read()).needs[0].id,
      "purchase"
    ),
    "CONFLICT"
  );
});
test("partial main stock: no partial transfer; buy gap then transfer full shortage", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 102, unit: "قطعة", quantity: 11 },
  ]);
  const n = (await d.store.read()).needs[0];
  await rejectsCode(
    d.service.provideMaterial(2, cmd(await d.current()), n.id, "transfer"),
    "CONFLICT"
  );
  const purchase = await d.service.provideMaterial(
    2,
    cmd(await d.current()),
    n.id,
    "purchase"
  );
  assert.equal(purchase.source.quantity, 2);
  await d.service.receivePurchase(
    2,
    cmd(await d.current()),
    (await d.store.read()).supplies[0].id
  );
  const transfer = await d.service.provideMaterial(
    2,
    cmd(await d.current()),
    n.id,
    "transfer"
  );
  assert.equal(transfer.source.quantity, 10);
  await d.service.issueByWarehouse(2, cmd(await d.current()), n.id, 3);
  assert.equal((await d.current()).stage, "ready_to_repair");
});
test("technician cannot create warehouse transfer or purchase", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 103, unit: "قطعة", quantity: 1 },
  ]);
  await rejectsCode(
    d.service.provideMaterial(
      3,
      cmd(await d.current()),
      (await d.store.read()).needs[0].id,
      "purchase"
    ),
    "FORBIDDEN"
  );
});
test("unlisted need preserves original description and warehouse resolves catalog", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { name: "حساس خاص بالمكيف", unit: "قطعة", quantity: 1 },
  ]);
  const n = (await d.store.read()).needs[0];
  await rejectsCode(
    d.service.resolveMaterial(3, cmd(await d.current()), n.id, 103, "مطابقة"),
    "FORBIDDEN"
  );
  await d.service.resolveMaterial(
    2,
    cmd(await d.current()),
    n.id,
    103,
    "مطابقة رقم المصنع"
  );
  const resolved = (await d.store.read()).needs[0];
  assert.equal(resolved.originalName, "حساس خاص بالمكيف");
  assert.equal(resolved.catalogItemId, 103);
});
test("cannot repair before delivery, or healthy-result after material intake", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 103, unit: "قطعة", quantity: 1 },
  ]);
  await rejectsCode(
    d.service.submitOutcome(3, cmd(await d.current()), "fixed", completion()),
    "CONFLICT"
  );
});
test("repair usage must cover every received material, bounded by actual issued", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 101, unit: "قطعة", quantity: 4 },
  ]);
  const links = (await d.store.read()).deliveries;
  await rejectsCode(
    d.service.submitOutcome(4, cmd(await d.current()), "fixed", completion()),
    "INVALID"
  );
  await rejectsCode(
    d.service.submitOutcome(4, cmd(await d.current()), "fixed", {
      note: "إصلاح",
      usages: [{ catalogItemId: 101, used: 5 }],
    }),
    "INVALID"
  );
  assert.ok((await d.store.read()).deliveries.every(x => x.used === null));
});
test("completion creates pending custody only; warehouse confirms original-lot return", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 101, unit: "قطعة", quantity: 4 },
  ]);
  const links = (await d.store.read()).deliveries;
  const before = await d.store.inspectPhysical();
  await d.service.submitOutcome(4, cmd(await d.current()), "fixed", {
    note: "استخدمت قطعتين",
    usages: [{ catalogItemId: 101, used: 2 }],
  });
  assert.deepEqual(await d.store.inspectPhysical(), before);
  assert.equal(
    remainingReturn(await d.store.read(), (await d.store.read()).needs[0].id),
    2
  );
  await rejectsCode(
    d.service.confirmReturn(3, cmd(await d.current()), links[0].needId, [
      { lotId: links[0].lotId, quantity: 2 },
    ]),
    "FORBIDDEN"
  );
  await rejectsCode(
    d.service.confirmReturn(2, cmd(await d.current()), links[0].needId, [
      { lotId: links[0].lotId, quantity: 3 },
    ]),
    "INVALID"
  );
  await d.service.confirmReturn(2, cmd(await d.current()), links[0].needId, [
    { lotId: links[0].lotId, quantity: 2 },
  ]);
  const receipt = (await d.store.inspectPhysical()).receipts[0];
  assert.equal(receipt.lotId, links[0].lotId);
  assert.equal(receipt.originalCost, 5);
});
test("pending return survives completed execution and can be confirmed afterward", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 101, unit: "قطعة", quantity: 2 },
  ]);
  const link = (await d.store.read()).deliveries[0];
  await d.service.submitOutcome(3, cmd(await d.current()), "fixed", {
    note: "استخدمت قطعة",
    usages: [{ catalogItemId: 101, used: 1 }],
  });
  await d.service.review(
    1,
    cmd(await d.current()),
    "approve_result",
    "اعتماد نتيجة الفريق فقط"
  );
  assert.equal((await d.current()).stage, "closed");
  await d.service.confirmReturn(2, cmd(await d.current()), link.needId);
  assert.equal(remainingReturn(await d.store.read(), link.needId), 0);
});
test("return retry never posts twice; failed return leaves custody pending", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 101, unit: "قطعة", quantity: 2 },
  ]);
  const link = (await d.store.read()).deliveries[0];
  await d.service.submitOutcome(3, cmd(await d.current()), "fixed", {
    note: "إصلاح",
    usages: [{ catalogItemId: 101, used: 1 }],
  });
  const c = cmd(await d.current());
  d.store.failNextReturn = true;
  await rejectsCode(d.service.confirmReturn(2, c, link.needId), "UNAVAILABLE");
  assert.equal((await d.store.read()).returns.length, 0);
  await d.service.confirmReturn(2, c, link.needId);
  await d.service.confirmReturn(2, c, link.needId);
  assert.equal((await d.store.inspectPhysical()).receipts.length, 1);
});
test("foreign need and delivery cannot be used across tickets", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 101, unit: "قطعة", quantity: 1 },
  ]);
  const {
    closed: _c,
    assignmentMode: _m,
    ...ref
  } = (await d.store.read()).tickets[1];
  const other = await d.service.assign(1, { ...ref, teamId: 21 });
  await rejectsCode(
    d.service.receiveMaterial(
      3,
      cmd(other),
      (await d.store.read()).needs[0].id
    ),
    "CONFLICT"
  );
  await rejectsCode(
    d.service.submitOutcome(3, cmd(other), "fixed", {
      note: "إصلاح",
      usages: [{ catalogItemId: 101, used: 1 }],
    }),
    "INVALID"
  );
});
test("read results are detached and omit internal replay results", async () => {
  const d = await setup();
  await d.service.submitOutcome(3, cmd(d.a), "ok", completion(""));
  const view = await d.service.read(3);
  view.assignments[0].stage = "closed";
  assert.equal((await d.current()).stage, "awaiting_review");
  assert.equal(view.operations.length, 0);
  assert.equal((await d.service.read(1)).operations.length, 0);
});
test("parallel material requests never issue stock twice", async () => {
  const d = await setup();
  const inputs = [{ catalogItemId: 101, unit: "قطعة", quantity: 1 }];
  const r = await Promise.allSettled([
    requestConfirmed(d.service, 3, cmd(d.a), inputs),
    requestConfirmed(d.service, 4, cmd(d.a), inputs),
  ]);
  assert.equal(r.filter(x => x.status === "fulfilled").length, 1);
  assert.equal((await d.store.inspectPhysical()).deliveries.length, 1);
});
test("material operation retry does not reissue physical documents", async () => {
  const d = await setup();
  const c = cmd(d.a);
  const inputs = [{ catalogItemId: 101, unit: "قطعة", quantity: 4 }];
  await requestConfirmed(d.service, 3, c, inputs);
  await requestConfirmed(d.service, 3, c, inputs);
  assert.equal((await d.store.inspectPhysical()).deliveries.length, 2);
  assert.equal((await d.store.read()).needs.length, 1);
});
test("returned result starts a fresh material round without rewriting earlier consumption or returns", async () => {
  const d = await setup();
  await requestConfirmed(d.service, 3, cmd(d.a), [
    { catalogItemId: 101, unit: "قطعة", quantity: 2 },
  ]);
  const original = (await d.store.read()).deliveries[0];
  await d.service.submitOutcome(3, cmd(await d.current()), "fixed", {
    note: "إصلاح أول",
    usages: [{ catalogItemId: 101, used: 1 }],
  });
  await d.service.review(
    1,
    cmd(await d.current()),
    "return_to_team",
    "ما زال عطل إضافي"
  );
  assert.equal((await d.current()).materialRound, 2);
  await requestConfirmed(d.service, 4, cmd(await d.current()), [
    { catalogItemId: 101, unit: "قطعة", quantity: 1 },
  ]);
  const latest = (await d.store.read()).deliveries.find(
    x => x.id !== original.id
  )!;
  await d.service.submitOutcome(4, cmd(await d.current()), "fixed", {
    note: "إصلاح ثان",
    usages: [{ catalogItemId: 101, used: 1 }],
  });
  assert.equal(
    (await d.store.read()).needs.find(n => n.id === original.needId)!.used,
    1
  );
  await d.service.confirmReturn(2, cmd(await d.current()), original.needId);
  assert.equal(
    (await d.store.read()).returns[0].sourceDeliveryId,
    original.deliveryId
  );
});
test("manager result approval completes execution only, never the source ticket reference", async () => {
  const d = await setup();
  await d.service.submitOutcome(3, cmd(d.a), "ok", completion(""));
  await d.service.review(
    1,
    cmd(await d.current()),
    "approve_result",
    "اعتماد نتيجة سليم"
  );
  assert.equal((await d.current()).stage, "closed");
  assert.equal((await d.store.read()).tickets[0].closed, false);
  await rejectsCode(
    d.service.submitOutcome(4, cmd(await d.current()), "fixed", completion()),
    "CONFLICT"
  );
});
test("separate ticket items do not share outcome or execution state", async () => {
  const d = await setup();
  await d.store.transaction(async s => {
    s.tickets.push({
      ...s.tickets[0],
      ticketItemId: 5999,
      assignmentMode: "unassigned",
    });
  });
  const sibling = await d.service.assign(1, {
    ...d.ref,
    ticketItemId: 5999,
    teamId: 21,
  });
  await d.service.submitOutcome(3, cmd(d.a), "ok", completion(""));
  assert.equal(
    (await d.store.read()).assignments.find(x => x.id === sibling.id)!.stage,
    "action_required"
  );
});

test("stock preview reads availability without issuing, logging or changing revision", async () => {
  const d = await setup();
  const before = await d.store.read();
  const physical = await d.store.inspectPhysical();
  const result = await d.service.previewMaterials(3, d.a.id, [
    { catalogItemId: 101, quantity: 4, unit: "قطعة" },
    { catalogItemId: 102, quantity: 3, unit: "قطعة" },
    { name: "مادة غير مدرجة", quantity: 2, unit: "قطعة" },
  ]);
  assert.deepEqual(
    result.rows.map(n => [n.available, n.shortage]),
    [
      [5, 0],
      [1, 2],
      [null, 2],
    ]
  );
  assert.deepEqual(await d.store.read(), before);
  assert.deepEqual(await d.store.inspectPhysical(), physical);
  await rejectsCode(
    d.service.previewMaterials(5, d.a.id, [
      { catalogItemId: 101, quantity: 1, unit: "قطعة" },
    ]),
    "FORBIDDEN"
  );
});

test("available material request without confirmation creates no delivery; another member can explicitly receive", async () => {
  const d = await setup();
  const physical = await d.store.inspectPhysical();
  await d.service.requestMaterials(3, cmd(d.a), [
    { catalogItemId: 101, quantity: 4, unit: "قطعة" },
  ]);
  assert.equal((await d.current()).stage, "waiting_material");
  assert.equal((await d.store.read()).deliveries.length, 0);
  assert.deepEqual(await d.store.inspectPhysical(), physical);
  const need = (await d.store.read()).needs[0];
  await d.service.receiveMaterial(4, cmd(await d.current()), need.id);
  assert.equal((await d.current()).stage, "ready_to_repair");
  assert.ok((await d.store.read()).deliveries.every(d => d.receivedById === 4));
});

test("confirmation only issues explicitly selected full-stock materials in a mixed request", async () => {
  const d = await setup();
  await d.service.requestMaterials(
    3,
    cmd(d.a),
    [
      { catalogItemId: 101, quantity: 2, unit: "قطعة" },
      { catalogItemId: 102, quantity: 3, unit: "قطعة" },
    ],
    [101]
  );
  const s = await d.store.read();
  assert.equal(
    s.deliveries.reduce((sum, d) => sum + d.quantity, 0),
    2
  );
  assert.equal(
    s.deliveries[0].needId,
    s.needs.find(n => n.catalogItemId === 101)!.id
  );
  assert.equal((await d.current()).stage, "waiting_material");
});

test("invalid or duplicate receipt confirmations cannot create stock effects", async () => {
  const d = await setup();
  const input = [{ catalogItemId: 101, quantity: 2, unit: "قطعة" }];
  for (const confirmation of [[102], [101, 101]])
    await rejectsCode(
      d.service.requestMaterials(3, cmd(d.a), input, confirmation),
      "INVALID"
    );
  await rejectsCode(
    d.service.requestMaterials(
      3,
      cmd(d.a),
      [{ catalogItemId: 102, quantity: 3, unit: "قطعة" }],
      [102]
    ),
    "CONFLICT"
  );
  assert.equal((await d.store.read()).needs.length, 0);
  assert.equal((await d.store.inspectPhysical()).deliveries.length, 0);
});

test("stock reduction after preview rolls back the confirmed request instead of silently receiving less", async () => {
  const d = await setup();
  const input = [{ catalogItemId: 101, quantity: 4, unit: "قطعة" }];
  assert.equal(
    (await d.service.previewMaterials(3, d.a.id, input)).rows[0].shortage,
    0
  );
  const {
    closed: _c,
    assignmentMode: _m,
    ...ref
  } = (await d.store.read()).tickets[1];
  const other = await d.service.assign(1, { ...ref, teamId: 21 });
  await d.service.requestMaterials(
    4,
    cmd(other),
    [{ catalogItemId: 101, quantity: 2, unit: "قطعة" }],
    [101]
  );
  const before = await d.store.inspectPhysical();
  await rejectsCode(
    d.service.requestMaterials(3, cmd(d.a), input, [101]),
    "CONFLICT"
  );
  assert.deepEqual(await d.store.inspectPhysical(), before);
  assert.equal(
    (await d.store.read()).needs.filter(n => n.assignmentId === d.a.id).length,
    0
  );
});

async function returnedMaterial(used = 2) {
  const d = await setup();
  await d.service.requestMaterials(
    3,
    cmd(d.a),
    [{ catalogItemId: 101, quantity: 4, unit: "قطعة" }],
    [101]
  );
  await d.service.submitOutcome(4, cmd(await d.current()), "fixed", {
    note: "استبدال القطع واختبار التشغيل",
    usages: [{ catalogItemId: 101, used }],
  });
  const state = await d.store.read();
  return { ...d, need: state.needs[0], links: state.deliveries };
}

test("aggregate material usage leaves source lot consumption unallocated until warehouse receives return", async () => {
  const d = await returnedMaterial();
  assert.equal(d.need.used, 2);
  assert.equal(remainingReturn(await d.store.read(), d.need.id), 2);
  assert.ok(d.links.every(d => d.used === null));
  // The warehouse can return both unused pieces from either original lot.
  await d.service.confirmReturn(2, cmd(await d.current()), d.need.id, [
    { lotId: d.links[1].lotId, quantity: 2 },
  ]);
  const state = await d.store.read();
  assert.deepEqual(
    state.deliveries.map(d => d.used),
    [2, 0]
  );
  assert.equal(state.returns[0].sourceDeliveryId, d.links[1].deliveryId);
  assert.equal((await d.store.inspectPhysical()).receipts[0].originalCost, 7);
  assert.equal(remainingReturn(state, d.need.id), 0);
});

test("warehouse return validates complete total, original lots, bounds, whole quantities and duplicate lots", async () => {
  const d = await returnedMaterial();
  const lot = d.links[0].lotId;
  for (const allocations of [
    undefined,
    [],
    [{ lotId: lot, quantity: 1 }],
    [{ lotId: 999, quantity: 2 }],
    [{ lotId: lot, quantity: 3 }],
    [
      { lotId: lot, quantity: 1 },
      { lotId: lot, quantity: 1 },
    ],
    [
      { lotId: lot, quantity: 0.5 },
      { lotId: d.links[1].lotId, quantity: 1.5 },
    ],
  ])
    await rejectsCode(
      d.service.confirmReturn(
        2,
        cmd(await d.current()),
        d.need.id,
        allocations
      ),
      "INVALID"
    );
  assert.equal((await d.store.read()).returns.length, 0);
  assert.equal(remainingReturn(await d.store.read(), d.need.id), 2);
});

test("multi-lot return failure rolls back earlier mock receipts; identical retry posts exactly once", async () => {
  const d = await returnedMaterial();
  const before = await d.store.inspectPhysical();
  const c = cmd(await d.current());
  const allocations = d.links.map(link => ({ lotId: link.lotId, quantity: 1 }));
  d.store.failReturnForDelivery = d.links[1].deliveryId;
  await rejectsCode(
    d.service.confirmReturn(2, c, d.need.id, allocations),
    "UNAVAILABLE"
  );
  assert.deepEqual(await d.store.inspectPhysical(), before);
  assert.equal((await d.store.read()).returns.length, 0);
  const result = await d.service.confirmReturn(2, c, d.need.id, allocations);
  assert.deepEqual(
    await d.service.confirmReturn(2, c, d.need.id, allocations),
    result
  );
  assert.equal((await d.store.inspectPhysical()).receipts.length, 2);
});

test("duplicate aggregate usage and foreign return need are rejected", async () => {
  const d = await setup();
  await d.service.requestMaterials(
    3,
    cmd(d.a),
    [{ catalogItemId: 101, quantity: 4, unit: "قطعة" }],
    [101]
  );
  await rejectsCode(
    d.service.submitOutcome(3, cmd(await d.current()), "fixed", {
      note: "إصلاح",
      usages: [
        { catalogItemId: 101, used: 1 },
        { catalogItemId: 101, used: 1 },
      ],
    }),
    "INVALID"
  );
  await d.service.submitOutcome(3, cmd(await d.current()), "fixed", {
    note: "إصلاح",
    usages: [{ catalogItemId: 101, used: 2 }],
  });
  const {
    closed: _c,
    assignmentMode: _m,
    ...ref
  } = (await d.store.read()).tickets[1];
  const other = await d.service.assign(1, { ...ref, teamId: 21 });
  await rejectsCode(
    d.service.confirmReturn(2, cmd(other), (await d.store.read()).needs[0].id, [
      { lotId: 1, quantity: 2 },
    ]),
    "INVALID"
  );
});

test("zero return finalizes per-document consumption without warehouse return, and all-unused remains returnable", async () => {
  const full = await returnedMaterial(4);
  assert.equal(remainingReturn(await full.store.read(), full.need.id), 0);
  assert.deepEqual(
    (await full.store.read()).deliveries.map(d => d.used),
    [2, 2]
  );
  const unused = await returnedMaterial(0);
  assert.equal(remainingReturn(await unused.store.read(), unused.need.id), 4);
  await unused.service.confirmReturn(
    2,
    cmd(await unused.current()),
    unused.need.id,
    unused.links.map(d => ({ lotId: d.lotId, quantity: d.quantity }))
  );
  assert.deepEqual(
    (await unused.store.read()).deliveries.map(d => d.used),
    [0, 0]
  );
});
