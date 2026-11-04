import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { router, protectedProcedure, gateSecurityProcedure } from "../routers/_shared/procedures";
import {
  GATE_SECURITY_JOB_STATUSES,
  GATE_SECURITY_MUTATION_PATHS,
  GATE_SECURITY_QUERY_PATHS,
  GATE_SECURITY_TRANSLATION_FIELDS,
  gateSecurityHttpAllowed,
  gateSecurityPageAllowed,
  gateSecurityRpcAllowed,
} from "../../shared/gate-security-policy";
import { APP_ROLE } from "../../shared/roles";
import { assertMediaAccess, mediaAccessPort } from "../_core/authz/media-access";
import {
  assertGateSecurityMediaReference,
  assertGateSecurityResourceAccess,
  assertGateSecurityRpc,
  gateSecurityResourcePort,
  isGateSecurityJob,
  type GateSecurityJobScope,
  type GateSecurityResourcePort,
} from "../_core/authz/gate-security-guard";

const gate = { id: 9, role: "gate_security", isActive: 1 };
const scope = (patch: Partial<GateSecurityJobScope> = {}): GateSecurityJobScope => ({
  id: 1, ticketId: 100, ticketItemId: null, status: "waiting_gate_exit",
  ticketMaintenancePath: "C", itemTicketId: null, itemMaintenancePath: null,
  purchaseTitle:"Exact title",delegateId:30,delegateReceiptStatus:"accepted",delegateReceiptById:30,
  warehousePreparedAt:"2026-11-04 10:00:00",delegateReceiptAt:"2026-11-04 10:01:00",preparationRevision:1,...patch,
});
const records = [
  scope(),
  scope({ id: 2, ticketItemId: 200, ticketMaintenancePath: "B", itemTicketId: 100, itemMaintenancePath: "C", status: "purchase_cycle" }),
  scope({ id: 3, status: "waiting_gate_entry" }),
  scope({ id: 4, status: "waiting_warehouse_preparation" }),
  scope({ id: 5, ticketMaintenancePath: "B" }),
  scope({ id: 6, ticketItemId: 200, itemTicketId: 999, itemMaintenancePath: "C" }),
];
function fixturePort(rows = records): GateSecurityResourcePort {
  return { jobs: vi.fn(async ids => rows.filter(job => ids.includes(job.id))) };
}
const queries = vi.fn(() => [{ id: 1 }]);
const mutations = vi.fn(() => ({ success: true }));
const jobs = vi.spyOn(gateSecurityResourcePort, "jobs");
const api = router({
  externalMaintenance: router({
    listForGate: gateSecurityProcedure.query(() => queries()),
    approveGateExit: gateSecurityProcedure.input(z.object({ jobId: z.number(), carrierName: z.string() })).mutation(() => mutations()),
    approveGateEntry: gateSecurityProcedure.input(z.object({ jobId: z.number(), carrierName: z.string() })).mutation(() => mutations()),
    getByTicket: protectedProcedure.input(z.object({ ticketId: z.number() })).query(() => queries()),
  }),
  translation: router({
    getBatchTranslations: protectedProcedure.input(z.object({ entityType: z.string(), entityIds: z.array(z.number()), fieldNames: z.array(z.string()).optional() })).query(() => queries()),
  }),
  tickets: router({
    list: protectedProcedure.query(() => queries()),
    getById: protectedProcedure.input(z.object({ id: z.number() })).query(() => queries()),
    create: protectedProcedure.input(z.object({ title: z.string() })).mutation(() => mutations()),
  }),
  users: router({ list: protectedProcedure.query(() => queries()) }),
  purchaseOrders: router({ create: protectedProcedure.mutation(() => mutations()) }),
  auth: router({ logout: protectedProcedure.mutation(() => mutations()) }),
});
const caller = (role = "gate_security", isActive = 1) => api.createCaller({ user: { ...gate, role, isActive }, req: {}, res: {} } as any);
beforeEach(() => {
  vi.clearAllMocks();
  jobs.mockImplementation(async ids => records.filter(job => ids.includes(job.id)));
});

describe("Gate security is an exact capability boundary", () => {
  it.each(GATE_SECURITY_QUERY_PATHS)("retains the gate workspace read %s", path => {
    expect(gateSecurityRpcAllowed(gate, "query", path)).toBe(true);
  });
  it.each(GATE_SECURITY_MUTATION_PATHS)("retains the gate workspace action %s", path => {
    expect(gateSecurityRpcAllowed(gate, "mutation", path)).toBe(true);
  });
  it.each([
    "tickets.list", "tickets.listPaginated", "tickets.getById", "tickets.create", "tickets.approveGateExit",
    "tickets.approveGateEntry", "tickets.listForGate", "users.list", "users.create", "catalog.items.list",
    "purchaseOrders.create", "purchaseOrders.saveDraft", "purchaseOrders.getById", "inventory.list", "reports.costReport",
    "externalMaintenance.getByTicket", "externalMaintenance.listForWarehouse", "externalMaintenance.prepareByWarehouse",
    "externalMaintenance.receiveByWarehouse", "construction.projects.list", "attachments.list", "attachments.add",
    "externalMaintenance.listForGate.extra", "externalMaintenance/listForGate", "ExternalMaintenance.listForGate",
    "externalMaintenance.approveGateExit%00", "future.read",
  ])("denies general, legacy and lookalike RPC %s", path => {
    for (const type of ["query", "mutation", "subscription"]) {
      expect(() => assertGateSecurityRpc(gate, type, path)).toThrow();
    }
  });
  it("does not confuse query and mutation grants", () => {
    expect(gateSecurityRpcAllowed(gate, "mutation", "externalMaintenance.listForGate")).toBe(false);
    expect(gateSecurityRpcAllowed(gate, "query", "externalMaintenance.approveGateExit")).toBe(false);
  });
  it("blocks disabled accounts while retaining logout", () => {
    const disabled = { ...gate, isActive: 0 };
    expect(gateSecurityRpcAllowed(disabled, "query", "auth.me")).toBe(false);
    expect(gateSecurityRpcAllowed(disabled, "mutation", "externalMaintenance.approveGateExit")).toBe(false);
    expect(gateSecurityRpcAllowed(disabled, "mutation", "auth.logout")).toBe(true);
  });
  it.each(Object.values(APP_ROLE).filter(role => role !== "gate_security"))("does not change %s's capability checks", role => {
    const actor = { ...gate, role };
    expect(gateSecurityRpcAllowed(actor, "mutation", "future.action")).toBe(true);
    expect(gateSecurityHttpAllowed(actor, "POST", "/api/export/inventory")).toBe(true);
    expect(() => assertGateSecurityRpc(actor, "mutation", "future.action")).not.toThrow();
  });
  it("leaves unauthenticated requests to the existing authentication guard", () => {
    expect(gateSecurityRpcAllowed(null, "query", "auth.me")).toBe(true);
  });
});

describe("Gate pages and protected HTTP", () => {
  it.each(["/gate-security", "/gate-security?tab=entry", "/notifications", "/notifications#today"])("allows workspace support page %s", path => {
    expect(gateSecurityPageAllowed(path)).toBe(true);
  });
  it.each(["/", "/tickets", "/tickets/100", "/users", "/catalog", "/purchase-orders", "/gate-security/extra", "/gate-security-other"])("blocks guessed page %s", path => {
    expect(gateSecurityPageAllowed(path)).toBe(false);
  });
  it("permits only media GET requests, subject to their separate document guard", () => {
    expect(gateSecurityHttpAllowed(gate, "GET", "/api/media")).toBe(true);
    expect(gateSecurityHttpAllowed({ ...gate, isActive: 0 }, "GET", "/api/media")).toBe(false);
  });
  it.each([
    ["GET", "/api/tickets/100/pdf"], ["GET", "/api/export/po/100/pdf"], ["GET", "/api/export/tickets"],
    ["GET", "/api/export/workflow-guide"], ["POST", "/api/upload"], ["POST", "/api/upload-url"],
    ["POST", "/api/export/html-to-pdf"], ["POST", "/api/media"], ["GET", "/api/media/extra"],
  ])("blocks %s %s", (method, path) => {
    expect(gateSecurityHttpAllowed(gate, method, path)).toBe(false);
  });
});

describe("Gate operations require a real Path C job", () => {
  it.each(GATE_SECURITY_JOB_STATUSES)("retains the existing gate/history stage %s", status => {
    expect(isGateSecurityJob(scope({ status }))).toBe(true);
  });
  it("supports secondary Path C items without treating their parent's other path as gate work", () => {
    expect(isGateSecurityJob(records[1])).toBe(true);
    expect(isGateSecurityJob(scope({ ticketItemId: 200, itemTicketId: 100, itemMaintenancePath: "B" }))).toBe(false);
    expect(isGateSecurityJob(records[5])).toBe(false);
    expect(isGateSecurityJob(records[4])).toBe(false);
  });
  it("does not expose an asset still being prepared by the warehouse", () => {
    expect(isGateSecurityJob(records[3])).toBe(false);
  });
  it.each(["externalMaintenance.approveGateExit", "externalMaintenance.approveGateEntry"])("rejects malformed or unrelated job IDs for %s", async path => {
    for (const jobId of [0, -1, 1.5, "1", null, 999, 4, 5, 6]) {
      await expect(assertGateSecurityResourceAccess(gate, "mutation", path, { jobId }, fixturePort())).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("retains stage checks for exit and entry separately", async () => {
    await expect(assertGateSecurityResourceAccess(gate, "mutation", "externalMaintenance.approveGateExit", { jobId: 1 }, fixturePort())).resolves.toBeUndefined();
    await expect(assertGateSecurityResourceAccess(gate, "mutation", "externalMaintenance.approveGateEntry", { jobId: 3 }, fixturePort())).resolves.toBeUndefined();
    await expect(assertGateSecurityResourceAccess(gate, "mutation", "externalMaintenance.approveGateEntry", { jobId: 1 }, fixturePort())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(assertGateSecurityResourceAccess(gate, "mutation", "externalMaintenance.approveGateExit", { jobId: 3 }, fixturePort())).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("scopes translations to existing gate jobs and the fields used by its screen", async () => {
    const port = fixturePort();
    await expect(assertGateSecurityResourceAccess(gate, "query", "translation.getBatchTranslations", {
      entityType: "EXTERNAL_MAINTENANCE_JOB", entityIds: [1, 2, 1], fieldNames: [...GATE_SECURITY_TRANSLATION_FIELDS],
    }, port)).resolves.toBeUndefined();
    expect(port.jobs).toHaveBeenCalledWith([1, 2]);
    await expect(assertGateSecurityResourceAccess(gate, "query", "translation.getEntityTranslations", {
      entityType: "EXTERNAL_MAINTENANCE_JOB", entityId: 1,
    }, port)).resolves.toBeUndefined();
  });
  it("retains a legitimate translation batch containing more than 200 historical gate jobs", async () => {
    const history = Array.from({ length: 250 }, (_, index) => scope({ id: index + 1, status: "closed" }));
    const port = fixturePort(history);
    await expect(assertGateSecurityResourceAccess(gate, "query", "translation.getBatchTranslations", {
      entityType: "EXTERNAL_MAINTENANCE_JOB", entityIds: history.map(job => job.id), fieldNames: ["assetName"],
    }, port)).resolves.toBeUndefined();
    expect(port.jobs).toHaveBeenCalledOnce();
    expect(vi.mocked(port.jobs).mock.calls[0][0]).toHaveLength(250);
  });
  it.each([
    { entityType: "TICKET", entityIds: [1] }, { entityType: "USER", entityIds: [1] },
    { entityType: "EXTERNAL_MAINTENANCE_JOB", entityIds: [1, 999] },
    { entityType: "EXTERNAL_MAINTENANCE_JOB", entityIds: [4] },
    { entityType: "EXTERNAL_MAINTENANCE_JOB", entityIds: [1], fieldNames: ["passwordHash"] },
    { entityType: "EXTERNAL_MAINTENANCE_JOB", entityIds: ["1"] },
  ])("rejects a translation scope bypass %j", async input => {
    await expect(assertGateSecurityResourceAccess(gate, "query", "translation.getBatchTranslations", input, fixturePort())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not load resources for other roles or common gate account helpers", async () => {
    const port = fixturePort();
    await assertGateSecurityResourceAccess({ ...gate, role: "owner" }, "query", "future.read", {}, port);
    await assertGateSecurityResourceAccess(gate, "query", "auth.me", {}, port);
    await assertGateSecurityResourceAccess(gate, "query", "externalMaintenance.listForGate", undefined, port);
    expect(port.jobs).not.toHaveBeenCalled();
  });
});

describe("Gate media follows the external job rather than a known URL", () => {
  it.each([
    {delegateReceiptStatus:null},{purchaseTitle:""},{delegateReceiptById:31},{preparationRevision:0},{delegateReceiptAt:"2026-11-04 09:00:00"},
  ])("does not expose legacy/unaccepted pre-exit media or actions: %j",async patch=>{
    const port=fixturePort([scope(patch)]);
    await expect(assertGateSecurityMediaReference(gate,{kind:"external",id:1,parentId:100},port)).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(assertGateSecurityResourceAccess(gate,"mutation","externalMaintenance.approveGateExit",{jobId:1},port)).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("permits prepared Path C external assets and their secondary items", async () => {
    await expect(assertGateSecurityMediaReference(gate, { kind: "external", id: 1, parentId: 100 }, fixturePort())).resolves.toBeUndefined();
    await expect(assertGateSecurityMediaReference(gate, { kind: "external", id: 2, parentId: 100 }, fixturePort())).resolves.toBeUndefined();
  });
  it.each(["ticket", "po", "reference", "attachment", "signature", "inventory", "delivery", "warehouse", "receipt", "construction", "pm"])("rejects generic %s documents", async kind => {
    const port = fixturePort();
    await expect(assertGateSecurityMediaReference(gate, { kind, id: 1, parentId: 100 }, port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(port.jobs).not.toHaveBeenCalled();
  });
  it("rejects mismatched parents, pre-gate jobs, non-C jobs and disabled users", async () => {
    for (const reference of [
      { kind: "external", id: 1, parentId: 999 }, { kind: "external", id: 4, parentId: 100 },
      { kind: "external", id: 5, parentId: 100 }, { kind: "external", id: 999, parentId: 100 },
    ]) await expect(assertGateSecurityMediaReference(gate, reference, fixturePort())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertGateSecurityMediaReference({ ...gate, isActive: 0 }, { kind: "external", id: 1, parentId: 100 }, fixturePort())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not alter the media checks of other roles", async () => {
    const port = fixturePort();
    await expect(assertGateSecurityMediaReference({ ...gate, role: "warehouse" }, { kind: "po", id: 1 }, port)).resolves.toBeUndefined();
    expect(port.jobs).not.toHaveBeenCalled();
  });
  it.each(["ticket", "po", "reference"])("rejects known %s media through the actual shared file guard", async kind => {
    await expect(assertMediaAccess(gate, "cmms/uploads/known-file.jpg", {
      references: async () => [{ kind, id: 1, parentId: 100 }], authorize: mediaAccessPort.authorize,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(jobs).not.toHaveBeenCalled();
  });
  it("does not treat an old own upload as authorization for a gate account", async () => {
    const authorize = vi.fn();
    await expect(assertMediaAccess(gate, `cmms/uploads/u-${gate.id}/unlinked.jpg`, {
      references: async () => [], authorize,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(authorize).not.toHaveBeenCalled();
  });
  it.each([1, 2])("permits job %s's real external media through the shared file guard", async id => {
    const key = `cmms/uploads/external-${id}.jpg`;
    await expect(assertMediaAccess(gate, key, {
      references: async () => [{ kind: "external", id, parentId: 100 }], authorize: mediaAccessPort.authorize,
    })).resolves.toBe(key);
    expect(jobs).toHaveBeenCalledWith([id]);
  });
});

describe("The actual tRPC chain enforces the gate policy before resolvers", () => {
  it("retains gate listing and valid exit/entry actions", async () => {
    await expect(caller().externalMaintenance.listForGate()).resolves.toEqual([{ id: 1 }]);
    await expect(caller().externalMaintenance.approveGateExit({ jobId: 1, carrierName: "Fixture" })).resolves.toEqual({ success: true });
    await expect(caller().externalMaintenance.approveGateEntry({ jobId: 3, carrierName: "Fixture" })).resolves.toEqual({ success: true });
    expect(mutations).toHaveBeenCalledTimes(2);
  });
  it("blocks direct guessed ticket/user/purchase APIs before resolvers", async () => {
    const calls = [
      () => caller().tickets.list(), () => caller().tickets.getById({ id: 100 }),
      () => caller().users.list(), () => caller().tickets.create({ title: "forbidden" }),
      () => caller().purchaseOrders.create(), () => caller().externalMaintenance.getByTicket({ ticketId: 100 }),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries).not.toHaveBeenCalled();
    expect(mutations).not.toHaveBeenCalled();
    expect(jobs).not.toHaveBeenCalled();
  });
  it("rejects unrelated gate IDs and translation types before their resolvers", async () => {
    await expect(caller().externalMaintenance.approveGateExit({ jobId: 5, carrierName: "Fixture" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().translation.getBatchTranslations({ entityType: "TICKET", entityIds: [100] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mutations).not.toHaveBeenCalled();
    expect(queries).not.toHaveBeenCalled();
  });
  it("retains translations for authorized gate jobs", async () => {
    await expect(caller().translation.getBatchTranslations({
      entityType: "EXTERNAL_MAINTENANCE_JOB", entityIds: [1, 2], fieldNames: ["assetName"],
    })).resolves.toEqual([{ id: 1 }]);
    expect(jobs).toHaveBeenCalledWith([1, 2]);
  });
  it("keeps inactive gate accounts unable to read while retaining logout", async () => {
    await expect(caller("gate_security", 0).externalMaintenance.listForGate()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("gate_security", 0).auth.logout()).resolves.toEqual({ success: true });
  });
  it("does not constrain the administrator's existing gate workflow", async () => {
    await expect(caller("admin").externalMaintenance.approveGateExit({ jobId: 5, carrierName: "Fixture" })).resolves.toEqual({ success: true });
    expect(jobs).not.toHaveBeenCalled();
  });
});
