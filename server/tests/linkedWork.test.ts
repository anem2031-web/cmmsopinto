import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  assertNoLinkedWork,
  loadLinkedWork,
} from "../services/inventory/linked-work";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE inventory_lots(id INTEGER,purchaseOrderItemId INTEGER,catalogItemId INTEGER,purchaseUnit TEXT,issueUnit TEXT,conversionFactor NUMERIC,sourceType TEXT);
    CREATE TABLE inventory_lot_balances(lotId INTEGER,inventoryId INTEGER,quantity NUMERIC);
    CREATE TABLE inventory(id INTEGER,linkedItemId INTEGER,warehouseId INTEGER,quantity NUMERIC);
    CREATE TABLE purchase_order_items(id INTEGER,purchaseOrderId INTEGER,quantity NUMERIC,deliveredQuantity NUMERIC,unit TEXT,status TEXT);
    CREATE TABLE purchase_orders(id INTEGER,ticketId INTEGER);
    CREATE TABLE tickets(id INTEGER,ticketNumber TEXT);
    CREATE TABLE ticket_team_supply_links(id INTEGER,sourceId INTEGER,sourceKind TEXT,status TEXT,needId INTEGER,linkedQuantity NUMERIC);
    CREATE TABLE ticket_team_material_needs(id INTEGER,assignmentId INTEGER,requestedQuantity NUMERIC,unitSnapshot TEXT,materialRound INTEGER);
    CREATE TABLE ticket_team_assignments(id INTEGER,ticketNumber TEXT,stage TEXT,materialRound INTEGER);
    CREATE TABLE ticket_team_delivery_links(id INTEGER,needId INTEGER,issuedQuantity NUMERIC,deliveryDocumentId INTEGER);
    CREATE TABLE delivery_documents(id INTEGER,unit TEXT);
    CREATE TABLE pmv2_material_purchase_links(id INTEGER,purchaseOrderItemId INTEGER,materialRequestItemId INTEGER,linkedQuantity NUMERIC);
    CREATE TABLE pmv2_material_request_items(id INTEGER,requestId INTEGER,requestedQuantity NUMERIC,issuedToTeamQuantity NUMERIC,unitSnapshot TEXT,status TEXT);
    CREATE TABLE pmv2_material_requests(id INTEGER,taskItemId INTEGER);
    CREATE TABLE pmv2_task_items(id INTEGER,taskId INTEGER);
    CREATE TABLE pmv2_tasks(id INTEGER,taskNumber TEXT);
    CREATE TABLE supplier_return_cases(id INTEGER,purchaseOrderItemId INTEGER,parentReplacementPlanId INTEGER,handoverStatus TEXT,lotId INTEGER,receiptId INTEGER,receiptItemId INTEGER);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER,caseId INTEGER,purchaseOrderItemId INTEGER,purchaseOrderId INTEGER,status TEXT);
    CREATE TABLE supplier_return_replacement_links(caseId INTEGER,purchaseOrderItemId INTEGER,purchaseOrderId INTEGER,lotId INTEGER,receiptId INTEGER,receiptItemId INTEGER);
    ALTER TABLE inventory_lots ADD COLUMN receiptId INTEGER;
    ALTER TABLE inventory_lots ADD COLUMN receiptItemId INTEGER;
    INSERT INTO tickets VALUES(1,'MT-1');
    INSERT INTO purchase_orders VALUES(1,1),(2,NULL),(3,NULL),(4,NULL);
    INSERT INTO purchase_order_items VALUES(11,1,3,1,'قطعة','delivered_to_warehouse'),(12,2,4,0,'قطعة','delivered_to_warehouse'),(13,3,4,0,'قطعة','delivered_to_warehouse'),(14,4,5,0,'قطعة','delivered_to_warehouse');
    INSERT INTO inventory_lots(id,purchaseOrderItemId,catalogItemId,purchaseUnit,issueUnit,conversionFactor,sourceType) VALUES(101,11,10,'قطعة','قطعة',1,'receipt'),(102,12,20,'قطعة','قطعة',1,'receipt'),(103,13,30,'قطعة','قطعة',1,'receipt'),(104,14,40,'قطعة','قطعة',1,'receipt');
    INSERT INTO inventory VALUES(201,10,1,2),(202,20,1,4),(203,30,1,3),(204,40,1,5);
    INSERT INTO inventory_lot_balances VALUES(101,201,2),(102,202,4),(103,203,3),(104,204,5);
    INSERT INTO ticket_team_assignments VALUES(501,'MT-2','waiting_material',1);
    INSERT INTO ticket_team_material_needs VALUES(601,501,4,'قطعة',1);
    INSERT INTO ticket_team_supply_links VALUES(701,12,'purchase','received',601,4);
    INSERT INTO ticket_team_delivery_links VALUES(801,601,1,1);
    INSERT INTO delivery_documents VALUES(1,'قطعة');
    INSERT INTO pmv2_tasks VALUES(1001,'PM-1');
    INSERT INTO pmv2_task_items VALUES(1002,1001);
    INSERT INTO pmv2_material_requests VALUES(1003,1002);
    INSERT INTO pmv2_material_request_items VALUES(1004,1003,4,2,'قطعة','waiting_warehouse');
    INSERT INTO pmv2_material_purchase_links VALUES(1005,13,1004,4);
  `);
  const calls: string[] = [];
  const dialect = new MySqlDialect();
  const flags = { replacements: false };
  const port = {
    execute: async (q: any) => {
      const c = dialect.sqlToQuery(q);
      calls.push(c.sql);
      if (c.sql.includes("information_schema.TABLES"))
        return [
          flags.replacements
            ? [
                "supplier_return_cases",
                "supplier_return_replacement_plans",
                "supplier_return_replacement_links",
              ].map(name => ({ name }))
            : [],
        ];
      return [db.prepare(c.sql).all(...c.params)];
    },
  };
  return { db, calls, port, flags };
}
describe("pending purchased material linked to maintenance", () => {
  it("identifies legacy tickets, team needs and PMV2 and excludes unrelated stock", async () => {
    const f = fixture();
    try {
      const result = await loadLinkedWork(f.port, [10, 20, 30, 40]);
      expect(result.get(10)).toMatchObject([
        { kind: "ticket", reference: "MT-1", quantity: 2, warehouseId: 1 },
      ]);
      expect(result.get(20)).toMatchObject([
        { kind: "ticket", reference: "MT-2", quantity: 3 },
      ]);
      expect(result.get(30)).toMatchObject([
        { kind: "pmv2", reference: "PM-1", quantity: 2 },
      ]);
      expect(result.has(40)).toBe(false);
      expect(f.calls).toHaveLength(4);
      expect(f.calls.every(q => q.trimStart().startsWith("SELECT"))).toBe(true);
    } finally {
      f.db.close();
    }
  });
  it("removes the block after recorded issue and when the original lot is exhausted", async () => {
    const f = fixture();
    try {
      f.db
        .exec(`UPDATE purchase_order_items SET deliveredQuantity=3 WHERE id=11;
        INSERT INTO ticket_team_delivery_links VALUES(802,601,3,1);
        UPDATE pmv2_material_request_items SET status='issued_to_team',issuedToTeamQuantity=4 WHERE id=1004;`);
      expect((await loadLinkedWork(f.port, [10, 20, 30])).size).toBe(0);
      f.db.exec(
        `UPDATE purchase_order_items SET deliveredQuantity=0 WHERE id=11; UPDATE inventory_lot_balances SET quantity=0 WHERE lotId=101;`
      );
      expect((await loadLinkedWork(f.port, [10])).size).toBe(0);
    } finally {
      f.db.close();
    }
  });
  it("honors the legacy completion status even when deliveredQuantity was never populated", async () => {
    const f = fixture();
    try {
      f.db.exec(`UPDATE purchase_order_items SET status='delivered_to_requester',deliveredQuantity=NULL WHERE id=11`);
      expect((await loadLinkedWork(f.port, [10])).size).toBe(0);
    } finally { f.db.close(); }
  });
  it("blocks direct server calls and reports all references, while ordinary items pass", async () => {
    const f = fixture();
    try {
      await expect(assertNoLinkedWork(f.port, [10, 30])).rejects.toThrow(
        "MT-1"
      );
      await expect(assertNoLinkedWork(f.port, [30])).rejects.toThrow("PM-1");
      await expect(assertNoLinkedWork(f.port, [40])).resolves.toBeUndefined();
    } finally {
      f.db.close();
    }
  });
  it("does not reserve the same received quantity twice across warehouses", async () => {
    const f = fixture();
    try {
      f.db.exec(
        `INSERT INTO inventory VALUES(205,10,2,2); INSERT INTO inventory_lot_balances VALUES(101,205,2);`
      );
      const refs = (await loadLinkedWork(f.port, [10])).get(10)!;
      expect(refs.reduce((n, x) => n + Number(x.quantity), 0)).toBe(2);
    } finally {
      f.db.close();
    }
  });
  it("shows all references without inventing a split for partially received shared stock", async () => {
    const f = fixture();
    try {
      f.db
        .exec(`INSERT INTO ticket_team_assignments VALUES(502,'MT-3','waiting_material',1);
        INSERT INTO ticket_team_material_needs VALUES(602,502,4,'قطعة',1);
        INSERT INTO ticket_team_supply_links VALUES(702,12,'purchase','received',602,4);`);
      const refs = (await loadLinkedWork(f.port, [20])).get(20)!;
      expect(refs.map(x => x.reference)).toEqual(["MT-2", "MT-3"]);
      expect(refs.every(x => x.quantity === null)).toBe(true);
    } finally {
      f.db.close();
    }
  });
  it("traces a two-generation supplier replacement back to its PMV2 purchase", async () => {
    const f = fixture();
    try {
      f.flags.replacements = true;
      f.db.exec(`INSERT INTO purchase_orders VALUES(5,NULL);
        INSERT INTO purchase_order_items VALUES(15,5,2,0,'قطعة','delivered_to_warehouse');
        INSERT INTO inventory_lots VALUES(105,15,50,'قطعة','قطعة',1,'receipt',71,81);
        INSERT INTO inventory VALUES(205,50,1,2); INSERT INTO inventory_lot_balances VALUES(105,205,2);
        INSERT INTO supplier_return_cases VALUES(201,13,NULL,'accepted',103,73,83),(202,16,301,'accepted',106,72,82);
        INSERT INTO supplier_return_replacement_plans VALUES(301,201,16,6,'received'),(302,202,15,5,'received');
        INSERT INTO supplier_return_replacement_links VALUES(201,16,6,106,72,82),(202,15,5,105,71,81);`);
      const links = (await loadLinkedWork(f.port, [50])).get(50)!;
      expect(links).toMatchObject([
        { kind: "pmv2", reference: "PM-1", quantity: null },
      ]);
      await expect(assertNoLinkedWork(f.port, [50])).rejects.toThrow("PM-1");
      f.db.exec(
        `UPDATE pmv2_material_request_items SET status='issued_to_team' WHERE id=1004`
      );
      expect((await loadLinkedWork(f.port, [50])).size).toBe(0);
    } finally {
      f.db.close();
    }
  });
  it("does not guess issued quantities after a unit change", async () => {
    const f = fixture();
    try {
      f.db.exec(
        `UPDATE delivery_documents SET unit='علبة' WHERE id=1; UPDATE ticket_team_delivery_links SET issuedQuantity=4 WHERE id=801;`
      );
      const refs = (await loadLinkedWork(f.port, [20])).get(20)!;
      expect(refs).toMatchObject([{ reference: "MT-2", quantity: null }]);
      await expect(assertNoLinkedWork(f.port, [20])).rejects.toThrow("MT-2");
    } finally {
      f.db.close();
    }
  });
  it("marks unclear conversion as requiring review instead of guessing a quantity", async () => {
    const f = fixture();
    try {
      f.db.exec(`UPDATE purchase_order_items SET unit='علبة' WHERE id=11`);
      expect(
        (await loadLinkedWork(f.port, [10])).get(10)?.[0].quantity
      ).toBeNull();
      await expect(assertNoLinkedWork(f.port, [10])).rejects.toThrow("MT-1");
    } finally {
      f.db.close();
    }
  });
});
