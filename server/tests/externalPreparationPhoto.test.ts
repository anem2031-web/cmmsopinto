import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const mocks = vi.hoisted(() => ({ ticket: vi.fn(), execute: vi.fn(), getDb: vi.fn(), readable: vi.fn() }));
vi.mock("../_core/db", () => ({ getTicketById: mocks.ticket }));
vi.mock("../_core/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("../routers/tickets/tickets.access", () => ({ assertTicketReadable: mocks.readable }));
import { assertMediaAccess, mediaAccessPort } from "../_core/authz/media-access";
import { isWaitingExternalWarehousePreparation } from "../_core/authz/external-preparation-photo";

const key = "cmms/uploads/initial.jpg";
const user = { id: 5, role: "warehouse", isActive: 1 };
const ref = { kind: "ticket", id: 9, parentId: 9 };
const port = { references: async () => [ref], authorize: mediaAccessPort.authorize };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ticket.mockResolvedValue({ id: 9, beforePhotoUrl: `/api/media?key=${encodeURIComponent(key)}` });
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
  mocks.execute.mockResolvedValue([[{ id: 10 }]]);
  mocks.readable.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
});
describe("warehouse external preparation initial photo only", () => {
  it("allows the displayed initial photo through the actual media guard", async () => {
    await expect(assertMediaAccess(user, key, port)).resolves.toBe(key);
    expect(mocks.readable).not.toHaveBeenCalled();
    const query = new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params).toEqual([9]);
    expect(query.sql).toContain("item.maintenancePath = 'C'");
    expect(query.sql).toContain("item.status = 'work_approved'");
    expect(query.sql).toContain("job.ticketItemId = item.id");
    expect(query.sql).toContain("job.id IS NULL");
  });
  it("denies unrelated/after photos even for an eligible ticket", async () => {
    await expect(assertMediaAccess(user, "cmms/uploads/after.jpg", port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rechecks stage on consecutive reads rather than caching permission", async () => {
    await expect(assertMediaAccess(user, key, port)).resolves.toBe(key);
    mocks.execute.mockResolvedValue([[]]);
    await expect(assertMediaAccess(user, key, port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("denies missing tickets and inactive actors", async () => {
    mocks.ticket.mockResolvedValue(null);
    await expect(assertMediaAccess(user, key, port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertMediaAccess({ ...user, isActive: 0 }, key, port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["accountant", "delegate", "technician", "operator"])("does not change access for %s", async role => {
    if (role === "technician") mocks.execute.mockResolvedValueOnce([[]]);
    await expect(assertMediaAccess({ ...user, role }, key, port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    if (role === "technician") {
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0]).sql).toContain("maintenance_team_members");
    } else expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["admin", "owner"])("preserves %s access", async role => {
    await expect(assertMediaAccess({ ...user, role }, key, port)).resolves.toBe(key);
    expect(mocks.ticket).not.toHaveBeenCalled();
  });
  it("does not treat infrastructure failures as permission to show the image", async () => {
    mocks.execute.mockRejectedValue(new Error("offline"));
    await expect(assertMediaAccess(user, key, port)).rejects.toThrow("offline");
    mocks.getDb.mockResolvedValue(null);
    await expect(isWaitingExternalWarehousePreparation(9)).rejects.toThrow("Database unavailable");
  });
});
