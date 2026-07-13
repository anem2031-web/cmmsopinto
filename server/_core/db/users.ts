// ============================================================
// db/users.ts — المستخدمون والمصادقة الثنائية
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, purchaseOrders, purchaseOrderItems,
  inventory, inventoryTransactions, notifications, auditLogs,
  ticketStatusHistory, attachments, sites, backups,
  assets, preventivePlans, pmWorkOrders, assetSpareParts, pmJobs, assetMetrics,
  pmChecklistItems, pmWorkOrderBranches,
  twoFactorSecrets, twoFactorAuditLogs,
  pushSubscriptions, sections, technicians, inspectionResults,
  type InsertAsset, type InsertPreventivePlan, type PreventivePlan, type InsertPMWorkOrder,
  type InsertSection, type InsertInspectionResult,
  assetCategories,
  procurementComments,
  type InsertProcurementComment,
  warehouseReceipts,
  warehouseReturns,
  warehouseReceiptItems,
  ocrJobs,
  type InsertWarehouseReceipt,
  type InsertWarehouseReturn,
  ticketConfirmations,
  type InsertTicketConfirmation,
  deliveryDocuments,
  returnDocuments,
  deliveryNumberCounter,
  itemBarcodeCounter,
  disposalOperations,
  disposalItems,
  disposalNumberCounter,
  poPricingBatches,
  type InsertPOPricingBatch,
  inventoryCountOperations,
  inventoryCountItems,
  inventorySettlements,
  inventorySettlementItems,
  inventoryCountNumberCounter,
  inventorySettlementNumberCounter,
} from "../../../drizzle/schema";
import { ENV } from '../env';


import { getDb } from "./client";

// ============================================================
// USER OPERATIONS
// ============================================================
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'owner'; updateSet.role = 'owner'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createLocalUser(data: { username: string; passwordHash: string; name: string; role: string; email?: string; phone?: string; department?: string }) {
  const db = await getDb();
  if (!db) return null;
// openId ثابت مبني على username فقط — بدون Date.now()
  const openId = `local_${data.username}`;

  const result = await db.insert(users).values({
    openId,
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    role: data.role as any,
    email: data.email || null,
    phone: data.phone || null,
    department: data.department || null,
    loginMethod: "local",
    lastSignedIn: new Date(),
  });
  return result[0].insertId;
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(
    or(
      isNotNull(users.username),
      isNotNull(users.name)
    )
  );
}

export async function updateLastSignedIn(openId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users)
    .set({ lastSignedIn: new Date() })
    .where(eq(users.openId, openId));
}

/**
 * Create or update 2FA secret for a user
 */
export async function createTwoFactorSecret(data: {
  userId: number;
  secret: string;
  backupCodes: string;
  isEnabled: boolean;
  enabledAt?: Date;
}) {
  try {
    const database = await getDb();
    if (!database) return null;
    const result = await database
      .insert(twoFactorSecrets)
      .values({
        userId: data.userId,
        secret: data.secret,
        backupCodes: data.backupCodes,
        isEnabled: data.isEnabled,
        enabledAt: data.enabledAt || new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          secret: data.secret,
          backupCodes: data.backupCodes,
          isEnabled: data.isEnabled,
          enabledAt: data.enabledAt || new Date(),
          updatedAt: new Date(),
        },
      });
    return result;
  } catch (error) {
    console.error('Error creating 2FA secret:', error);
    throw error;
  }
}

/**
 * Get 2FA secret for a user
 */
export async function getTwoFactorSecret(userId: number) {
  try {
    const database = await getDb();
    if (!database) return null;
    const result = await database
      .select()
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, userId))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('Error getting 2FA secret:', error);
    throw error;
  }
}

/**
 * Disable 2FA for a user
 */
export async function disableTwoFactor(userId: number) {
  try {
    const database = await getDb();
    if (!database) return null;
    const result = await database
      .update(twoFactorSecrets)
      .set({
        isEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(twoFactorSecrets.userId, userId));
    return result;
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    throw error;
  }
}

/**
 * Create 2FA audit log entry
 */
export async function createTwoFactorAuditLog(data: {
  userId: number;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  details?: string;
}) {
  try {
    const database = await getDb();
    if (!database) return null;
    const result = await database
      .insert(twoFactorAuditLogs)
      .values({
        userId: data.userId,
        action: data.action,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        success: data.success,
        details: data.details,
      });
    return result;
  } catch (error) {
    console.error('Error creating 2FA audit log:', error);
    throw error;
  }
}

/**
 * Get 2FA audit logs for a user
 */
export async function getTwoFactorAuditLogs(userId: number, limit: number = 50) {
  try {
    const database = await getDb();
    if (!database) return [];
    const result = await database
      .select()
      .from(twoFactorAuditLogs)
      .where(eq(twoFactorAuditLogs.userId, userId))
      .orderBy(desc(twoFactorAuditLogs.createdAt))
      .limit(limit);
    return result;
  } catch (error) {
    console.error('Error getting 2FA audit logs:', error);
    throw error;
  }
}

/**
 * Check if user has 2FA enabled
 */
export async function isTwoFactorEnabled(userId: number): Promise<boolean> {
  try {
    const secret = await getTwoFactorSecret(userId);
    return secret?.isEnabled || false;
  } catch (error) {
    console.error('Error checking 2FA status:', error);
    return false;
  }
}

