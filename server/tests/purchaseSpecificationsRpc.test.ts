import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_ROLE } from "../../shared/roles";
import { router } from "../_core/trpc";
import { createPurchaseSpecificationsRouter } from "../routers/purchase/specifications.router";
import { specificationFixture, seedSpecificationReceipt, specificationPeople as people } from "./fixtures/purchaseSpecificationsSeed";

let f: ReturnType<typeof specificationFixture>;
beforeEach(() => { f = specificationFixture(); seedSpecificationReceipt(f); seedSpecificationReceipt(f, { id: 2, status: "rejected" }); });
afterEach(() => f.close());
function caller(actor: any) {
  const api = router({ purchaseSpecifications: createPurchaseSpecificationsRouter(f.ports) });
  return api.createCaller({ user: actor, authenticatedUser: actor, req: {}, res: {} } as any).purchaseSpecifications;
}
const roles = Object.values(APP_ROLE);
const reviewers = ["construction_procurement_manager", "admin", "owner"];
const returnReaders = ["warehouse", "admin", "owner"];
function person(role: string) {
  const existing = Object.values(people).find(actor => actor.role === role);
  if (existing) return existing;
  const actor = { id: 80, role, isActive: 1, name: role };
  f.insert("users", actor); return actor;
}

describe("Actual protected RPC and central role registry", () => {
  it.each(roles)("keeps the %s direct review/decision grant explicit", async role => {
    const api = caller(person(role));
    if (reviewers.includes(role)) {
      expect((await api.list({})).rows.map(row => row.id)).toEqual([1]);
      expect(await api.decide({ id: 1, revision: 0, decision: "approved" })).toEqual({ id: 1, status: "approved", revision: 1 });
    } else {
      await expect(api.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.decide({ id: 1, revision: 0, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.get("inventory_lots", 1).specificationStatus).toBe("pending");
      expect(f.queries).toHaveLength(0);
    }
  });
  it.each(roles)("keeps the %s rejected return reader grant separate from review", async role => {
    const api = caller(person(role));
    if (returnReaders.includes(role)) {
      expect((await api.rejectedReturns({})).rows.map(row => row.id)).toEqual([2]);
      expect(await api.rejectedReturnSource({ id: 2 })).toMatchObject({ id: 2, remainingReturnableQuantity: 6 });
    } else {
      await expect(api.rejectedReturns({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.rejectedReturnSource({ id: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.queries).toHaveLength(0);
    }
  });
  it.each(roles)("does not grant unrelated status access to %s", async role => {
    const api = caller(person(role));
    if ([...reviewers, ...returnReaders].includes(role)) expect(await api.status()).toEqual({ enabled: true });
    else await expect(api.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies unauthenticated calls and inactive capability before touching data", async () => {
    await expect(caller(null).list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller({ ...people.construction, isActive: 0 }).decide({ id: 1, revision: 0, decision: "rejected" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.queries).toHaveLength(0);
  });
  it("checks current actor identity even after a successful previous RPC", async () => {
    const api = caller(people.construction);
    expect((await api.list({})).rows).toHaveLength(1);
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=31");
    await expect(api.decide({ id: 1, revision: 0, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.get("inventory_lots", 1).specificationStatus).toBe("pending");
  });
  it("enforces the exact parent guard on a direct RPC rather than trusting a visible button", async () => {
    f.scope.set(31, new Set());
    const api = caller(people.construction);
    expect((await api.list({})).rows).toEqual([]);
    await expect(api.decide({ id: 1, revision: 0, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.scope.set(31, new Set([10]));
    expect(await api.decide({ id: 1, revision: 0, decision: "approved" })).toMatchObject({ status: "approved" });
  });
  it.each([
    { id: 0, revision: 0, decision: "approved" },
    { id: 1, revision: -1, decision: "approved" },
    { id: 1, revision: 0, decision: "pending" },
    { id: 1, revision: 0, decision: "approved", notes: "x".repeat(2001) },
  ])("validates decision input at the RPC boundary: %j", async request => {
    await expect(caller(people.construction).decide(request as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.queries).toHaveLength(0);
  });
  it.each([{ page: 0 }, { pageSize: 51 }, { search: "x".repeat(201) }])("validates bounded pagination: %j", async request => {
    await expect(caller(people.construction).list(request)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.queries).toHaveLength(0);
  });
});
