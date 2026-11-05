import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql, eq, and, ne, inArray, asc, desc } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

// Evaluate the production SELECT expressions, with their actual joins and predicates,
// against disposable SQL data. No live connection or application environment is loaded.
function readExpression(file: string, method: string, variable: string, values: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let scope: ts.Node = source, expression = "";
  function findMethod(n: ts.Node) {
    if (ts.isMethodDeclaration(n) && n.name.getText(source) === method) scope = n;
    else ts.forEachChild(n, findMethod);
  }
  findMethod(source);
  function findVariable(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === variable) expression = n.initializer!.getText(source);
    ts.forEachChild(n, findVariable);
  }
  findVariable(scope);
  if (!expression) throw Error(`${method}.${variable} not found`);
  const code = ts.transpileModule(`(async () => (${expression}))()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const constants = Object.fromEntries(source.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations])
    .filter(n => n.initializer && ts.isStringLiteral(n.initializer)).map(n => [n.name.getText(source), (n.initializer as ts.StringLiteral).text]));
  return vm.runInNewContext(code, { ...schema, sql, eq, and, ne, inArray, asc, desc, ...constants, rows: (r: any) => r[0], ...values });
}
const stores: ReturnType<typeof purchaseSpecificationsDatabase>[] = [];
afterEach(() => stores.splice(0).forEach(f => f.close()));
function fixture() {
  const f = purchaseSpecificationsDatabase(); stores.push(f);
  f.memory.exec(`
    CREATE TABLE pmv2_material_requests(id INTEGER PRIMARY KEY,requestedById INTEGER,taskItemId INTEGER,teamId INTEGER,teamWarehouseId INTEGER,createdAt TEXT);
    CREATE TABLE pmv2_material_request_items(id INTEGER PRIMARY KEY,requestId INTEGER,catalogItemId INTEGER,itemNameSnapshot TEXT,requestedQuantity NUMERIC,unitSnapshot TEXT,status TEXT,receivedWarehouseQuantity NUMERIC,issuedToTeamQuantity NUMERIC,createdAt TEXT);
    CREATE TABLE pmv2_task_items(id INTEGER PRIMARY KEY,taskId INTEGER,titleSnapshot TEXT,status TEXT,result TEXT);
    CREATE TABLE pmv2_tasks(id INTEGER PRIMARY KEY,taskNumber TEXT,dueDate TEXT,status TEXT,teamId INTEGER,programTargetId INTEGER);
    CREATE TABLE pmv2_teams(id INTEGER PRIMARY KEY,code TEXT,warehouseId INTEGER);
    CREATE TABLE pmv2_item_actions(id INTEGER PRIMARY KEY,taskItemId INTEGER,performedById INTEGER,visitId INTEGER,note TEXT,action TEXT,createdAt TEXT);
    INSERT INTO users(id,name,isActive) VALUES(1,'Original inactive creator',0),(2,'Later reviewer',1);
    INSERT INTO pmv2_teams VALUES(1,'TEAM',5);
    INSERT INTO pmv2_tasks VALUES(1,'PM-1','2026-11-06','active',1,9);
    INSERT INTO pmv2_task_items VALUES(1,1,'Task','waiting_material','needs_material');
    INSERT INTO pmv2_material_requests VALUES(1,1,1,1,5,'2026-11-05 09:15:00');
    INSERT INTO pmv2_material_request_items VALUES(10,1,3,'Material',2,'piece','waiting_warehouse',0,0,'2026-11-05 09:16:00');
    INSERT INTO pmv2_item_actions VALUES(100,1,2,1,'{}','material_route_decision','2026-11-05 11:40:00');
  `);
  return f;
}
describe("material request metadata reads", () => {
  it("PMV2 waiting uses the request creator and header timestamp, preserving inactive historical users", async () => {
    const f = fixture();
    const result = await readExpression("server/pmv2/materials/warehouse-queue-service.ts", "listWaitingMaterialItems", "rows", { db: f.db });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ requestCreatorName: "Original inactive creator", requestCreatedAt: "2026-11-05 09:15:00" });
    expect(f.queries).toHaveLength(1);
    f.memory.exec("DELETE FROM users WHERE id=1");
    const missing = await readExpression("server/pmv2/materials/warehouse-queue-service.ts", "listWaitingMaterialItems", "rows", { db: f.db });
    expect(missing).toHaveLength(1); expect(missing[0].requestCreatorName).toBeNull();
  });
  it("PMV2 ready reads the original request separately from a later routing decision", async () => {
    const f = fixture();
    const routes = await readExpression("server/pmv2/materials/team-issue-handoff-service.ts", "listReadyToIssueQueue", "routeRows", { db: f.db });
    const requests = await readExpression("server/pmv2/materials/team-issue-handoff-service.ts", "listReadyToIssueQueue", "materialRequestRows", { db: f.db, materialRequestItemIds: [10] });
    expect(routes[0]).toMatchObject({ requestCreatorName: "Later reviewer", requestCreatedAt: "2026-11-05 11:40:00" });
    expect(requests[0]).toMatchObject({ requestCreatorName: "Original inactive creator", requestCreatedAt: "2026-11-05 09:15:00" });
    expect(f.queries).toHaveLength(2);
  });
  it("ticket metadata stays scoped to the authorized assignment and its individual need", async () => {
    const f = fixture();
    f.memory.function("LEAST", { varargs: true }, (...values: number[]) => Math.min(...values));
    f.memory.exec(`
      ALTER TABLE inventory ADD COLUMN isFrozen INTEGER;
      CREATE TABLE ticket_team_assignments(id INTEGER,materialRound INTEGER);
      CREATE TABLE ticket_team_material_needs(id INTEGER,assignmentId INTEGER,materialRound INTEGER,catalogItemId INTEGER,itemNameSnapshot TEXT,originalItemName TEXT,unitSnapshot TEXT,requestedQuantity NUMERIC,usedQuantity NUMERIC,requestedById INTEGER,warehouseId INTEGER,createdAt TEXT);
      CREATE TABLE ticket_team_delivery_links(needId INTEGER,issuedQuantity NUMERIC,returnedQuantity NUMERIC);
      INSERT INTO ticket_team_assignments VALUES(1,1),(2,1);
      INSERT INTO ticket_team_material_needs VALUES(10,1,1,NULL,'A','A','piece',2,NULL,1,5,'2026-11-05 09:15:00'),(11,2,1,NULL,'B','B','piece',1,NULL,2,5,'2026-11-05 11:40:00');
    `);
    const result = await readExpression("server/routers/maintenance-teams/assignment.repository.ts", "queue", "needs", { db: f.db, tickets: [{ assignmentId: 1 }] });
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ id: 10, requestCreatorName: "Original inactive creator", requestCreatedAt: "2026-11-05 09:15:00" });
    expect(f.queries).toHaveLength(1); expect(f.queries.every(q => /^\s*SELECT/.test(q.sql))).toBe(true);
  });
});
