import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemo } from "../../server/maintenance-team-tickets/testing/fixture";
import { createTicketTeamExecutionRouter } from "../../server/routers/maintenance-teams/execution.router";
import { searchTicketIdentityCandidates, type IdentityReaders } from "../../server/maintenance-team-tickets/material-identity-reader";
import { materialSupplyRemaining } from "../../shared/maintenance-team-tickets/material-routing";
import { materialSection } from "../../shared/maintenance-team-tickets/warehouse-materials";
import type { TicketIdentityContext } from "../../shared/catalog-material-identity";
import { rankTicketMaterialCandidates } from "../../server/maintenance-team-tickets/material-catalog-search";
import { router as rootRouter } from "../../server/routers/_shared/procedures";

let seq = 0;
async function setup() {
  const d = createDemo(); const a = await d.service.assign(1, { ...(await d.store.read()).tickets[0], teamId: 21 });
  const command = async () => ({ assignmentId: a.id, expectedRevision: (await d.store.read()).assignments[0].revision, operationKey: `identity:${++seq}` });
  await d.service.registerMaterialNeed(3, await command(), { name: "فلتر زيت كبير احمر تجربة", quantity: 3, unit: "قطعة" });
  const need = (await d.store.read()).needs[0]; return { ...d, a, need, command };
}
function readers() {
  const calls: any[] = [];
  const deps: IdentityReaders = {
    searchCatalog: async (search, limit) => { calls.push(["catalog", search, limit]); return [
      { id: 101, nameAr: "قاطع", nameEn: "Breaker", code: "CAT-101", unit: "قطعة" },
      { id: 102, nameAr: "زيت", nameEn: "Oil", code: "CAT-102", unit: "لتر" },
    ]; },
    requireWarehouse: async id => { calls.push(["warehouse", id]); return { id }; }, mainWarehouse: async () => ({ id: 10 }),
    balances: async (ids, warehouseId) => { calls.push(["balances", ids, warehouseId]); return [{ catalogItemId: 101, warehouseId, inventoryId: warehouseId + 1, availableQuantity: warehouseId === 20 ? 5 : 9, unit: "قطعة", ambiguous: false }]; },
  };
  return { deps, calls };
}
test("identity context retains original technician wording, total quantity and ticket reference without changing stock", async () => {
  const d = await setup(); const physical = await d.store.inspectPhysical(); const before = await d.store.read();
  const context = await d.service.materialIdentityContext(2, d.a.id, d.need.id);
  assert.equal(context.originalName, "فلتر زيت كبير احمر تجربة"); assert.equal(context.requestedQuantity, 3); assert.equal(context.ticketNumber, d.a.ticketNumber); assert.equal(context.warehouseId, 20);
  assert.deepEqual(await d.store.inspectPhysical(), physical); assert.deepEqual(await d.store.read(), before);
});
test("technicians/managers/outside users/inactive accounts cannot read warehouse identity context", async () => {
  const d = await setup(); for (const id of [1, 3, 5, 7]) await assert.rejects(d.service.materialIdentityContext(id, d.a.id, d.need.id));
});
for (const role of ["warehouse", "owner", "admin"]) test(`${role} can identify material with fresh active-account authority`, async () => {
  const d = await setup(); await d.store.transaction(async s => { s.users.push({ id: 9, role, active: true, name: role }); });
  assert.equal((await d.service.materialIdentityContext(9, d.a.id, d.need.id)).needId, d.need.id);
  await d.store.transaction(async s => { s.users.find(u => u.id === 9)!.active = false; }); await assert.rejects(d.service.materialIdentityContext(9, d.a.id, d.need.id));
});
test("identity lookup rejects other need, old material round, ended ticket and already resolved catalog identity", async () => {
  for (const alteration of ["other", "round", "closed", "resolved", "stage"]) {
    const d = await setup(); await d.store.transaction(async s => {
      if (alteration === "round") s.needs[0].round = 99;
      if (alteration === "closed") s.tickets[0].closed = true;
      if (alteration === "resolved") { s.needs[0].catalogItemId = 101; s.needs[0].unit = "قطعة"; }
      if (alteration === "stage") s.assignments[0].stage = "awaiting_review";
    });
    await assert.rejects(d.service.materialIdentityContext(2, d.a.id, alteration === "other" ? 999 : d.need.id));
  }
});
test("candidate lookup searches independently and batches both authoritative warehouse balances, with no unit filtering", async () => {
  const d = await setup(); const context = await d.service.materialIdentityContext(2, d.a.id, d.need.id); const r = readers();
  const result = await searchTicketIdentityCandidates(context, "  Duracell  ", r.deps);
  assert.deepEqual(r.calls.find(x => x[0] === "catalog"), ["catalog", "Duracell", 30]); assert.equal(r.calls.filter(x => x[0] === "balances").length, 2);
  assert.equal(result.items.length, 2); assert.equal(result.items[0].teamAvailability.availableQuantity, 5); assert.equal(result.items[0].mainWarehouseAvailability.availableQuantity, 9);
  assert.equal(result.items[1].unit, "لتر"); assert.equal(result.items[1].teamAvailability.availableQuantity, 0);
});
test("empty results skip stock reads; ambiguous inventory remains visible for review", async () => {
  const d = await setup(); const context = await d.service.materialIdentityContext(2, d.a.id, d.need.id); const r = readers(); r.deps.searchCatalog = async () => [];
  assert.equal((await searchTicketIdentityCandidates(context, "missing", r.deps)).items.length, 0); assert.equal(r.calls.filter(x => x[0] === "balances").length, 0);
  const r2 = readers(); r2.deps.balances = async (_ids, warehouseId) => [{ catalogItemId: 101, warehouseId, inventoryId: null, availableQuantity: 0, unit: "قطعة", ambiguous: true }];
  assert.equal((await searchTicketIdentityCandidates(context, "", r2.deps)).items[0].teamAvailability.ambiguous, true);
});
test("catalog/reference reader errors do not turn into false zero availability", async () => {
  const d = await setup(); const context = await d.service.materialIdentityContext(2, d.a.id, d.need.id); const r = readers();
  r.deps.balances = async () => { throw new Error("read failed"); }; await assert.rejects(searchTicketIdentityCandidates(context, "", r.deps), /read failed/);
});
test("warehouse approves catalog unit and quantity without moving stock or erasing original wording", async () => {
  const d = await setup(); const before = await d.store.read(); const physical = await d.store.inspectPhysical();
  await d.store.transaction(async s => { s.catalog.push({ id: 999, name: "زيت", unit: "لتر", active: true }); });
  await d.service.resolveMaterial(2, await d.command(), d.need.id, 999, "مطابقة", 4);
  const linked = (await d.store.read()).needs[0];
  assert.equal(linked.catalogItemId, 999); assert.equal(linked.unit, "لتر");
  assert.equal(linked.requested, 4); assert.equal(linked.originalName, before.needs[0].originalName);
  assert.equal(materialSection(await d.store.read(), linked, 9999), "waiting");
  const audit = JSON.parse((await d.store.read()).actions.at(-1)!.note).identityReview;
  assert.deepEqual(audit.before, { catalogItemId: null, name: linked.originalName, originalName: linked.originalName, unit: "", requestedQuantity: 3 });
  assert.deepEqual(audit.after, { catalogItemId: 999, name: "زيت", originalName: linked.originalName, unit: "لتر", requestedQuantity: 4 });
  assert.equal((await d.service.prepareSupply(2, d.a.id, d.need.id, "purchase")).unit, "لتر");
  assert.deepEqual(await d.store.inspectPhysical(), physical);
});
test("identity linking still denies duplicate catalog identities", async () => {
  const d = await setup();
  await d.store.transaction(async s => { s.needs.push({ ...s.needs[0], id: 999, catalogItemId: 101 }); });
  await assert.rejects(d.service.resolveMaterial(2, await d.command(), d.need.id, 101, "مطابقة"), /موجود/);
  assert.equal((await d.store.read()).needs[0].catalogItemId, null);
});
test("linking only identifies and recalculates shortage; retry cannot create a duplicate match or move inventory", async () => {
  const d = await setup(); const physical = await d.store.inspectPhysical(); const c = await d.command();
  const result = await d.service.resolveMaterial(2, c, d.need.id, 101, "مطابقة وصف الفني بالصنف الصحيح");
  assert.deepEqual(await d.service.resolveMaterial(2, c, d.need.id, 101, "مطابقة وصف الفني بالصنف الصحيح"), result);
  const s = await d.store.read(); assert.equal(s.needs[0].catalogItemId, 101); assert.equal(s.needs[0].name, "قاطع كهربائي"); assert.equal(s.needs[0].originalName, "فلتر زيت كبير احمر تجربة");
  assert.equal(materialSupplyRemaining(s, s.needs[0]), 0); assert.equal(s.assignments[0].stage, "waiting_material"); assert.deepEqual(await d.store.inspectPhysical(), physical);
});
test("authenticated search API rejects forged warehouse/actor fields and technician before querying candidates", async () => {
  const d = await setup(); let calls = 0;
  const reader = async (context: TicketIdentityContext, search: string) => { calls++; return searchTicketIdentityCandidates(context, search, readers().deps); };
  const router = rootRouter({ ticketTeamExecution: createTicketTeamExecutionRouter(() => d.service, reader) });
  const ctx = (role: string, id: number) => ({ user: { role, id, isActive: 1 }, req: { ip: "test", get: () => "test" } } as any);
  const input = { assignmentId: d.a.id, needId: d.need.id, search: "CAT" };
  await assert.rejects(router.createCaller(ctx("warehouse", 2)).ticketTeamExecution.searchMaterialIdentityCandidates({ ...input, warehouseId: 99 } as any)); assert.equal(calls, 0);
  await assert.rejects(router.createCaller(ctx("technician", 3)).ticketTeamExecution.searchMaterialIdentityCandidates(input)); assert.equal(calls, 0);
  const result = await router.createCaller(ctx("warehouse", 2)).ticketTeamExecution.searchMaterialIdentityCandidates(input); assert.equal(result.items.length, 2); assert.equal(result.request.warehouseId, 20);
});

const matchingItems = [
  { id: 1, nameAr: "مسمار 80 مم", nameEn: "Screw 80 mm", unit: "كرتون", code: "01-001" },
  { id: 2, nameAr: "مسمار 10 سم", nameEn: "Screw 100 mm", unit: "حبة", code: "01-002" },
  { id: 3, nameAr: "أسلاك كهربائية حمراء", nameEn: "Red electrical wires", unit: "لفة", code: "02-001" },
];
test("name search normalizes Arabic letters/digits and compares converted measurements without unit filtering", () => {
  const rows = rankTicketMaterialCandidates(matchingItems, "مسمار ٨ سم");
  assert.deepEqual(rows.map(row => row.id), [1, 2]);
  assert.equal(rows[0].measurementStatus, "compatible");
  assert.equal(rows[1].measurementStatus, "conflict");
  assert.equal(rows[0].unit, "كرتون");
  assert.equal(rankTicketMaterialCandidates(matchingItems, "حمراء اسلاك كهربائية")[0].id, 3);
  assert.equal(rankTicketMaterialCandidates(matchingItems, "electrical red wires")[0].id, 3);
  assert.equal(rankTicketMaterialCandidates(matchingItems, "Screw 8 cm")[0].measurementStatus, "compatible");
  assert.equal(rankTicketMaterialCandidates(matchingItems, "01-001")[0].id, 1);
  assert.deepEqual(rankTicketMaterialCandidates(matchingItems, "كرتون"), []);
});
test("large catalog is shortlisted before constant batched balances; consecutive searches do not share results", async () => {
  const d = await setup(), r = readers(), context = await d.service.materialIdentityContext(2, d.a.id, d.need.id);
  const catalog = Array.from({ length: 2000 }, (_, i) => ({ ...matchingItems[0], id: i + 1 }));
  let metadataReads = 0;
  r.deps.searchCatalog = async (search, limit) => { metadataReads++; return rankTicketMaterialCandidates(catalog, search, limit); };
  assert.equal((await searchTicketIdentityCandidates(context, "مسمار 8 سم", r.deps)).items.length, 30);
  assert.equal(metadataReads, 1);
  assert.deepEqual(r.calls.filter(c => c[0] === "balances").map(c => c[1].length), [30, 30]);
  assert.equal((await searchTicketIdentityCandidates(context, "غير موجود", r.deps)).items.length, 0);
  assert.equal(metadataReads, 2); assert.equal(r.calls.filter(c => c[0] === "balances").length, 2);
});
test("units API uses explicit technician capability plus fresh assignment membership, denies forged and missing IDs", async () => {
  const d = await setup(); let reads = 0;
  const api = rootRouter({ ticketTeamExecution: createTicketTeamExecutionRouter(() => d.service, undefined, async () => {
    reads++; return [{ id: 1, nameAr: "حبة", nameEn: "Piece" }];
  }) });
  const caller = (id: number, role = "technician", isActive = 1) => api.createCaller({ user: { id, role, isActive }, req: {} } as any).ticketTeamExecution;
  assert.equal((await caller(3).units({ assignmentId: d.a.id }))[0].nameAr, "حبة");
  for (const id of [5, 7]) await assert.rejects(caller(id).units({ assignmentId: d.a.id }));
  for (const role of ["warehouse", "accountant", "delegate", "gate_guard"]) await assert.rejects(caller(2, role).units({ assignmentId: d.a.id }));
  await assert.rejects(caller(3).units({ assignmentId: 999 }));
  await assert.rejects(caller(3).units({ assignmentId: d.a.id, userId: 1 } as any));
  await assert.rejects(caller(3, "technician", 0).units({ assignmentId: d.a.id }));
  assert.equal(reads, 1);
  await d.store.transaction(async s => { s.memberships.find(m => m.userId === 3)!.active = false; });
  await assert.rejects(caller(3).units({ assignmentId: d.a.id })); assert.equal(reads, 1);
});
for (const role of ["it_member", "it_manager"]) test(`${role} reads units only for their assigned IT work`, async () => {
  const d = await setup();
  await d.store.transaction(async s => { s.users.find(u => u.id === 3)!.role = role;
    s.tickets[0].responsibleDepartment = "maintenance_report_department_it"; s.tickets[0].assignedToId = 3; });
  let reads = 0;
  const api = rootRouter({ ticketTeamExecution: createTicketTeamExecutionRouter(() => d.service, undefined, async () => {
    reads++; return [{ id: 1, nameAr: "حبة", nameEn: "Piece" }];
  }) });
  const caller = api.createCaller({ user: { id: 3, role, isActive: 1 }, req: {} } as any).ticketTeamExecution;
  assert.equal((await caller.units({ assignmentId: d.a.id }))[0].id, 1);
  await d.store.transaction(async s => { s.tickets[0].assignedToId = 4; });
  await assert.rejects(caller.units({ assignmentId: d.a.id })); assert.equal(reads, 1);
});
test("unit options deny a closed or missing parent even if an assignment survives", async () => {
  for (const missing of [false, true]) {
    const d = await setup();
    await d.store.transaction(async s => { if (missing) s.tickets = []; else s.tickets[0].closed = true; });
    await assert.rejects(d.service.materialUnitsContext(3, d.a.id));
  }
});
test("catalog needs use the current server unit, while free text accepts name and quantity only", async () => {
  const d = createDemo(); const a = await d.service.assign(1, { ...(await d.store.read()).tickets[0], teamId: 21 });
  const command = async () => ({ assignmentId: a.id, expectedRevision: (await d.store.read()).assignments[0].revision, operationKey: `authoritative-unit:${++seq}` });
  const physical = await d.store.inspectPhysical();
  const preview = await d.service.previewMaterials(3, a.id, [{ catalogItemId: 101, quantity: 2, unit: "علبة مزورة" }, { name: "مادة حرة", quantity: 7 }]);
  assert.equal(preview.rows[0].unit, "قطعة"); assert.equal(preview.rows[1].unit, "");
  await d.service.registerMaterialNeed(3, await command(), { catalogItemId: 101, quantity: 2, unit: "علبة مزورة" });
  await d.service.registerMaterialNeed(3, await command(), { name: "مادة حرة", quantity: 7 });
  const needs = (await d.store.read()).needs;
  assert.equal(needs[0].unit, "قطعة"); assert.equal(needs[1].unit, ""); assert.equal(needs[1].requested, 7);
  assert.deepEqual(await d.store.inspectPhysical(), physical);
});
test("warehouse repairs a previously linked mismatch only on the same catalog item, with exact audit and replay", async () => {
  const d = await setup();
  await d.store.transaction(async s => { s.needs[0].catalogItemId = 101; s.needs[0].unit = "حبة قديمة"; });
  const context = await d.service.materialIdentityContext(2, d.a.id, d.need.id);
  assert.equal(context.catalogItemId, 101); assert.equal(context.catalogUnit, "قطعة");
  const r = readers();
  const readCatalog = r.deps.searchCatalog;
  r.deps.searchCatalog = async (search, limit, catalogItemId) => { assert.equal(search, ""); assert.equal(limit, 1); assert.equal(catalogItemId, 101); return readCatalog(search, limit); };
  const found = await searchTicketIdentityCandidates(context, "unrelated", r.deps);
  assert.deepEqual(found.items.map(item => item.id), [101]);
  const physical = await d.store.inspectPhysical(), c = await d.command();
  await assert.rejects(d.service.resolveMaterial(2, c, d.need.id, 102, "تبديل", 8), /الصنف نفسه/);
  const result = await d.service.resolveMaterial(2, c, d.need.id, 101, "اعتماد الكمية بوحدة الكتالوج", 8);
  assert.deepEqual(await d.service.resolveMaterial(2, c, d.need.id, 101, "اعتماد الكمية بوحدة الكتالوج", 8), result);
  await assert.rejects(d.service.resolveMaterial(2, c, d.need.id, 101, "اعتماد الكمية بوحدة الكتالوج", 9), /مرجع العملية/);
  const state = await d.store.read(), need = state.needs[0], audit = JSON.parse(state.actions.at(-1)!.note).identityReview;
  assert.equal(need.unit, "قطعة"); assert.equal(need.requested, 8); assert.equal(need.originalName, d.need.originalName);
  assert.equal(audit.before.unit, "حبة قديمة"); assert.equal(audit.before.requestedQuantity, 3);
  assert.equal(audit.after.unit, "قطعة"); assert.equal(audit.after.requestedQuantity, 8);
  assert.deepEqual(await d.store.inspectPhysical(), physical);
});
test("identity review denies any supply history including cancelled, physical delivery or usage declaration", async () => {
  for (const history of ["cancelled", "pending", "received", "delivery", "used-zero", "returned"] as const) {
    const d = await setup();
    await d.store.transaction(async s => {
      s.needs[0].catalogItemId = 101; s.needs[0].unit = "حبة";
      if (["cancelled", "pending", "received"].includes(history)) s.supplies.push({ id: 777, needId: d.need.id, kind: "purchase", sourceId: 77, sourceNumber: "PR-77", quantity: 3, status: history as "cancelled" });
      if (history === "used-zero") s.needs[0].used = 0;
      if (history === "delivery" || history === "returned") s.deliveries.push({ id: 888, needId: d.need.id, deliveryId: 88, deliveryNumber: "DLV-88", lotId: 8, inventoryTransactionId: 89, quantity: 3, receivedById: 3, used: null, returned: history === "returned" ? 3 : 0 });
      if (history === "returned") s.returns.push({ id: 889, deliveryLinkId: 888, sourceDeliveryId: 88, returnId: 90, returnNumber: "RTN-90", quantity: 3, actorId: 2 });
    });
    const before = await d.store.read();
    await assert.rejects(d.service.materialIdentityContext(2, d.a.id, d.need.id), /مرتجع سابق/);
    await assert.rejects(d.service.resolveMaterial(2, await d.command(), d.need.id, 101, "مراجعة", 1), /مرتجع سابق/);
    assert.deepEqual(await d.store.read(), before);
  }
});
test("resolve API accepts approved quantity, rejects forged unit, wrong actors, nonintegers and stale/closed needs", async () => {
  const d = await setup();
  const api = rootRouter({ ticketTeamExecution: createTicketTeamExecutionRouter(() => d.service) });
  const caller = (id: number, role: string) => api.createCaller({ user: { id, role, isActive: 1 }, req: {} } as any).ticketTeamExecution;
  const input = { ...await d.command(), needId: d.need.id, catalogItemId: 101, note: "اعتماد الوحدة والكمية", requestedQuantity: 2 };
  for (const requestedQuantity of [0, -1, 1.5]) await assert.rejects(caller(2, "warehouse").resolve({ ...input, requestedQuantity }));
  await assert.rejects(caller(2, "warehouse").resolve({ ...input, unit: "علبة" } as any));
  await assert.rejects(caller(3, "technician").resolve(input));
  await assert.rejects(caller(1, "maintenance_manager").resolve(input));
  await assert.rejects(caller(2, "warehouse").resolve({ ...input, expectedRevision: input.expectedRevision + 1 }));
  await d.store.transaction(async s => { s.tickets[0].closed = true; });
  await assert.rejects(caller(2, "warehouse").resolve(input), /البلاغ الأصلي/);
  await d.store.transaction(async s => { s.tickets[0].closed = false; });
  await caller(2, "warehouse").resolve(input);
  assert.equal((await d.store.read()).needs[0].requested, 2);
});
test("register API permits omitted unit and never accepts a caller's catalog unit as authority", async () => {
  const d = createDemo(); const a = await d.service.assign(1, { ...(await d.store.read()).tickets[0], teamId: 21 });
  const api = rootRouter({ ticketTeamExecution: createTicketTeamExecutionRouter(() => d.service) });
  const caller = api.createCaller({ user: { id: 3, role: "technician", isActive: 1 }, req: {} } as any).ticketTeamExecution;
  const command = async () => ({ assignmentId: a.id, expectedRevision: (await d.store.read()).assignments[0].revision, operationKey: `unit-rpc:${++seq}` });
  await caller.registerMaterialNeed({ ...await command(), need: { name: "مادة جديدة", quantity: 2 } });
  await caller.registerMaterialNeed({ ...await command(), need: { catalogItemId: 101, quantity: 3, unit: "عبوة" } });
  const state = await d.store.read(); assert.equal(state.needs[0].unit, ""); assert.equal(state.needs[1].unit, "قطعة");
});
test("unit review rechecks current catalog data and never invents a missing or inactive unit", async () => {
  for (const invalid of ["blank", "inactive"] as const) {
    const d = await setup(); await d.store.transaction(async s => {
      if (invalid === "blank") s.catalog[0].unit = "  "; else s.catalog[0].active = false;
    });
    const before = await d.store.read();
    await assert.rejects(d.service.resolveMaterial(2, await d.command(), d.need.id, 101, "مراجعة", 2));
    assert.deepEqual(await d.store.read(), before);
  }
  const d = await setup();
  await d.service.materialIdentityContext(2, d.a.id, d.need.id);
  await d.store.transaction(async s => { s.catalog[0].unit = "كرتون"; });
  await d.service.resolveMaterial(2, await d.command(), d.need.id, 101, "اعتماد وحدة الكتالوج الحالية");
  assert.equal((await d.store.read()).needs[0].unit, "كرتون");
});
