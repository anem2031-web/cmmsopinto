import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, catalogIntegrationTokens } from "../../drizzle/schema";
import { catalogIntegrationTokenHash, createCatalogIntegrationTokenValue } from "../_core/authz/catalog-integration-token";
import { requireCatalogIntegrationToken } from "../_core/db/catalog-integration-tokens";
import type { TrpcContext } from "../_core/context";
import { router } from "../routers/_shared/procedures";
import { catalogIntegrationTokensRouter } from "../routers/catalog/integration-tokens.router";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../_core/db/client", () => ({ getDb }));
vi.mock("../_core/authz/media-access", () => ({ assertMediaMutationAccess: vi.fn() }));

const api = router({ catalogIntegrationTokens: catalogIntegrationTokensRouter });
const dialect = new MySqlDialect();

function caller(role: string | null, isActive = 1) {
  const user = role ? { id: 8, role, isActive } : null;
  const setHeader = vi.fn();
  const context = { user, authenticatedUser: user, req: {}, res: { setHeader } } as unknown as TrpcContext;
  return { rpc: api.createCaller(context).catalogIntegrationTokens, setHeader };
}

function databaseFixture() {
  const list = [{ id: 34, name: "PSCM", createdAt: Date.parse("2026-11-15T10:00:00Z") / 1000, revokedAt: null }];
  const record = vi.fn().mockResolvedValue([{ name: "PSCM", revokedAt: null }]);
  const write = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn((table: unknown) => ({
    values: (values: unknown) => {
      write(table, values);
      return { $returningId: async () => [{ id: 34 }] };
    },
  }));
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: record }) }) }),
    insert,
    update: () => ({ set: (values: unknown) => ({ where: () => write(catalogIntegrationTokens, values) }) }),
  };
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ from: () => ({ orderBy: async () => list, where }) }));
  getDb.mockResolvedValue({ select, transaction: (work: (value: typeof tx) => unknown) => work(tx) });
  return { list, limit, where, write, record, select };
}

async function authorize(authorization?: string) {
  const req = { get: (name: string) => name === "Authorization" ? authorization : undefined } as Request;
  const result = { json: vi.fn(), status: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  const next = vi.fn();
  await requireCatalogIntegrationToken(req, result as unknown as Response, next);
  return { ...result, next };
}

beforeEach(() => getDb.mockReset());

describe("Catalog integration credential management", () => {
  it.each(["owner", "admin"])("issues a separate random token for an active %s and lists metadata only", async role => {
    const db = databaseFixture();
    const { rpc, setHeader } = caller(role);
    const result = await rpc.create({ name: "  PSCM  " });
    expect(result.token).toMatch(/^cmms_cat_[A-Za-z0-9_-]{43}$/);
    expect((await rpc.create({ name: "PSCM" })).token).not.toBe(result.token);
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(db.write).toHaveBeenNthCalledWith(1, catalogIntegrationTokens, {
      name: "PSCM", tokenHash: catalogIntegrationTokenHash(result.token), createdById: 8,
    });
    expect(db.write).toHaveBeenNthCalledWith(2, auditLogs, expect.objectContaining({
      action: "create_catalog_integration_token", newValues: { name: "PSCM" },
    }));
    expect(JSON.stringify(db.write.mock.calls.slice(0, 2).map(call => call[1]))).not.toContain(result.token);
    expect(await rpc.list()).toEqual([{ id: 34, name: "PSCM", createdAt: "2026-11-15T10:00:00.000Z", revokedAt: null }]);
    expect(Object.keys((db.select.mock.calls as unknown as Array<[object]>)[0][0])).toEqual([
      "id", "name", "createdAt", "revokedAt",
    ]);
  });

  it.each([
    { role: "observer", active: 1, code: "FORBIDDEN" },
    { role: "maintenance_manager", active: 1, code: "FORBIDDEN" },
    { role: "warehouse", active: 1, code: "FORBIDDEN" },
    { role: "admin", active: 0, code: "FORBIDDEN" },
    { role: null, active: 1, code: "FORBIDDEN" },
  ])("blocks all direct management RPCs for $role with active=$active", async ({ role, active, code }) => {
    const { rpc } = caller(role, active);
    await expect(rpc.list()).rejects.toMatchObject({ code });
    await expect(rpc.create({ name: "PSCM" })).rejects.toMatchObject({ code });
    await expect(rpc.revoke({ id: 34 })).rejects.toMatchObject({ code });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("audits the first revocation, accepts a retry, and rejects an unknown id", async () => {
    const db = databaseFixture();
    const { rpc } = caller("owner");
    db.record.mockResolvedValueOnce([{ name: "PSCM", revokedAt: null }])
      .mockResolvedValueOnce([{ name: "PSCM", revokedAt: "2026-11-15 11:00:00" }])
      .mockResolvedValueOnce([]);
    await expect(rpc.revoke({ id: 34 })).resolves.toEqual({ success: true });
    await expect(rpc.revoke({ id: 34 })).resolves.toEqual({ success: true });
    expect(db.write).toHaveBeenCalledTimes(2);
    expect(db.write).toHaveBeenLastCalledWith(auditLogs, expect.objectContaining({
      action: "revoke_catalog_integration_token", entityId: 34, newValues: { name: "PSCM" },
    }));
    await expect(rpc.revoke({ id: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Catalog integration bearer authorization", () => {
  it("denies missing and malformed credentials before database access", async () => {
    for (const value of [undefined, "Basic xyz", "Bearer short", "Bearer " + "a".repeat(90)]) {
      const result = await authorize(value);
      expect(result.status).toHaveBeenCalledWith(401);
      expect(result.next).not.toHaveBeenCalled();
      expect(result.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it("checks one indexed digest and revocation status afresh on consecutive requests", async () => {
    const db = databaseFixture();
    const token = createCatalogIntegrationTokenValue();
    const otherToken = createCatalogIntegrationTokenValue();
    db.limit.mockResolvedValueOnce([{ id: 34 }]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 35 }]);
    expect((await authorize(`Bearer ${token}`)).next).toHaveBeenCalledOnce();
    expect((await authorize(`Bearer ${token}`)).status).toHaveBeenCalledWith(401);
    expect((await authorize(`Bearer ${otherToken}`)).next).toHaveBeenCalledOnce();
    expect(getDb).toHaveBeenCalledTimes(3);
    const queries = db.where.mock.calls.map(call => dialect.sqlToQuery((call as unknown as [Parameters<typeof dialect.sqlToQuery>[0]])[0]));
    expect(queries.map(query => query.params)).toEqual([
      [catalogIntegrationTokenHash(token)], [catalogIntegrationTokenHash(token)], [catalogIntegrationTokenHash(otherToken)],
    ]);
    expect(queries.every(query => /revokedAt` is null/.test(query.sql))).toBe(true);
    expect(db.limit.mock.calls).toEqual([[1], [1], [1]]);
  });

  it("fails closed on dependency errors", async () => {
    getDb.mockRejectedValueOnce(new Error("internal database detail"));
    const result = await authorize(`Bearer ${createCatalogIntegrationTokenValue()}`);
    expect(result.status).toHaveBeenCalledWith(503);
    expect(result.json).not.toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("internal") }));
    expect(result.next).not.toHaveBeenCalled();
  });
});
