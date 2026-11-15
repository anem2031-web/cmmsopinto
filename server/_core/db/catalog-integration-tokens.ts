import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, catalogIntegrationTokens } from "../../../drizzle/schema";
import {
  catalogIntegrationTokenHash,
  createCatalogIntegrationTokenGuard,
  createCatalogIntegrationTokenValue,
} from "../authz/catalog-integration-token";
import { getDb } from "./client";

async function requireDatabase() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "قاعدة البيانات غير متاحة" });
  return db;
}

export async function listCatalogIntegrationTokens() {
  const db = await requireDatabase();
  const rows = await db.select({
    id: catalogIntegrationTokens.id,
    name: catalogIntegrationTokens.name,
    createdAt: sql<number>`UNIX_TIMESTAMP(${catalogIntegrationTokens.createdAt})`,
    revokedAt: sql<number | null>`UNIX_TIMESTAMP(${catalogIntegrationTokens.revokedAt})`,
  }).from(catalogIntegrationTokens).orderBy(desc(catalogIntegrationTokens.id));
  return rows.map(row => ({
    ...row,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt * 1000).toISOString(),
  }));
}

export async function createCatalogIntegrationToken(name: string, actorId: number) {
  const db = await requireDatabase();
  const token = createCatalogIntegrationTokenValue();
  const id = await db.transaction(async tx => {
    const [created] = await tx.insert(catalogIntegrationTokens).values({
      name,
      tokenHash: catalogIntegrationTokenHash(token),
      createdById: actorId,
    }).$returningId();
    await tx.insert(auditLogs).values({
      userId: actorId,
      action: "create_catalog_integration_token",
      entityType: "catalog_integration_token",
      entityId: created.id,
      newValues: { name },
    });
    return created.id;
  });
  return { id, token };
}

export async function revokeCatalogIntegrationToken(id: number, actorId: number) {
  const db = await requireDatabase();
  return db.transaction(async tx => {
    const [record] = await tx.select({
      name: catalogIntegrationTokens.name,
      revokedAt: catalogIntegrationTokens.revokedAt,
    }).from(catalogIntegrationTokens).where(eq(catalogIntegrationTokens.id, id)).for("update");
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "رمز الربط غير موجود" });
    if (record.revokedAt === null) {
      await tx.update(catalogIntegrationTokens).set({
        revokedById: actorId,
        revokedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(catalogIntegrationTokens.id, id));
      await tx.insert(auditLogs).values({
        userId: actorId,
        action: "revoke_catalog_integration_token",
        entityType: "catalog_integration_token",
        entityId: id,
        newValues: { name: record.name },
      });
    }
    return { success: true as const };
  });
}

export const requireCatalogIntegrationToken = createCatalogIntegrationTokenGuard(async tokenHash => {
  const db = await requireDatabase();
  const [activeToken] = await db.select({ id: catalogIntegrationTokens.id })
    .from(catalogIntegrationTokens)
    .where(and(
      eq(catalogIntegrationTokens.tokenHash, tokenHash),
      isNull(catalogIntegrationTokens.revokedAt),
    )).limit(1);
  return Boolean(activeToken);
});
