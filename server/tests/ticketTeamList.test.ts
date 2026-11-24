import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ticketTeamListInput } from "../../shared/maintenance-team-tickets/list";
import { businessRpcAllowed } from "../../shared/business-role-policy";
import { technicianRpcAllowed } from "../../shared/technician-policy";
import { TicketTeamAssignmentService } from "../maintenance-team-tickets/assignment/service";
import { createTicketTeamAssignmentRouter } from "../routers/maintenance-teams/assignment.router";
import { router } from "../routers/_shared/procedures";
import { SqlTicketTeamAssignmentRepository } from "../routers/maintenance-teams/assignment.repository";
const media = vi.hoisted(() => ({ read: vi.fn(async (_db: any, _actor: any, _rows: any[]) => new Map()) }));
vi.mock("../maintenance-team-tickets/report-media", () => ({ loadTeamReportMedia: media.read }));
vi.mock("../maintenance-team-tickets/ticket-translations", () => ({ localizeTeamTicketQueue: async (rows: any[]) => rows, queueTeamTicketTranslations: async () => {} }));
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const open: any[] = [];
const actor = (role = "warehouse", id = 7, active = true) => ({ id, role, active });
function fixture(size = 0) {
  const memory = new DatabaseSync(":memory:"); open.push(memory);
  memory.exec(`
    CREATE TABLE ticket_team_assignments(id INTEGER PRIMARY KEY,ticketId INTEGER,ticketItemId INTEGER,teamId INTEGER,ticketNumber TEXT,titleSnapshot TEXT,warehouseId INTEGER,stage TEXT,siteId INTEGER,sectionId INTEGER,createdAt TEXT);
    CREATE TABLE maintenance_teams(id INTEGER PRIMARY KEY,name TEXT,isActive INTEGER);
    CREATE TABLE maintenance_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,isActive INTEGER);
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,ticketNumber TEXT,status TEXT,description TEXT,parentTicketId INTEGER,sourceTaskId INTEGER,maintenanceResponsibleDepartment TEXT,assignedToId INTEGER);
    CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER,responsibleDepartment TEXT);
    CREATE TABLE ticket_tasks(id INTEGER PRIMARY KEY,ticketId INTEGER,convertedTicketId INTEGER);
    CREATE TABLE warehouses(id INTEGER PRIMARY KEY,nameAr TEXT);
    CREATE TABLE sites(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE sections(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE ticket_team_actions(id INTEGER PRIMARY KEY,assignmentId INTEGER,actorId INTEGER,kind TEXT,note TEXT,revision INTEGER,operationKey TEXT,createdAt TEXT);
    CREATE TABLE entity_translations(id INTEGER PRIMARY KEY,entityType TEXT,entityId INTEGER,fieldName TEXT,languageCode TEXT,translationStatus TEXT,translatedText TEXT);
    INSERT INTO users VALUES(7,'technician',1),(8,'technician',1),(9,'it_manager',1);
    INSERT INTO maintenance_teams VALUES(1,'الكهرباء',1),(2,'السباكة',1);
    INSERT INTO maintenance_team_members VALUES(1,7,1),(2,8,1),(1,9,1);
    INSERT INTO warehouses VALUES(1,'المخزن'); INSERT INTO sites VALUES(1,'الملقا'),(2,'موقع آخر');
    INSERT INTO sections VALUES(1,'فودوزو'),(2,'البقالة');
  `);
  const queries: Array<{sql: string; params: any[]}> = [];
  const dialect = new MySqlDialect();
  const db: any = { execute: async (statement: any) => {
    const q = dialect.sqlToQuery(statement); queries.push(q);
    return [memory.prepare(q.sql).all(...q.params), []];
  } };
  const add = (id: number, department = "general", teamId = 1, stage = "action_required", title = "فحص الكهرباء") => {
    const d = "maintenance_report_department_" + department;
    const createdAt = "2026-11-24 09:" + String(Math.floor(id / 60)).padStart(2,'0') + ":" + String(id % 60).padStart(2,'0');
    memory.prepare("INSERT INTO tickets VALUES(?,?, 'assigned', ?,NULL,NULL,?,NULL)").run(id, 'MT-'+id, 'وصف المهمة '+id, d);
    memory.prepare("INSERT INTO ticket_items VALUES(?,?,?)").run(id,id,d);
    memory.prepare("INSERT INTO ticket_team_assignments VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id,id,id,teamId,'MT-'+id,title,1,stage,teamId,teamId,createdAt);
  };
  const event = (assignmentId: number, revision: number, kind: string, note = JSON.stringify({version:1, visitKey:'visit-'+assignmentId})) =>
    memory.prepare("INSERT INTO ticket_team_actions(assignmentId,actorId,kind,note,revision,operationKey,createdAt) VALUES(?,7,?,?,?,'key','2026-11-24')").run(assignmentId,kind,note,revision);
  for (let id = 1; id <= size; id++) add(id);
  const repository = new SqlTicketTeamAssignmentRepository(async () => ({db,tickets:{} as any}));
  const service = new TicketTeamAssignmentService(repository);
  const list = (input: any = {}, user = actor()) => service.list(user,ticketTeamListInput.parse(input));
  return {memory,queries,add,event,list,repository,service};
}
afterEach(() => { for (const db of open.splice(0)) db.close(); vi.clearAllMocks(); });

describe("Ticket team list filters before pagination", () => {
  it("finds a record older than the old 200-row queue and opens that exact scoped family", async () => {
    const f=fixture(230);
    const old=await f.repository.queue(actor('technician'));
    expect(old).toHaveLength(200); expect(old.some(row=>row.assignmentId===1)).toBe(false);
    const result=await f.list({search:'MT-1',pageSize:1},actor('technician'));
    expect(result.items[0].assignmentId).toBe(1); expect(result.total).toBeGreaterThan(1);
    expect((await f.repository.queue(actor('technician'),{assignmentId:1})).map(row=>row.assignmentId)).toEqual([1]);
    expect((await f.repository.queue(actor('technician',8),{assignmentId:1}))).toEqual([]);
    expect(media.read.mock.calls.at(-1)?.[2].map(row=>row.assignmentId)).toEqual([1]);
  });
  it("combines department, team, site, section and state; options remain independent of page/search", async () => {
    const f=fixture();f.add(1);f.add(2,'construction',2,'waiting_material');f.add(3,'construction',1,'closed');
    const result=await f.list({department:'maintenance_report_department_construction',teamId:2,siteId:2,sectionId:2,status:'waiting_material',search:'السباكة'});
    expect(result.items.map(row=>row.assignmentId)).toEqual([2]);expect(result.options.teams.map(row=>row.id).sort()).toEqual([1,2]);
    expect(result.departmentCounts).toEqual({general:1,construction:1});
    expect((await f.list({department:'maintenance_report_department_construction',status:'all'})).total).toBe(2);
  });
  it.each(['%', '_', '!', "O'Reilly", '9'])('treats literal %s as a substring, never SQL or wildcard syntax', async term => {
    const f=fixture();f.add(1,'general',1,'action_required','اسم '+term+' مادة');f.add(2,'general',1,'action_required','صنف آخر');
    const result=await f.list({search:term});expect(result.items.map(row=>row.assignmentId)).toEqual([1]);
    const query=f.queries.find(q=>q.sql.includes('EXISTS (SELECT 1 FROM entity_translations'))!;
    expect(query.sql).not.toContain(term === '!' ? 'اسم ! مادة' : 'اسم '+term+' مادة');
    expect(f.queries.every(q=>/^SELECT/.test(q.sql.trim()))).toBe(true);
  });
  it("searches translated visible titles and verified original-report numbers", async () => {
    const f=fixture(2);
    f.memory.exec(`INSERT INTO entity_translations VALUES(1,'TICKET',1,'title','en','completed','Check lighting');
      INSERT INTO tickets(id,ticketNumber) VALUES(500,'MT-ORIGINAL');
      INSERT INTO ticket_tasks VALUES(600,500,1);
      UPDATE tickets SET parentTicketId=500,sourceTaskId=600 WHERE id=1;`);
    expect((await f.list({search:'lighting',language:'en'})).items.map(row=>row.assignmentId)).toEqual([1]);
    expect((await f.list({search:'lighting',language:'ur'})).total).toBe(0);
    expect((await f.list({search:'ORIGINAL'})).items[0].parentTicketNumber).toBe('MT-ORIGINAL');
    f.memory.exec('UPDATE ticket_tasks SET convertedTicketId=2 WHERE id=600');
    expect((await f.list({search:'ORIGINAL'})).total).toBe(0);
  });
  it("orders oldest/newest deterministically and bounds/clamps pagination", async () => {
    const f=fixture(5);
    expect((await f.list({page:2,pageSize:2})).items.map(row=>row.assignmentId)).toEqual([3,4]);
    expect((await f.list({sort:'newest',pageSize:2})).items.map(row=>row.assignmentId)).toEqual([5,4]);
    expect(await f.list({page:99,pageSize:2})).toMatchObject({page:3,total:5,items:[{assignmentId:5}]});
    expect(ticketTeamListInput.safeParse({pageSize:1000}).success).toBe(false);
    expect(ticketTeamListInput.safeParse({department:'maintenance_report_department_it'}).success).toBe(false);
  });
  it("uses each child item's department, with no inference from its multi-department parent", async () => {
    const f=fixture();f.add(1,'general');
    f.memory.exec("UPDATE tickets SET maintenanceResponsibleDepartment='maintenance_report_department_construction' WHERE id=1");
    expect((await f.list()).total).toBe(1);
    expect((await f.list({department:'maintenance_report_department_construction'})).total).toBe(0);
  });
});

describe("Derived execution state reuses the canonical session and remains bounded", () => {
  it("ignores malformed, unknown-visit and joined events, and stops work on results/end", async () => {
    const f=fixture(7);
    f.event(1,1,'execution_started');f.event(1,2,'execution_joined');
    f.event(2,1,'execution_started');f.event(2,2,'blocked','سبب');
    f.event(3,1,'execution_started','not json');
    f.event(4,1,'execution_resumed');
    f.event(5,1,'execution_started');f.event(5,2,'visit_ended');
    f.event(6,1,'execution_started');f.event(6,2,'visit_ended',JSON.stringify({version:1,visitKey:'unknown'}));
    f.event(7,1,'execution_started');f.memory.exec("UPDATE ticket_team_assignments SET stage='waiting_material' WHERE id=7");
    expect((await f.list({status:'in_progress'})).items.map(row=>row.assignmentId)).toEqual([1,6]);
    expect((await f.list({status:'not_started'})).items.map(row=>row.assignmentId)).toEqual([2,3,4,5]);
  });
  it("counts more than 500 filtered candidates before paging but enriches only page rows", async () => {
    const f=fixture(601);for(let id=1;id<=601;id++)f.event(id,1,'execution_started');
    const result=await f.list({status:'in_progress',page:3,pageSize:20},actor('technician'));
    expect(result).toMatchObject({total:601,page:3});expect(result.items).toHaveLength(20);
    expect(media.read.mock.calls.at(-1)?.[2]).toHaveLength(20);
    expect(f.queries.filter(q=>q.sql.includes('FROM ticket_team_actions'))).toHaveLength(2);
    expect(f.queries.length).toBeLessThanOrEqual(8);
    expect(f.queries.filter(q=>q.sql.includes('FROM ticket_team_actions')).every(q=>q.params.length<=500)).toBe(true);
  });
});

describe("List scope and capability parity", () => {
  it("rechecks membership/team state and isolates metadata and independent actors", async () => {
    const f=fixture();f.add(1);f.add(2,'general',2);
    expect((await f.list({},actor('technician'))).items.map(row=>row.assignmentId)).toEqual([1]);
    expect((await f.list({},actor('technician',8))).items.map(row=>row.assignmentId)).toEqual([2]);
    expect((await f.list({},actor('technician'))).options.teams.map(row=>row.id)).toEqual([1]);
    f.memory.exec('UPDATE maintenance_team_members SET isActive=0 WHERE userId=7');
    expect((await f.list({},actor('technician')))).toMatchObject({items:[],total:0,options:{teams:[],sites:[],sections:[]}});
    expect((await f.list({},actor('warehouse'))).total).toBe(2);
    f.memory.exec('DELETE FROM ticket_items WHERE id=2');expect((await f.list()).total).toBe(1);
  });
  it.each(['delegate','delegate_manager','senior_management','observer','operator'])('denies new direct list access to %s', async role => {
    const f=fixture(1);await expect(f.list({},actor(role))).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.queries).toHaveLength(0);
  });
  it("preserves the existing IT identity/membership/department constraints", async () => {
    const f=fixture();f.add(1,'general');f.add(2,'construction');
    expect((await f.list({},actor('it_manager',9))).total).toBe(0);
    f.memory.exec("UPDATE tickets SET maintenanceResponsibleDepartment='maintenance_report_department_it',assignedToId=9 WHERE id=1");
    expect((await f.list({},actor('it_manager',9))).items.map(row=>row.assignmentId)).toEqual([1]);
    f.memory.exec('UPDATE maintenance_team_members SET isActive=0 WHERE userId=9');
    expect((await f.list({},actor('it_manager',9))).total).toBe(0);
  });
  it("grants exactly the existing read capability and no new mutation", async () => {
    for(const role of ['warehouse','accountant','senior_management','executive_director','food_warehouse_assistant']) {
      const user={id:7,role,isActive:1};
      expect(businessRpcAllowed(user,'query','ticketTeamAssignments.list')).toBe(businessRpcAllowed(user,'query','ticketTeamAssignments.queue'));
      expect(businessRpcAllowed(user,'mutation','ticketTeamAssignments.list')).toBe(false);
    }
    expect(technicianRpcAllowed({role:'technician',isActive:1},'query','ticketTeamAssignments.list')).toBe(true);
    const f=fixture(1);await expect(f.list({},actor('technician',7,false))).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.queries).toHaveLength(0);
  });
});


describe("List direct RPC boundary", () => {
  it("preserves the real middleware and service grants for new list and selected old queue", async () => {
    const f=fixture(230);
    const app=router({ticketTeamAssignments:createTicketTeamAssignmentRouter(f.service)});
    const caller=(role:string,id=7,isActive=1)=>app.createCaller({user:{id,role,isActive}} as any);
    expect((await caller('technician').ticketTeamAssignments.list({search:'MT-1',pageSize:1})).items[0].assignmentId).toBe(1);
    expect((await caller('warehouse').ticketTeamAssignments.list({pageSize:1})).items).toHaveLength(1);
    expect((await caller('technician').ticketTeamAssignments.queue({language:'ar',assignmentId:1})).map(row=>row.assignmentId)).toEqual([1]);
    expect(await caller('technician',8).ticketTeamAssignments.queue({language:'ar',assignmentId:1})).toEqual([]);
    const before=f.queries.length;
    for(const role of ['senior_management','accountant','delegate','observer']) {
      await expect(caller(role).ticketTeamAssignments.list({})).rejects.toMatchObject({code:'FORBIDDEN'});
    }
    await expect(caller('technician',7,0).ticketTeamAssignments.list({})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.queries).toHaveLength(before);
  });
  it("rejects malformed list and selected identifiers before querying", async () => {
    const f=fixture(1);const app=router({ticketTeamAssignments:createTicketTeamAssignmentRouter(f.service)});
    const client=app.createCaller({user:{id:7,role:'admin',isActive:1}} as any).ticketTeamAssignments;
    await expect(client.list({search:'x'.repeat(201)})).rejects.toMatchObject({code:'BAD_REQUEST'});
    await expect(client.list({department:'fake'} as any)).rejects.toMatchObject({code:'BAD_REQUEST'});
    await expect(client.queue({language:'ar',assignmentId:-1})).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect(f.queries).toHaveLength(0);
  });
});
