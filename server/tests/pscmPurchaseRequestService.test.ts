import { createRequire } from "node:module";
import type { SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assets,
  auditLogs,
  catalogCodeAliases,
  catalogItems,
  catalogUnits,
  centerCategories,
  purchaseOrderItems,
  purchaseOrders,
  sections,
  sites,
  users,
} from "../../drizzle/schema";
import { pscmPurchasePayload } from "../services/pscm/purchase-request-contract";
import { importApprovedPscmPurchase } from "../services/pscm/purchase-request-service";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");

const ports = vi.hoisted(() => ({
  db: vi.fn(),
  transaction: vi.fn(),
  notify: vi.fn(async (_notification: unknown) => undefined),
  translate: vi.fn(async (_items: unknown, _requesterId: number) => undefined),
}));
vi.mock("../_core/env", () => ({ ENV: {} }));
vi.mock("../_core/db/client", () => ({
  getDb: ports.db,
  withTransaction: ports.transaction,
}));
vi.mock("../_core/db/notifications", () => ({
  createNotification: ports.notify,
}));
vi.mock("../services/purchase-item-translations", () => ({
  queuePOItemsTranslation: ports.translate,
}));
vi.mock("../_core/db/users", () => ({
  getAllUsers: async () => [
    { id: 1, role: "purchase_requester", isActive: 1 },
    { id: 2, role: "general_maintenance_manager", isActive: 1 },
    { id: 3, role: "construction_procurement_manager", isActive: 1 },
    { id: 4, role: "general_maintenance_manager", isActive: 0 },
    { id: 5, role: "delegate", isActive: 1 },
  ],
}));

const rawPayload = (assetId: number | null = 31, requesterName?: string) => ({
  schemaVersion: 1,
  idempotencyKey: "pscm:MR-26-11-0014",
  source: {
    system: "PSCM",
    instanceId: "pscm",
    requisitionId: 14,
    requisitionNumber: "MR-26-11-0014",
    ...(requesterName === undefined ? {} : { requesterName }),
    approvedAt: "2026-11-15T08:30:00.000Z",
    project: { id: 84, number: "PRJ-26-11-0084", name: "المشروع" },
    task: { id: 9, name: "المهمة" },
  },
  items: [
    {
      sequence: 1,
      itemName: "وصلة",
      catalogItemId: "204",
      catalogCode: "OLD-204",
      quantity: "5.000000000",
      unit: {
        code: "CMMS_UNIT_7",
        nameAr: "قطعة",
        nameEn: "Piece",
        nameUr: "عدد",
      },
      specifications: "قطر ٣٥",
      notes: "ملاحظة",
      needDate: "2026-11-20",
      siteId: 11,
      sectionId: 21,
      assetId,
      categoryId: 51,
      reviewRole: "construction_procurement_manager",
    },
    {
      sequence: 2,
      itemName: "بند سابق",
      catalogItemId: null,
      catalogCode: "",
      quantity: "2",
      unit: { code: "PCS", nameAr: "قطعة", nameEn: "Piece", nameUr: "عدد" },
      specifications: "",
      notes: "",
      needDate: "2026-11-16",
      siteId: 11,
      sectionId: 21,
      assetId,
      categoryId: 52,
      reviewRole: "general_maintenance_manager",
    },
  ],
});
const send = (payload = rawPayload(), requesterId = 1) =>
  importApprovedPscmPurchase(pscmPurchasePayload.parse(payload), requesterId);

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const table of [
    assets,
    auditLogs,
    catalogCodeAliases,
    catalogItems,
    catalogUnits,
    centerCategories,
    purchaseOrderItems,
    purchaseOrders,
    sections,
    sites,
    users,
  ]) {
    const config = getTableConfig(table);
    sqlite.exec(
      `CREATE TABLE ${config.name} (${config.columns
        .map(
          column =>
            `"${column.name}" ${
              column.name === "id"
                ? "INTEGER PRIMARY KEY AUTOINCREMENT"
                : column.dataType === "number"
                  ? "INTEGER"
                  : "TEXT"
            }`
        )
        .join(", ")})`
    );
  }
  sqlite.exec(`
    CREATE TABLE purchase_order_number_counter (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER);
    CREATE UNIQUE INDEX source_id ON purchase_orders (sourceSystem, sourceInstanceId, sourceRequestId);
    CREATE UNIQUE INDEX source_reference ON purchase_orders (sourceSystem, sourceInstanceId, sourceReference);
    INSERT INTO users (id,role,isActive) VALUES (1,'purchase_requester',1),(2,'admin',1),(3,'purchase_requester',0);
    INSERT INTO sites (id,isActive) VALUES (11,1),(12,1);
    INSERT INTO sections (id,siteId,isActive) VALUES (21,11,1),(22,12,1);
    INSERT INTO assets (id,siteId,sectionId,status) VALUES (31,11,21,'active'),(32,11,21,'disposed');
    INSERT INTO center_categories (id,isActive) VALUES (51,1),(52,1),(53,0);
    INSERT INTO catalog_items (id,code,unit,isActive) VALUES (204,'CODE-204','قطعة',1);
    INSERT INTO catalog_code_aliases (entityType,entityId,oldCode) VALUES ('item',204,'OLD-204');
    INSERT INTO catalog_units (id,nameAr,nameEn,isActive) VALUES (7,'قطعة','Piece',1),(8,'متر','Meter',1);
  `);
  const query = vi.fn(
    async (
      options: string | { sql: string; rowsAsArray?: boolean },
      params: SQLInputValue[] = []
    ) => {
      const sql = (typeof options === "string" ? options : options.sql)
        .trim()
        .replace(/\s+for update$/i, "")
        .replace(/\bdefault\b/gi, "NULL");
      const statement = sqlite.prepare(sql);
      if (sql.toLowerCase().startsWith("select")) {
        const rows = statement.all(...params);
        return [
          typeof options !== "string" && options.rowsAsArray
            ? rows.map(Object.values)
            : rows,
        ];
      }
      const result = statement.run(
        ...params.map(value =>
          value instanceof Date ? value.toISOString() : value
        )
      );
      return [
        {
          insertId: Number(result.lastInsertRowid),
          affectedRows: Number(result.changes),
        },
      ];
    }
  );
  const db = drizzle({ client: { query } as never });
  let tail: Promise<unknown> = Promise.resolve();
  ports.db.mockResolvedValue(db);
  ports.transaction.mockImplementation(work => {
    const next = tail.then(async () => {
      sqlite.exec("BEGIN");
      try {
        const value = await work(db);
        sqlite.exec("COMMIT");
        return value;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    });
    tail = next.catch(() => {});
    return next;
  });
  return { sqlite, query };
}

let data: ReturnType<typeof fixture>;
const count = (table: string) =>
  data.sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T22:05:00Z")); // Riyadh November 17
  data = fixture();
});
afterEach(() => {
  data.sqlite.close();
  vi.useRealTimers();
});

describe("PSCM approved purchase transaction", () => {
  it("uses the current CMMS numbering, persists all line fields, and returns one PR for concurrent exact replays", async () => {
    const payload = rawPayload(31, "أحمد وائل");
    const [first, repeat] = await Promise.all([send(payload), send(payload)]);
    expect(first).toEqual({
      purchaseRequestId: 1,
      purchaseRequestNumber: "PR-2026-0001",
      created: true,
    });
    expect(repeat).toEqual({ ...first, created: false });
    expect(count("purchase_order_number_counter")).toBe(1);
    expect(count("audit_logs")).toBe(1);
    const order = data.sqlite.prepare("SELECT * FROM purchase_orders").get();
    expect(order).toMatchObject({
      ticketId: null,
      poNumber: first.purchaseRequestNumber,
      requestedById: 1,
      status: "pending_review",
      siteId: 11,
      sectionId: 21,
      assetId: 31,
      categoryId: 51,
      sourceSystem: "PSCM",
      sourceInstanceId: "pscm",
      sourceRequestId: 14,
      sourceReference: "MR-26-11-0014",
      sourceRequesterName: "أحمد وائل",
    });
    const audit = data.sqlite
      .prepare("SELECT userId, newValues FROM audit_logs")
      .get();
    expect(audit?.userId).toBe(1);
    expect(JSON.parse(String(audit?.newValues))).toMatchObject({
      source: { requesterName: "أحمد وائل" },
    });
    const [one, two] = data.sqlite
      .prepare("SELECT * FROM purchase_order_items ORDER BY id")
      .all();
    expect(one).toMatchObject({
      purchaseOrderId: 1,
      catalogItemId: 204,
      status: "pending_review",
      delegateId: null,
      quantity: 5,
      description: "قطر ٣٥",
      notes: "ملاحظة",
      unit: "قطعة",
      siteId: 11,
      sectionId: 21,
      assetId: 31,
      categoryId: 51,
      reviewRole: "construction_procurement_manager",
      requiredDate: "2026-11-20",
      deliveryLeadDays: 3,
    });
    expect(two).toMatchObject({
      purchaseOrderId: 1,
      catalogItemId: null,
      quantity: 2,
      categoryId: 52,
      reviewRole: "general_maintenance_manager",
      requiredDate: "2026-11-16",
      deliveryLeadDays: 0,
    });
    await vi.waitFor(() => expect(ports.translate).toHaveBeenCalledOnce());
    expect(
      ports.notify.mock.calls.map(
        ([notice]) => (notice as { userId: number }).userId
      )
    ).toEqual([2, 3]);
  });

  it("returns the existing number after a catalog row deactivates and rejects identity or payload changes", async () => {
    await send();
    await vi.waitFor(() => expect(ports.translate).toHaveBeenCalledOnce());
    data.sqlite.exec("UPDATE catalog_items SET isActive=0");
    await expect(send()).resolves.toMatchObject({
      created: false,
      purchaseRequestNumber: "PR-2026-0001",
    });
    const conflicting = rawPayload();
    conflicting.source.requisitionId += 1;
    await expect(send(conflicting)).rejects.toMatchObject({
      code: "source_conflict",
    });
    conflicting.source.requisitionId -= 1;
    conflicting.source.requisitionNumber = "MR-26-11-0015";
    conflicting.idempotencyKey = "pscm:MR-26-11-0015";
    await expect(send(conflicting)).rejects.toMatchObject({
      code: "source_conflict",
    });
    conflicting.source.requisitionNumber = "MR-26-11-0014";
    conflicting.idempotencyKey = "pscm:MR-26-11-0014";
    conflicting.items[0].quantity = "6";
    await expect(send(conflicting)).rejects.toMatchObject({
      code: "source_conflict",
    });
    expect(count("purchase_orders")).toBe(1);
    expect(count("purchase_order_number_counter")).toBe(1);
  });

  it("fills an omitted requester name on valid replay and preserves both the PR and its requester identity", async () => {
    const first = await send();
    const order = () =>
      data.sqlite
        .prepare(
          "SELECT id, requestedById, sourceRequesterName FROM purchase_orders"
        )
        .get();
    expect(order()?.sourceRequesterName).toBeNull();
    await expect(send(rawPayload(31, "أحمد وائل"))).resolves.toEqual({
      ...first,
      created: false,
    });
    expect(order()).toMatchObject({
      id: first.purchaseRequestId,
      requestedById: 1,
      sourceRequesterName: "أحمد وائل",
    });
    await expect(send()).resolves.toEqual({ ...first, created: false });
    await expect(send(rawPayload(31, "خالد صلاح"))).rejects.toMatchObject({
      code: "source_conflict",
    });
    expect(order()?.sourceRequesterName).toBe("أحمد وائل");
    expect(count("purchase_order_number_counter")).toBe(1);
    await vi.waitFor(() => expect(ports.translate).toHaveBeenCalledOnce());
  });

  it("accepts a project location without an asset", async () => {
    await expect(send(rawPayload(null))).resolves.toMatchObject({
      created: true,
    });
    expect(
      data.sqlite.prepare("SELECT assetId FROM purchase_orders").get()?.assetId
    ).toBeNull();
    expect(
      data.sqlite
        .prepare("SELECT assetId FROM purchase_order_items")
        .all()
        .map(row => row.assetId)
    ).toEqual([null, null]);
    await vi.waitFor(() => expect(ports.translate).toHaveBeenCalledOnce());
  });

  it.each([
    ["unsupported_quantity", { quantity: "5.000000001" }],
    ["unsupported_quantity", { quantity: "0" }],
    ["invalid_location", { assetId: 32 }],
    ["invalid_category", { categoryId: 53 }],
    ["invalid_catalog_item", { catalogCode: "OTHER" }],
    [
      "invalid_unit",
      { unit: { code: "M", nameAr: "متر", nameEn: "Meter", nameUr: "میٹر" } },
    ],
  ])(
    "rejects %s before reserving a number or writing a record",
    async (code, changes) => {
      const payload = rawPayload();
      Object.assign(payload.items[0], changes);
      if (code === "invalid_location") Object.assign(payload.items[1], changes);
      await expect(send(payload)).rejects.toMatchObject({ code });
      expect(count("purchase_order_number_counter")).toBe(0);
      expect(count("purchase_orders")).toBe(0);
    }
  );

  it("requires the configured actor to be active and to have the purchase requester role", async () => {
    for (const id of [2, 3, 4]) {
      await expect(send(rawPayload(), id)).rejects.toMatchObject({
        code: "requester_unavailable",
      });
    }
    expect(count("purchase_orders")).toBe(0);
    expect(ports.notify).not.toHaveBeenCalled();
  });

  it("rolls back the header and audit when inserting a line fails and allows a retry", async () => {
    data.sqlite
      .exec(`CREATE TRIGGER item_failure BEFORE INSERT ON purchase_order_items
      BEGIN SELECT RAISE(ABORT,'forced insert failure'); END;`);
    await expect(send()).rejects.toThrow();
    expect(count("purchase_orders")).toBe(0);
    expect(count("purchase_order_items")).toBe(0);
    expect(count("audit_logs")).toBe(0);
    expect(ports.notify).not.toHaveBeenCalled();
    data.sqlite.exec("DROP TRIGGER item_failure");
    await expect(send()).resolves.toMatchObject({ created: true });
    await vi.waitFor(() => expect(ports.translate).toHaveBeenCalledOnce());
  });
});
