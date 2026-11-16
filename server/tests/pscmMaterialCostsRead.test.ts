import { createRequire } from "node:module";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPscmMaterialCosts } from "../services/pscm/material-costs-read";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const getDb = vi.hoisted(() => vi.fn());
vi.mock("../_core/db/client", () => ({ getDb }));

let sqlite: InstanceType<typeof DatabaseSync>;
let queryCount: number;

function source(
  requisitionId: number,
  task: { id: number; name: string } | null
) {
  return JSON.stringify({
    source: {
      system: "PSCM",
      instanceId: "pscm",
      requisitionId,
      requisitionNumber: `MR-26-11-00${requisitionId}`,
      project: { id: 52, number: "PRJ-2026-0085", name: "Project" },
      approvedAt: "2026-11-17T09:00:00.000Z",
      task,
    },
  });
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  queryCount = 0;
  sqlite.exec(`
    CREATE TABLE purchase_orders(id INT PRIMARY KEY, sourceRequestId INT, sourceReference TEXT, sourceSystem TEXT, sourceInstanceId TEXT);
    CREATE TABLE purchase_order_items(id INT PRIMARY KEY, purchaseOrderId INT, status TEXT, deliveredAt TEXT, deliveryNumber TEXT);
    CREATE TABLE pscm_purchase_items(purchaseOrderItemId INT, purchaseOrderId INT, taskId INT, sequence INT);
    CREATE TABLE pscm_fulfillment_issues(purchaseOrderItemId INT, deliveryDocumentId INT, deliveryNumber TEXT, lotId INT, quantity INT);
    CREATE TABLE inventory_transactions(id INT PRIMARY KEY, purchaseOrderItemId INT, inventoryId INT, lotId INT,
      type TEXT, transactionType TEXT, quantity NUMERIC, returnId INT, unitCost NUMERIC, totalCost NUMERIC);
    CREATE TABLE delivery_documents(id INT PRIMARY KEY, inventoryTransactionId INT, poItemId INT, inventoryId INT,
      lotId INT, quantity NUMERIC, deliveryNumber TEXT);
    CREATE TABLE inventory_lots(id INT PRIMARY KEY, purchaseOrderId INT, purchaseOrderItemId INT, sourceType TEXT);
    CREATE TABLE inventory_issue_cost_allocations(id INTEGER PRIMARY KEY, inventoryTransactionId INT, inventoryId INT, lotId INT, quantity NUMERIC,
      deliveryNumber TEXT, allocatedCostTotal NUMERIC, lotIssueUnitCostSnapshot NUMERIC);
    CREATE TABLE warehouse_returns(id INT PRIMARY KEY, inventoryId INT, lotId INT, sourceDeliveryDocumentId INT, returnedQuantity INT);
    CREATE TABLE audit_logs(entityId INT, entityType TEXT, action TEXT, newValues TEXT);

    INSERT INTO purchase_orders VALUES (1,41,'MR-26-11-0041','PSCM','pscm'),
      (2,41,'MR-26-11-0041','PSCM','another'),(3,42,'MR-26-11-0042',NULL,NULL),
      (4,42,'MR-26-11-0042','PSCM','pscm'),(5,43,'MR-26-11-0043','PSCM','pscm');
    INSERT INTO purchase_order_items VALUES (11,1,'delivered_to_warehouse',NULL,NULL),
      (12,2,'delivered_to_warehouse',NULL,NULL),(13,3,'delivered_to_warehouse',NULL,NULL),
      (14,4,'delivered_to_requester','2026-11-17','DLV-4'),(15,5,'pending',NULL,NULL);
    INSERT INTO pscm_purchase_items VALUES (11,1,9,2),(12,2,8,1),(13,3,7,1);
    INSERT INTO inventory_transactions VALUES
      (101,11,301,201,'out','delivery',3,NULL,8,24),
      (102,12,302,202,'out','delivery',1,NULL,7,7),
      (103,13,303,203,'out','delivery',1,NULL,6,6),
      (104,14,304,204,'out','delivery',1,NULL,5,5),
      (105,11,301,201,'in','return',1,501,8,8),
      (106,11,301,201,'in','return',1,502,8,8);
    INSERT INTO delivery_documents VALUES
      (401,101,11,301,201,3,'DLV-1'),(402,102,12,302,202,1,'DLV-2'),
      (403,103,13,303,203,1,'DLV-3'),(404,104,14,304,204,1,'DLV-4');
    INSERT INTO inventory_lots VALUES (201,1,11,'receipt'),(202,2,12,'receipt'),
      (203,3,13,'receipt'),(204,4,14,'receipt');
    INSERT INTO pscm_fulfillment_issues VALUES
      (11,401,'DLV-1',201,3),(12,402,'DLV-2',202,1),(13,403,'DLV-3',203,1);
    INSERT INTO inventory_issue_cost_allocations VALUES (1,101,301,201,3,'DLV-1',1.01,0.335),
      (2,102,302,202,1,'DLV-2',70,70),(3,103,303,203,1,'DLV-3',60,60),(4,104,304,204,1,'DLV-4',12.75,12.75);
    INSERT INTO warehouse_returns VALUES (501,301,201,401,1),(502,301,201,NULL,1);
  `);
  sqlite
    .prepare("INSERT INTO audit_logs VALUES (4,'purchase_order','create_po',?)")
    .run(source(42, null));
  const dialect = new MySqlDialect();
  const db = {
    execute: async (statement: SQL | SQLWrapper) => {
      queryCount++;
      const query = dialect.sqlToQuery(statement.getSQL());
      return [sqlite.prepare(query.sql).all(...(query.params as number[]))];
    },
    transaction: async (work: (tx: typeof db) => unknown) => work(db),
  };
  getDb.mockResolvedValue(db);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("PSCM actual warehouse material costs", () => {
  it("counts allocated costs and exact posted recipient returns from the requested source only", async () => {
    expect(await getPscmMaterialCosts("pscm", [41, 42, 43, 41, 99])).toEqual({
      requisitions: [
        {
          requisitionId: 41,
          complete: true,
          deliveries: [
            {
              number: "DLV-1",
              sequence: 2,
              issuedCents: 101,
              returnedCents: 34,
            },
          ],
        },
        {
          requisitionId: 42,
          complete: true,
          deliveries: [
            {
              number: "DLV-4",
              sequence: null,
              issuedCents: 1275,
              returnedCents: 0,
            },
          ],
        },
        { requisitionId: 43, complete: true, deliveries: [] },
      ],
    });
    expect(queryCount).toBe(4);
    sqlite.exec(`
      INSERT INTO warehouse_returns VALUES (503,301,201,401,2);
      INSERT INTO inventory_transactions VALUES (107,11,301,201,'in','return',2,503,8,16);
    `);
    expect(await getPscmMaterialCosts("pscm", [41])).toMatchObject({
      requisitions: [
        {
          complete: true,
          deliveries: [{ issuedCents: 101, returnedCents: 101 }],
        },
      ],
    });
    expect(await getPscmMaterialCosts("different", [41, 42, 43])).toEqual({
      requisitions: [],
    });
  });

  it("marks missing snapshots and returns without a posted movement incomplete", async () => {
    sqlite.exec(`DELETE FROM inventory_issue_cost_allocations WHERE inventoryTransactionId=101;
      INSERT INTO warehouse_returns VALUES (504,304,204,404,1);
      INSERT INTO inventory_transactions VALUES (108,14,304,999,'in','return',1,504,5,5);
    `);
    expect(await getPscmMaterialCosts("pscm", [41, 42])).toEqual({
      requisitions: [
        { requisitionId: 41, complete: false, deliveries: [] },
        { requisitionId: 42, complete: false, deliveries: [] },
      ],
    });
  });

  it("does not reinterpret an unmatched task delivery as direct project cost", async () => {
    sqlite.exec(`DELETE FROM pscm_fulfillment_issues WHERE purchaseOrderItemId=11;
      DELETE FROM audit_logs WHERE entityId=4;
    `);
    sqlite
      .prepare(
        "INSERT INTO audit_logs VALUES (4,'purchase_order','create_po',?)"
      )
      .run(source(42, { id: 10, name: "Unmapped task" }));
    expect(await getPscmMaterialCosts("pscm", [41, 42])).toEqual({
      requisitions: [
        { requisitionId: 41, complete: false, deliveries: [] },
        { requisitionId: 42, complete: false, deliveries: [] },
      ],
    });
  });

  it("does not multiply a movement with conflicting cost allocation rows", async () => {
    sqlite.exec(
      "INSERT INTO inventory_issue_cost_allocations VALUES (5,101,301,201,3,'DLV-1',1.01,0.335)"
    );
    expect(await getPscmMaterialCosts("pscm", [41])).toEqual({
      requisitions: [{ requisitionId: 41, complete: false, deliveries: [] }],
    });
  });

  it("combines distinct full-quantity allocations once and excludes an unrelated origin lot", async () => {
    sqlite.exec(`UPDATE inventory_issue_cost_allocations SET quantity=0.4, allocatedCostTotal=5.10 WHERE id=4;
      INSERT INTO inventory_issue_cost_allocations VALUES (5,104,304,204,0.6,'DLV-4',7.65,12.75);
    `);
    expect(await getPscmMaterialCosts("pscm", [42])).toEqual({
      requisitions: [
        {
          requisitionId: 42,
          complete: true,
          deliveries: [
            {
              number: "DLV-4",
              sequence: null,
              issuedCents: 1275,
              returnedCents: 0,
            },
          ],
        },
      ],
    });
    sqlite.exec(
      "UPDATE inventory_lots SET purchaseOrderItemId=12 WHERE id=204"
    );
    expect(await getPscmMaterialCosts("pscm", [42])).toEqual({
      requisitions: [{ requisitionId: 42, complete: false, deliveries: [] }],
    });
  });
});
