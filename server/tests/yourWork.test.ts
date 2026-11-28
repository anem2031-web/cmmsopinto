import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ROLE, canRoleAccessPath } from "../../shared/roles";
import { businessPageAllowed, businessRpcAllowed, isBusinessGuardedRole } from "../../shared/business-role-policy";
import { YOUR_WORK_ROLES, canAccessYourWork, canReadYourWork, splitYourWork, yourWorkOverdueAt, yourWorkMillis, yourWorkRpcAllowed, type YourWorkItem } from "../../shared/your-work";
const f = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../_core/db", () => ({}));
vi.mock("../services/your-work", () => ({ readYourWork: f.read }));
import { router } from "../_core/trpc";
import { yourWorkRouter } from "../routers/your-work.router";
const api = router({ yourWork: yourWorkRouter });
const actor = (role: string, isActive = 1) => ({ id: 30, role, isActive });
const call = (role: string, isActive = 1, projected = false) => {
  const user = actor(role, isActive);
  return api.createCaller({ user: projected ? { ...user, role: "admin" } : user, authenticatedUser: user, req: {}, res: {} } as any).yourWork;
};
const at = (s: string) => Date.parse(s);
const row = (key = "ticket:1", arrivedAt: number | null = at("2026-11-28T13:53:00+03:00")): YourWorkItem => ({ key, kind: "ticket", reference: "MT-1", action: "ticket_inspection_review", href: "/tickets/1", arrivedAt });
beforeEach(() => { vi.clearAllMocks(); f.read.mockResolvedValue(splitYourWork([], Date.now())); });

describe("Your Work capability boundary", () => {
  it.each(Object.values(APP_ROLE))("grants only the explicit non-excluded role: %s", role => {
    const allowed = (YOUR_WORK_ROLES as readonly string[]).includes(role);
    expect(canAccessYourWork(role)).toBe(allowed);
    expect(canRoleAccessPath(role, "/your-work")).toBe(allowed);
    expect(canRoleAccessPath(role, "/your-work?tab=required")).toBe(allowed);
    expect(yourWorkRpcAllowed(actor(role), "query", "yourWork.list")).toBe(allowed);
    expect(yourWorkRpcAllowed(actor(role), "mutation", "yourWork.list")).toBe(false);
    expect(yourWorkRpcAllowed(actor(role), "query", "yourWork.other")).toBe(false);
    if (isBusinessGuardedRole(role)) {
      expect(businessPageAllowed(role, "/your-work")).toBe(allowed);
      expect(businessRpcAllowed(actor(role), "query", "yourWork.list")).toBe(allowed);
      expect(businessRpcAllowed(actor(role), "mutation", "yourWork.list")).toBe(false);
    }
  });
  it.each([null, undefined, "unknown", "", "delegate_manager", "purchase_manager", "observer"])("never projects an excluded or unknown role into the page: %s", role => {
    expect(canAccessYourWork(role)).toBe(false);
    expect(canRoleAccessPath(role, "/your-work")).toBe(false);
  });
  it.each(YOUR_WORK_ROLES)("admits an active actual %s identity to its read endpoint", async role => {
    await expect(call(role).list()).resolves.toHaveProperty("counts");
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.read.mock.calls[0][0].authenticatedUser).toMatchObject(actor(role));
  });
  it.each(["delegate", "delegate_manager", "technician", "gate_security", "purchase_manager", "observer", "unknown"])("rejects the actual excluded %s before the source even with an admin display projection", async role => {
    await expect(call(role, 1, true).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.read).not.toHaveBeenCalled();
  });
  it.each(YOUR_WORK_ROLES)("rejects disabled %s before reading business data", async role => {
    await expect(call(role, 0).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.read).not.toHaveBeenCalled();
  });
  it("rejects missing/invalid actors and does not affect other RPC paths", () => {
    for (const identity of [null, actor("warehouse", 0), { ...actor("owner"), id: 0 }, { ...actor("owner"), id: NaN }]) expect(canReadYourWork(identity)).toBe(false);
    expect(yourWorkRpcAllowed(null, "query", "tickets.getById")).toBe(true);
    expect(yourWorkRpcAllowed(null, "query", "yourWork.list")).toBe(false);
  });
  it("rejects a client-selected identity/role before sources and scopes language to display only", async () => {
    await expect(call("warehouse").list({ viewerId: 999, viewerRole: "warehouse", language: "ar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("warehouse").list({ viewerId: 30, viewerRole: "admin", language: "ar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.read).not.toHaveBeenCalled();
    await call("warehouse").list({ viewerId: 30, viewerRole: "warehouse", language: "en" });
    expect(f.read.mock.calls[0][0].authenticatedUser).toMatchObject({ id: 30, role: "warehouse", preferredLanguage: "en" });
  });
  it("rechecks a later inactive request after an earlier successful list", async () => {
    await call("warehouse").list();
    await expect(call("warehouse", 0).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.read).toHaveBeenCalledTimes(1);
  });
  it("returns a clear failure, never SQL details or a false empty success", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.read.mockRejectedValue(new Error("SELECT secret FROM private_table"));
    try { await expect(call("owner").list()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "تعذر تحميل أعمالك. يرجى المحاولة مجددًا." }); }
    finally { log.mockRestore(); }
  });
});

describe("Riyadh calendar-day classification", () => {
  it("keeps the arrival day actionable through its final millisecond, then moves at midnight", () => {
    const item = row();
    const boundary = at("2026-11-29T00:00:00+03:00");
    expect(yourWorkOverdueAt(item.arrivedAt)).toBe(boundary);
    expect(splitYourWork([item], boundary - 1).counts).toEqual({ overdue: 0, required: 1 });
    expect(splitYourWork([item], boundary).counts).toEqual({ overdue: 1, required: 0 });
    expect(splitYourWork([item], boundary + 2 * 3600000).overdue[0]).toEqual(item);
  });
  it("uses Riyadh day rather than the UTC or host day", () => {
    const item = row("late-night", at("2026-11-28T21:30:00Z")); // 29 Nov 00:30 Riyadh.
    expect(splitYourWork([item], at("2026-11-29T10:00:00Z")).counts.overdue).toBe(0);
    expect(yourWorkOverdueAt(item.arrivedAt)).toBe(at("2026-11-29T21:00:00Z"));
  });
  it("does not invent arrival evidence or label unknown/future arrivals overdue", () => {
    const result = splitYourWork([row("unknown", null), row("future", at("2026-12-01T10:00:00Z")), row("invalid", NaN)], at("2026-11-29T13:00:00Z"));
    expect(result.counts).toEqual({ overdue: 0, required: 3 });
    expect(result.required.find(r => r.key === "invalid")?.arrivedAt).toBeNull();
  });
  it("deduplicates each current action and prefers actual time evidence without merging separate actions", () => {
    const a = row("a", null), b = row("a"), c = { ...row("b"), action: "ticket_close" as const };
    const result = splitYourWork([a, b, c, b], at("2026-11-28T15:00:00+03:00"));
    expect(result.counts).toEqual({ overdue: 0, required: 2 });
    expect(result.required.find(r => r.key === "a")?.arrivedAt).toBe(b.arrivedAt);
  });
  it("orders oldest arrivals first and puts unrecorded times last", () => {
    const result = splitYourWork([row("unknown", null), row("second"), row("first", at("2026-11-28T01:00:00+03:00"))], at("2026-11-28T23:00:00+03:00"));
    expect(result.required.map(r => r.key)).toEqual(["first", "second", "unknown"]);
  });
  it("does not expose external/unsafe destination strings", () => {
    const rows = ["javascript:alert(1)", "//example.invalid", "https://example.invalid"].map((href, i) => ({ ...row(String(i)), href }));
    expect(splitYourWork(rows, Date.now()).counts).toEqual({ overdue: 0, required: 0 });
  });
  it("parses recorded time objects and treats invalid evidence as missing", () => {
    expect(yourWorkMillis(new Date("2026-11-28T00:00:00Z"))).toBe(at("2026-11-28T00:00:00Z"));
    expect(yourWorkMillis("2026-11-28 21:30:00")).toBe(at("2026-11-28T21:30:00Z"));
    expect(yourWorkMillis("bad")).toBeNull(); expect(yourWorkMillis(null)).toBeNull();
  });
});
