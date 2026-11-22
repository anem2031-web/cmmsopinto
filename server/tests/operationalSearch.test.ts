import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { OperationalIssueService } from "../services/operational-issues/service";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

describe("operational order search", () => {
  it("finds a partial item name before the 500 row limit without crossing creator scope", async () => {
    const mem = new DatabaseSync(":memory:");
    try {
      mem.exec(`CREATE TABLE operational_issue_orders(id INTEGER,orderNumber TEXT,reason TEXT,createdById INTEGER,collectorId INTEGER,siteId INTEGER,sectionId INTEGER);
        CREATE TABLE operational_issue_items(id INTEGER,orderId INTEGER,itemName TEXT);
        CREATE TABLE users(id INTEGER,name TEXT);
        CREATE TABLE sites(id INTEGER,name TEXT);
        CREATE TABLE sections(id INTEGER,name TEXT);
        INSERT INTO users VALUES(10,'Own creator'),(11,'Other creator'),(12,'Recipient');
        INSERT INTO sites VALUES(1,'Main location'); INSERT INTO sections VALUES(1,'Section');
        INSERT INTO operational_issue_orders VALUES(1,'OPR-1','old',10,12,1,1),(2,'OPR-2','foreign',11,12,1,1);
        INSERT INTO operational_issue_items VALUES(1,1,'Special pump'),(2,2,'Special pump');
        INSERT INTO operational_issue_orders VALUES(600,'OPR-600','symbol',10,12,1,1),(601,'OPR-601','symbol',10,12,1,1);
        INSERT INTO operational_issue_items VALUES(600,600,'Valve 75%_!'),(601,601,'Valve 75ab!');`);
      for (let id=3; id<510; id++) mem.prepare("INSERT INTO operational_issue_orders VALUES(?,?,?,10,12,1,1)").run(id,`OPR-${id}`,"routine");
      const dialect=new MySqlDialect();
      const db={execute:async (query:any)=>{const q=dialect.sqlToQuery(query);return [mem.prepare(q.sql).all(...q.params)];}};
      const service=new OperationalIssueService({database:async()=>db} as any);
      const manager={id:10,role:"maintenance_manager",isActive:1} as any;
      const owner={id:99,role:"owner",isActive:1} as any;
      expect((await service.list(manager,"pump")).map(row=>row.orderNumber)).toEqual(["OPR-1"]);
      expect((await service.list(owner,"pump")).map(row=>row.orderNumber)).toEqual(["OPR-2","OPR-1"]);
      expect((await service.list(manager,"OPR-1")).some(row=>row.orderNumber==="OPR-1")).toBe(true);
      expect((await service.list(manager,"%_!")).map(row=>row.orderNumber)).toEqual(["OPR-600"]);
    } finally {mem.close()}
  });
});
