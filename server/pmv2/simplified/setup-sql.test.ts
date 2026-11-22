import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { buildSimplifiedSchedule } from "../checklists/simplified-recurrence";
import { addSimplifiedItemSql, createSimplifiedDraftSql, ensurePmv2TeamWarehouseLinkSql, type SetupSqlTx } from "./setup-sql";
import { writeSimplifiedOccurrencesSql } from "./generate-sql";
import { SimplifiedSqlRepository } from "./setup-repository";
import { SimplifiedSetupService } from "./setup-service";
import { SimplifiedSqlSchedulerRepository } from "./scheduler-repository";
import { SimplifiedScheduler } from "./scheduler";
import { SqlTeamManagementRepository } from "../../routers/maintenance-teams/repository";
import { router } from "../../_core/trpc";
import { createPmv2SimplifiedRouter } from "../../routers/pmv2/simplified";
import { sql } from "drizzle-orm";
import { pmv2Tasks } from "../../../drizzle/schema";
import { pmv2ExecutionTeamCondition } from "../security/execution-access";
import { loadAuthorizedTaskItemTitles } from "../security/task-item-translations";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sites(id INTEGER PRIMARY KEY,isActive INTEGER);
    CREATE TABLE sections(id INTEGER PRIMARY KEY,siteId INTEGER,isActive INTEGER);
    CREATE TABLE warehouses(id INTEGER PRIMARY KEY,type TEXT,isActive INTEGER);
    CREATE TABLE maintenance_teams(id INTEGER PRIMARY KEY,name TEXT,warehouseId INTEGER,isActive INTEGER);
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,isActive INTEGER);
    CREATE TABLE maintenance_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);
    CREATE TABLE pmv2_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);
    CREATE TABLE pmv2_specialties(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE,name TEXT,isActive INTEGER,createdById INTEGER);
    CREATE TABLE pmv2_teams(id INTEGER PRIMARY KEY AUTOINCREMENT,specialtyId INTEGER,code TEXT UNIQUE,warehouseId INTEGER,isActive INTEGER);
    CREATE TABLE pmv2_unified_team_links(pmv2TeamId INTEGER PRIMARY KEY,maintenanceTeamId INTEGER,createdById INTEGER);
    CREATE TABLE pmv2_checklists(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,isActive INTEGER,createdById INTEGER);
    CREATE TABLE pmv2_programs(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,teamId INTEGER,checklistId INTEGER,isActive INTEGER,createdById INTEGER);
    CREATE TABLE pmv2_program_targets(id INTEGER PRIMARY KEY AUTOINCREMENT,programId INTEGER,sectionId INTEGER,UNIQUE(programId,sectionId));
    CREATE TABLE pmv2_simplified_plans(programId INTEGER PRIMARY KEY,siteId INTEGER,sectionId INTEGER,state TEXT,pausedOn TEXT,createdById INTEGER,updatedById INTEGER);
    CREATE TABLE pmv2_simplified_plan_revisions(
      programId INTEGER PRIMARY KEY REFERENCES pmv2_programs(id),
      planId INTEGER NOT NULL REFERENCES pmv2_simplified_plans(programId),
      revisionNumber INTEGER NOT NULL,
      effectiveOn TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(planId, revisionNumber)
    );
    CREATE TABLE pmv2_checklist_items(id INTEGER PRIMARY KEY AUTOINCREMENT,checklistId INTEGER,title TEXT,sortOrder INTEGER,isRequired INTEGER,isActive INTEGER,frequency TEXT,frequencyValue INTEGER,weekday INTEGER,monthDay INTEGER,anchorDate TEXT,scheduleConfigJson TEXT);
    CREATE TABLE pmv2_simplified_item_modes(checklistItemId INTEGER PRIMARY KEY,kind TEXT,effectiveOn TEXT);
    CREATE TABLE entity_translations(id INTEGER PRIMARY KEY AUTOINCREMENT,entityType TEXT,entityId INTEGER,fieldName TEXT,languageCode TEXT,translatedText TEXT,translationStatus TEXT,versionNumber INTEGER,approvedById INTEGER,approvedAt TEXT);
    CREATE TABLE translation_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,entityTranslationId INTEGER,versionNumber INTEGER,translatedText TEXT,translationStatus TEXT,changedById INTEGER,changeReason TEXT);
    CREATE TABLE pmv2_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,programId INTEGER,programTargetId INTEGER,teamId INTEGER,taskNumber TEXT UNIQUE,dueDate TEXT,status TEXT,UNIQUE(programId,programTargetId,dueDate));
    CREATE TABLE pmv2_task_items(id INTEGER PRIMARY KEY AUTOINCREMENT,taskId INTEGER,sourceChecklistItemId INTEGER,titleSnapshot TEXT,sortOrderSnapshot INTEGER,frequencySnapshot TEXT,frequencyValueSnapshot INTEGER,weekdaySnapshot INTEGER,monthDaySnapshot INTEGER,anchorDateSnapshot TEXT,recurrenceLabelSnapshot TEXT,scheduledDate TEXT,status TEXT,UNIQUE(taskId,sourceChecklistItemId,scheduledDate));
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,userId INTEGER,action TEXT,entityType TEXT,entityId INTEGER,newValues TEXT);
    INSERT INTO sites VALUES(1,1); INSERT INTO sections VALUES(2,1,1); INSERT INTO warehouses VALUES(5,'branch',1);
    INSERT INTO maintenance_teams VALUES(3,'فريق الكهرباء',5,1); INSERT INTO users VALUES(6,'technician',1),(7,'owner',1); INSERT INTO maintenance_team_members VALUES(3,6,1);
  `);
  const dialect = new MySqlDialect();
  const tx: SetupSqlTx = { async execute(statement) {
    const query = dialect.sqlToQuery(statement);
    // SQLite accepts scalar subqueries in JOIN conditions that TiDB rejects.
    if (/\bON\s+\w+\.\w+\s*=\s*COALESCE\s*\(\s*\(\s*SELECT\b/i.test(query.sql)) {
      throw new Error("TiDB: ON condition doesn't support subqueries yet");
    }
    const statementText = query.sql.replace(/\s+FOR UPDATE/gi, "").replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m-%d'\)/gi, "$1");
    const prepared = db.prepare(statementText);
    if (/^\s*(?:SELECT|WITH)\b/i.test(statementText)) return [prepared.all(...query.params as any[])];
    const result = prepared.run(...query.params as any[]);
    return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }];
  } };
  const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n);
  return { db, tx, count };
}
const base = { title: "فحص المطعم", siteId: 1, sectionId: 2, teamId: 3 };
const subtask = { titleAr: "فحص الكهرباء", titleEn: "Inspect electricity", titleUr: "بجلی کا معائنہ", recurrence: { kind: "weekly" as const, startDate: "2026-11-01", weekday: 3 } };

describe("simplified PMV2 draft transaction writers", () => {
  it("creates a draft, reuses the same central team, and stores reviewed translations", async () => {
    const f = fixture(); f.db.exec("BEGIN");
    const id = await createSimplifiedDraftSql(f.tx, base, 7);
    await addSimplifiedItemSql(f.tx, id, subtask, buildSimplifiedSchedule(subtask.recurrence), 7);
    const second = await createSimplifiedDraftSql(f.tx, { ...base, title: "فحص آخر" }, 7);
    f.db.exec("COMMIT");
    expect(second).not.toBe(id);
    expect(f.count("pmv2_unified_team_links")).toBe(1);
    expect(f.count("pmv2_teams")).toBe(1);
    expect(f.count("pmv2_programs")).toBe(2);
    expect(f.count("entity_translations")).toBe(2);
    expect(f.count("translation_versions")).toBe(2);
    expect(f.db.prepare("SELECT isActive FROM pmv2_programs WHERE id=?").get(id)?.isActive).toBe(0);
    expect(f.db.prepare("SELECT kind FROM pmv2_simplified_item_modes").get()?.kind).toBe("weekly");
    f.db.close();
  });
  it("rolls back the item and all translations if one write fails", async () => {
    const f = fixture(); f.db.exec("BEGIN"); const id = await createSimplifiedDraftSql(f.tx, base, 7); f.db.exec("COMMIT");
    f.db.exec("CREATE TRIGGER reject_urdu BEFORE INSERT ON entity_translations WHEN NEW.languageCode='ur' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    f.db.exec("BEGIN");
    await expect(addSimplifiedItemSql(f.tx, id, subtask, buildSimplifiedSchedule(subtask.recurrence), 7)).rejects.toThrow();
    f.db.exec("ROLLBACK");
    expect(f.count("pmv2_checklist_items")).toBe(0);
    expect(f.count("entity_translations")).toBe(0);
    expect(f.count("translation_versions")).toBe(0);
    f.db.close();
  });
  it("rejects a section from another site and a team without active technicians before creating data", async () => {
    const f = fixture();
    await expect(createSimplifiedDraftSql(f.tx, { ...base, siteId: 9 }, 7)).rejects.toThrow();
    f.db.exec("UPDATE users SET isActive=0 WHERE id=6");
    await expect(createSimplifiedDraftSql(f.tx, base, 7)).rejects.toThrow();
    expect(f.count("pmv2_programs")).toBe(0);
    f.db.close();
  });
});


describe("simplified PMV2 occurrence writer", () => {
  it("generates once, preserves the missed date and prioritizes nondaily work", async () => {
    const f = fixture(); f.db.exec("BEGIN");
    const id = await createSimplifiedDraftSql(f.tx, base, 7);
    const weekly = await addSimplifiedItemSql(f.tx, id, subtask, buildSimplifiedSchedule(subtask.recurrence), 7);
    const dailyItem = { ...subtask, titleAr: "فحص يومي", recurrence: { kind: "daily" as const, startDate: "2026-11-01" } };
    const daily = await addSimplifiedItemSql(f.tx, id, dailyItem, buildSimplifiedSchedule(dailyItem.recurrence), 7);
    const occurrences = [{ itemId: weekly, scheduledDate: "2026-11-04", kind: "weekly" as const, fromPause: true }, { itemId: daily, scheduledDate: "2026-11-07", kind: "daily" as const, fromPause: false }];
    const first = await writeSimplifiedOccurrencesSql(f.tx, id, "2026-11-07", occurrences);
    const second = await writeSimplifiedOccurrencesSql(f.tx, id, "2026-11-07", occurrences);
    f.db.exec("COMMIT");
    expect(first.createdItems).toBe(2); expect(second.createdItems).toBe(0);
    expect(f.count("pmv2_tasks")).toBe(1); expect(f.count("pmv2_task_items")).toBe(2);
    const rows = f.db.prepare("SELECT scheduledDate,sortOrderSnapshot FROM pmv2_task_items ORDER BY sortOrderSnapshot,id").all();
    expect(rows.map(x => x.scheduledDate)).toEqual(["2026-11-04", "2026-11-07"]);
    expect(f.db.prepare("SELECT COUNT(*) n FROM entity_translations WHERE entityType='PMV2_TASK_ITEM'").get()?.n).toBe(4);
    f.db.close();
  });
  it("rolls back the generated task if any subtask write fails", async () => {
    const f = fixture(); f.db.exec("BEGIN"); const id = await createSimplifiedDraftSql(f.tx, base, 7);
    const weekly = await addSimplifiedItemSql(f.tx, id, subtask, buildSimplifiedSchedule(subtask.recurrence), 7); f.db.exec("COMMIT");
    f.db.exec("CREATE TRIGGER reject_item BEFORE INSERT ON pmv2_task_items BEGIN SELECT RAISE(ABORT,'test failure'); END");
    f.db.exec("BEGIN");
    await expect(writeSimplifiedOccurrencesSql(f.tx, id, "2026-11-07", [{ itemId: weekly, scheduledDate: "2026-11-04", kind: "weekly", fromPause: true }])).rejects.toThrow();
    f.db.exec("ROLLBACK"); expect(f.count("pmv2_tasks")).toBe(0); expect(f.count("audit_logs")).toBe(0); f.db.close();
  });
});


describe("simplified setup SQL integration in an isolated database", () => {
  it("creates, activates, pauses and resumes atomically with correct backlog and translations", async () => {
    const f = fixture();
    const database = { async transaction<T>(work: (tx: SetupSqlTx) => Promise<T>) { f.db.exec("BEGIN"); try { const result = await work(f.tx); f.db.exec("COMMIT"); return result; } catch (e) { f.db.exec("ROLLBACK"); throw e; } } };
    let date = "2026-11-01"; const service = new SimplifiedSetupService(new SimplifiedSqlRepository(async () => database), () => date);
    const actor = { id: 7, role: "owner", isActive: 1 };
    const { id } = await service.create(actor, base);
    const weekly = await service.addItem(actor, id, subtask);
    const daily = await service.addItem(actor, id, { ...subtask, titleAr: "فحص يومي", recurrence: { kind: "daily", startDate: "2026-11-01" } });
    await service.activate(actor, id); await service.pause(actor, id);
    date = "2026-11-07"; const result = await service.resume(actor, id);
    expect(result.occurrences.map(x => [x.itemId, x.scheduledDate])).toEqual([[weekly.id, "2026-11-04"], [daily.id, "2026-11-07"]]);
    expect(f.count("pmv2_tasks")).toBe(2);
    expect(f.db.prepare("SELECT state FROM pmv2_simplified_plans WHERE programId=?").get(id)?.state).toBe("active");
    expect(f.db.prepare("SELECT isActive FROM pmv2_programs WHERE id=?").get(id)?.isActive).toBe(0);
    await expect(service.resume(actor, id)).rejects.toThrow();
    expect(f.count("pmv2_tasks")).toBe(2); f.db.close();
  });
  it("rechecks the manager's current role in the transaction", async () => {
    const f = fixture(); const database = { async transaction<T>(work: (tx: SetupSqlTx) => Promise<T>) { f.db.exec("BEGIN"); try { const result=await work(f.tx); f.db.exec("COMMIT"); return result; } catch(e) { f.db.exec("ROLLBACK"); throw e; } } };
    const service = new SimplifiedSetupService(new SimplifiedSqlRepository(async () => database), () => "2026-11-01");
    f.db.exec("UPDATE users SET role='technician' WHERE id=7");
    await expect(service.create({ id: 7, role: "owner", isActive: 1 }, base)).rejects.toThrow();
    expect(f.count("pmv2_programs")).toBe(0); f.db.close();
  });
});


describe("simplified scheduler integration in an isolated database", () => {
  it("generates due items once, stops during a pause, and leaves existing tasks intact", async () => {
    const f = fixture();
    const database = { execute: f.tx.execute, async transaction<T>(work: (tx: SetupSqlTx) => Promise<T>) { f.db.exec("BEGIN"); try { const result=await work(f.tx); f.db.exec("COMMIT"); return result; } catch(e) { f.db.exec("ROLLBACK"); throw e; } } };
    let date="2026-11-01"; const setup = new SimplifiedSetupService(new SimplifiedSqlRepository(async () => database), () => date);
    const scheduler = new SimplifiedScheduler(new SimplifiedSqlSchedulerRepository(async () => database)); const actor = { id: 7, role: "owner", isActive: 1 };
    const { id } = await setup.create(actor, base);
    await setup.addItem(actor, id, subtask);
    await setup.addItem(actor, id, { ...subtask, titleAr: "فحص يومي", recurrence: { kind: "daily", startDate: "2026-11-01" } });
    await setup.activate(actor,id);
    expect(f.count("pmv2_tasks")).toBe(1);
    date="2026-11-02"; await scheduler.runForDate(date); await scheduler.runForDate(date);
    expect(f.count("pmv2_tasks")).toBe(2); expect(f.count("pmv2_task_items")).toBe(2);
    await setup.pause(actor,id); date="2026-11-04"; await scheduler.runForDate(date);
    expect(f.count("pmv2_tasks")).toBe(2); expect(f.count("pmv2_task_items")).toBe(2);
    date="2026-11-07"; const result=await setup.resume(actor,id);
    expect(result.occurrences.map(row=>row.scheduledDate)).toEqual(["2026-11-04","2026-11-07"]);
    expect(f.count("pmv2_tasks")).toBe(3); expect(f.count("pmv2_task_items")).toBe(4);
    await scheduler.runForDate(date); expect(f.count("pmv2_task_items")).toBe(4); f.db.close();
  });
});


describe("team warehouse history", () => {
  it("keeps old tasks in their original team warehouse and uses the new warehouse for future tasks", async () => {
    const f=fixture(); const database={execute:f.tx.execute,async transaction<T>(work:(tx:SetupSqlTx)=>Promise<T>){f.db.exec("BEGIN");try{const result=await work(f.tx);f.db.exec("COMMIT");return result}catch(e){f.db.exec("ROLLBACK");throw e}}};
    let date="2026-11-01";const setup=new SimplifiedSetupService(new SimplifiedSqlRepository(async()=>database),()=>date);
    const scheduler=new SimplifiedScheduler(new SimplifiedSqlSchedulerRepository(async()=>database));const actor={id:7,role:"owner",isActive:1};
    const {id}=await setup.create(actor,base);await setup.addItem(actor,id,{...subtask,recurrence:{kind:"daily",startDate:"2026-11-01"}});await setup.activate(actor,id);
    f.db.exec("INSERT INTO warehouses VALUES(8,'branch',1); BEGIN");
    await ensurePmv2TeamWarehouseLinkSql(f.tx,3,8,"فريق الكهرباء",7);
    f.db.exec("UPDATE maintenance_teams SET warehouseId=8 WHERE id=3; COMMIT");
    await scheduler.runForDate("2026-11-01");
    date="2026-11-02";await scheduler.runForDate(date);
    const work=f.db.prepare("SELECT task.dueDate,team.warehouseId FROM pmv2_tasks task JOIN pmv2_teams team ON team.id=task.teamId ORDER BY task.dueDate").all();
    expect(work.map(x=>[x.dueDate,x.warehouseId])).toEqual([["2026-11-01",5],["2026-11-02",8]]);
    expect(f.count("pmv2_unified_team_links")).toBe(2); expect(f.count("pmv2_specialties")).toBe(1);f.db.close();
  });
});

afterEach(() => vi.unstubAllEnvs());


describe("team profile change with unified PMV2", () => {
  it("adds a new warehouse identity atomically without changing old work", async () => {
    vi.stubEnv("PMV2_SIMPLIFIED_ENABLED","true"); const f=fixture(); f.db.exec("ALTER TABLE maintenance_teams ADD COLUMN updatedById INTEGER; INSERT INTO warehouses VALUES(8,'branch',1)");
    f.db.exec("BEGIN");await createSimplifiedDraftSql(f.tx,base,7);f.db.exec("COMMIT");
    const database={execute:f.tx.execute,async transaction<T>(work:(tx:SetupSqlTx)=>Promise<T>){f.db.exec("BEGIN");try{const result=await work(f.tx);f.db.exec("COMMIT");return result}catch(e){f.db.exec("ROLLBACK");throw e}}};
    const repo=new SqlTeamManagementRepository(async()=>database);
    await repo.transaction(tx=>tx.updateTeamProfile(3,"فريق الكهرباء",8,7));
    expect(f.db.prepare("SELECT warehouseId FROM maintenance_teams WHERE id=3").get()?.warehouseId).toBe(8);
    expect(f.db.prepare("SELECT warehouseId FROM pmv2_teams ORDER BY id").all().map(x=>x.warehouseId)).toEqual([5,8]);
    expect(f.count("pmv2_unified_team_links")).toBe(2);f.db.close();
  });
  it("rolls back the team change if the new link cannot be created", async () => {
    vi.stubEnv("PMV2_SIMPLIFIED_ENABLED","true"); const f=fixture();f.db.exec("ALTER TABLE maintenance_teams ADD COLUMN updatedById INTEGER; INSERT INTO warehouses VALUES(8,'branch',1)");
    f.db.exec("BEGIN");await createSimplifiedDraftSql(f.tx,base,7);f.db.exec("COMMIT");
    f.db.exec("CREATE TRIGGER reject_new_team BEFORE INSERT ON pmv2_teams BEGIN SELECT RAISE(ABORT,'test'); END");
    const database={execute:f.tx.execute,async transaction<T>(work:(tx:SetupSqlTx)=>Promise<T>){f.db.exec("BEGIN");try{const result=await work(f.tx);f.db.exec("COMMIT");return result}catch(e){f.db.exec("ROLLBACK");throw e}}};
    await expect(new SqlTeamManagementRepository(async()=>database).transaction(tx=>tx.updateTeamProfile(3,"فريق الكهرباء",8,7))).rejects.toThrow();
    expect(f.db.prepare("SELECT warehouseId FROM maintenance_teams WHERE id=3").get()?.warehouseId).toBe(5);
    expect(f.count("pmv2_unified_team_links")).toBe(1);f.db.close();
  });
});


describe("simplified PMV2 management API integration", () => {
  it("saves translated subtasks and executes the complete schedule workflow without touching a live DB", async () => {
    vi.stubEnv("PMV2_SIMPLIFIED_ENABLED","true"); const f=fixture();
    f.db.exec("ALTER TABLE sites ADD COLUMN name TEXT; ALTER TABLE sections ADD COLUMN name TEXT; UPDATE sites SET name='الملقا'; UPDATE sections SET name='فودوزو'");
    const database={execute:f.tx.execute,async transaction<T>(work:(tx:SetupSqlTx)=>Promise<T>){f.db.exec("BEGIN");try{const result=await work(f.tx);f.db.exec("COMMIT");return result}catch(e){f.db.exec("ROLLBACK");throw e}}};
    let date="2026-11-01";const service=new SimplifiedSetupService(new SimplifiedSqlRepository(async()=>database),()=>date);
    const api=router({pmv2:router({simplified:createPmv2SimplifiedRouter({enabled:()=>true,db:async()=>database,service})})});
    const user={id:7,role:"owner",isActive:1};const caller=api.createCaller({user,authenticatedUser:user} as any).pmv2.simplified;
    expect(await caller.status()).toEqual({enabled:true,legacyExists:false});
    expect((await caller.teams()).map(x=>x.name)).toContain("فريق الكهرباء");
    const { id } = await caller.create(base);
    const input = { planId: id, ...subtask };
    await expect(caller.addItem({ ...input, titleEn: " " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.addItem({ ...input, titleUr: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.count("pmv2_checklist_items")).toBe(0);
    expect(f.count("entity_translations")).toBe(0);
    await caller.addItem({ ...input, titleEn: " Check the electrical wiring ", titleUr: " بجلی کی تاروں کی جانچ " });
    const loaded = await caller.get({ id });
    expect(loaded.items[0]).toMatchObject({
      titleAr: "فحص الكهرباء", titleEn: "Check the electrical wiring", titleUr: "بجلی کی تاروں کی جانچ",
    });
    expect(await caller.list()).toMatchObject({ items: [{ id, state: "draft" }], nextId: null });
    expect(await caller.list({ beforeId: id })).toEqual({ items: [], nextId: null });
    expect((await caller.status()).legacyExists).toBe(false);
    f.db.exec("INSERT INTO pmv2_teams(id,specialtyId,code,warehouseId,isActive) VALUES(999,999,'LEGACY',5,1)");
    expect((await caller.status()).legacyExists).toBe(true);
    await caller.activate({planId:id});await caller.pause({planId:id});date="2026-11-07";await caller.resume({planId:id});
    expect((await caller.get({id})).state).toBe("active");
    expect(f.db.prepare("SELECT scheduledDate FROM pmv2_task_items").get()?.scheduledDate).toBe("2026-11-04");
    const tech={id:6,role:"technician",isActive:1};
    await expect(api.createCaller({user:tech,authenticatedUser:tech} as any).pmv2.simplified.get({id})).rejects.toThrow();
    f.db.close();
  });
});


describe("technician receives a translated authorized task", () => {
  it("exposes the saved task translation only to an active member of the linked team", async () => {
    vi.stubEnv("PMV2_SIMPLIFIED_ENABLED","true"); const f=fixture(); f.db.exec("INSERT INTO users VALUES(8,'technician',1)");
    const database={execute:f.tx.execute,async transaction<T>(work:(tx:SetupSqlTx)=>Promise<T>){f.db.exec("BEGIN");try{const result=await work(f.tx);f.db.exec("COMMIT");return result}catch(e){f.db.exec("ROLLBACK");throw e}}};
    const service=new SimplifiedSetupService(new SimplifiedSqlRepository(async()=>database),()=>"2026-11-04");
    const actor={id:7,role:"owner",isActive:1};const {id}=await service.create(actor,base);await service.addItem(actor,id,subtask);await service.activate(actor,id);
    const taskId=Number(f.db.prepare("SELECT id FROM pmv2_tasks").get()?.id);
    async function authorized(userId:number){const q=sql`SELECT i.id FROM pmv2_task_items i INNER JOIN pmv2_tasks ON pmv2_tasks.id=i.taskId INNER JOIN users AS pmv2ExecutionActor ON pmv2ExecutionActor.id=${userId} WHERE pmv2_tasks.id=${taskId} AND ${pmv2ExecutionTeamCondition(userId,pmv2Tasks.teamId)}`;const value=await f.tx.execute(q);return (value as any)[0].map((x:any)=>Number(x.id));}
    const own=await authorized(6);expect(own).toHaveLength(1);
    expect(f.db.prepare("SELECT titleSnapshot FROM pmv2_task_items WHERE id=?").get(own[0])?.titleSnapshot).toBe("فحص الكهرباء");
    expect((await loadAuthorizedTaskItemTitles(f.tx,own,"en")).get(own[0])).toBe("Inspect electricity");
    expect((await loadAuthorizedTaskItemTitles(f.tx,own,"ur")).get(own[0])).toBe("بجلی کا معائنہ");
    expect(await authorized(8)).toEqual([]); f.db.close();
  });
});


describe("PMV2 edits affect only newly generated work", () => {
  const actor = { id: 7, role: "owner", isActive: 1 };
  function revisionFixture() {
    const f = fixture();
    let today = "2026-11-01";
    const database = {
      execute: f.tx.execute,
      async transaction<T>(work: (tx: SetupSqlTx) => Promise<T>) {
        f.db.exec("BEGIN");
        try {
          const result = await work(f.tx);
          f.db.exec("COMMIT");
          return result;
        } catch (error) {
          f.db.exec("ROLLBACK");
          throw error;
        }
      },
    };
    const setup = new SimplifiedSetupService(new SimplifiedSqlRepository(async () => database), () => today);
    const scheduler = new SimplifiedScheduler(new SimplifiedSqlSchedulerRepository(async () => database));
    const api = router({ pmv2: router({ simplified: createPmv2SimplifiedRouter({ enabled: () => true, db: async () => database, service: setup }) }) });
    const caller = api.createCaller({ user: actor, authenticatedUser: actor } as any).pmv2.simplified;
    return { ...f, setup, scheduler, caller, setDate: (date: string) => { today = date; } };
  }

  it("keeps the issued group and translations while issuing new same-day work once and carrying edits forward", async () => {
    const f = revisionFixture();
    try {
      f.db.exec(`
        INSERT INTO sites VALUES (21,1);
        INSERT INTO sections VALUES (22,21,1);
        INSERT INTO warehouses VALUES (15,'branch',1);
        INSERT INTO maintenance_teams VALUES (13,'فريق آخر',15,1);
        INSERT INTO users VALUES (16,'technician',1);
        INSERT INTO maintenance_team_members VALUES (13,16,1);
        ALTER TABLE sites ADD COLUMN name TEXT;
        ALTER TABLE sections ADD COLUMN name TEXT;
      `);
      const oldTitles = { ...base, titleEn: "Restaurant inspection", titleUr: "ریستوران کا معائنہ" };
      const daily = { ...subtask, recurrence: { kind: "daily" as const, startDate: "2026-11-01" } };
      const { id: planId } = await f.caller.create(oldTitles);
      const { id: editedId } = await f.caller.addItem({ planId, ...daily });
      const { id: disabledId } = await f.caller.addItem({ planId, ...daily, titleAr: "فحص قديم" });
      await f.caller.activate({ planId });
      const oldTask = Number(f.db.prepare("SELECT id FROM pmv2_tasks WHERE programId=?").get(planId)?.id);
      const oldItem = Number(f.db.prepare("SELECT id FROM pmv2_task_items WHERE taskId=? AND sourceChecklistItemId=?").get(oldTask, editedId)?.id);
      f.db.prepare("UPDATE pmv2_tasks SET status='completed' WHERE id=?").run(oldTask);
      f.db.prepare("UPDATE pmv2_task_items SET status='completed' WHERE taskId=?").run(oldTask);

      const revisedMain = {
        title: "فحص الموقع الجديد", titleEn: "New site inspection", titleUr: "نئی جگہ کا معائنہ",
        siteId: 21, sectionId: 22, teamId: 13,
      };
      const revisedItem = { ...daily, titleAr: "فحص الأسلاك", titleEn: "Check the wiring", titleUr: "تاروں کی جانچ" };
      await f.caller.updatePlan({ planId, ...revisedMain });
      await f.caller.updateItem({ planId, itemId: editedId, ...revisedItem });
      await f.caller.disableItem({ planId, itemId: disabledId });
      const { id: addedId } = await f.caller.addItem({
        planId, ...daily, titleAr: "اختبار جديد", titleEn: "New test", titleUr: "نیا امتحان",
      });

      const details = await f.caller.get({ id: planId });
      expect(details).toMatchObject({ id: planId, state: "active", ...revisedMain });
      expect(await f.caller.list()).toMatchObject({
        items: [{
          id: planId, state: "active", title: revisedMain.title,
          titleEn: revisedMain.titleEn, titleUr: revisedMain.titleUr,
        }],
        nextId: null,
      });
      expect(details.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: editedId, isActive: true, titleEn: revisedItem.titleEn, titleUr: revisedItem.titleUr }),
        expect.objectContaining({ id: disabledId, isActive: false }),
        expect.objectContaining({ id: addedId, isActive: true }),
      ]));
      expect(await f.caller.status()).toMatchObject({ legacyExists: false });

      await f.scheduler.runForDate("2026-11-01");
      await f.scheduler.runForDate("2026-11-01");
      await f.scheduler.runForDate("2026-11-02");
      await f.scheduler.runForDate("2026-11-02");

      const work = f.db.prepare(`
        SELECT t.id AS taskId,t.dueDate,t.status AS taskStatus,i.id AS taskItemId,i.sourceChecklistItemId AS itemId,
          i.status AS itemStatus,i.titleSnapshot AS itemTitle,p.title AS mainTitle,r.sectionId,l.maintenanceTeamId AS teamId
        FROM pmv2_task_items i JOIN pmv2_tasks t ON t.id=i.taskId
        JOIN pmv2_programs p ON p.id=t.programId JOIN pmv2_program_targets r ON r.id=t.programTargetId
        JOIN pmv2_unified_team_links l ON l.pmv2TeamId=t.teamId
        ORDER BY t.dueDate,t.id,i.id
      `).all();
      expect(work.map(row => [row.dueDate, row.itemId, row.itemTitle, row.mainTitle, row.sectionId, row.teamId, row.itemStatus])).toEqual([
        ["2026-11-01", editedId, daily.titleAr, oldTitles.title, 2, 3, "completed"],
        ["2026-11-01", disabledId, "فحص قديم", oldTitles.title, 2, 3, "completed"],
        ["2026-11-01", addedId, "اختبار جديد", revisedMain.title, 22, 13, "pending"],
        ["2026-11-02", editedId, revisedItem.titleAr, revisedMain.title, 22, 13, "pending"],
        ["2026-11-02", addedId, "اختبار جديد", revisedMain.title, 22, 13, "pending"],
      ]);
      expect(work[0]).toMatchObject({ taskId: oldTask, taskStatus: "completed" });
      expect(work[2].taskId).not.toBe(oldTask);
      const nextItem = Number(work[3].taskItemId);
      const ids = [oldItem, nextItem];
      const english = await loadAuthorizedTaskItemTitles(f.tx, ids, "en");
      const urdu = await loadAuthorizedTaskItemTitles(f.tx, ids, "ur");
      expect(ids.map(id => english.get(id))).toEqual([daily.titleEn, revisedItem.titleEn]);
      expect(ids.map(id => urdu.get(id))).toEqual([daily.titleUr, revisedItem.titleUr]);
      expect(f.db.prepare(`
        SELECT translatedText FROM entity_translations
        WHERE entityType='PMV2_PROGRAM' AND entityId=? AND languageCode='en'
      `).get(planId)?.translatedText).toBe(oldTitles.titleEn);
    } finally {
      f.db.close();
    }
  });

  it("keeps unrelated pause backlog and rejects changing another plan's subtask", async () => {
    const f = revisionFixture();
    try {
      const { id: planId } = await f.setup.create(actor, base);
      const { id: editedId } = await f.setup.addItem(actor, planId, subtask);
      const { id: unchangedId } = await f.setup.addItem(actor, planId, { ...subtask, titleAr: "مهمة أخرى" });
      const { id: otherPlanId } = await f.setup.create(actor, { ...base, title: "خطة مستقلة" });
      const { id: foreignId } = await f.setup.addItem(actor, otherPlanId, subtask);
      await f.setup.activate(actor, planId);
      f.setDate("2026-11-02");
      await f.setup.pause(actor, planId);

      f.setDate("2026-11-05");
      await expect(f.setup.updateItem(actor, planId, foreignId, { ...subtask, titleAr: "تعديل غير مسموح" })).rejects.toThrow();
      await expect(f.setup.disableItem(actor, planId, foreignId)).rejects.toThrow();
      expect(f.count("pmv2_simplified_plan_revisions")).toBe(0);
      expect(f.db.prepare("SELECT isActive FROM pmv2_checklist_items WHERE id=?").get(foreignId)?.isActive).toBe(1);
      await f.setup.updateItem(actor, planId, editedId, { ...subtask, titleAr: "فحص معدل" });
      const { id: addedId } = await f.setup.addItem(actor, planId, { ...subtask, titleAr: "فحص أضيف أثناء الإيقاف" });

      f.setDate("2026-11-07");
      const result = await f.setup.resume(actor, planId);
      expect(result.occurrences.map(row => [row.itemId, row.scheduledDate])).toEqual([[unchangedId, "2026-11-04"]]);
      await f.scheduler.runForDate("2026-11-11");
      const nextWork = f.db.prepare("SELECT sourceChecklistItemId FROM pmv2_task_items WHERE scheduledDate=? ORDER BY sourceChecklistItemId").all("2026-11-11");
      expect(nextWork.map(row => row.sourceChecklistItemId)).toEqual([editedId, unchangedId, addedId]);
    } finally {
      f.db.close();
    }
  });
});
