import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ticketTeamListInput } from "../../shared/maintenance-team-tickets/list";
import { TicketTeamAssignmentService } from "../maintenance-team-tickets/assignment/service";
import { SqlTicketTeamAssignmentRepository } from "../routers/maintenance-teams/assignment.repository";
import { createTicketTeamAssignmentRouter } from "../routers/maintenance-teams/assignment.router";
import { router } from "../routers/_shared/procedures";
vi.mock("../_core/db", () => ({}));
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const open: any[] = [];
const IT = "maintenance_report_department_it";
const actor = (role = "it_manager", id = 9, active = true) => ({ id, role, active });
function fixture(size = 0) {
  const memory = new DatabaseSync(":memory:"); open.push(memory);
  memory.exec(`
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,ticketNumber TEXT,title TEXT,description TEXT,status TEXT,workflowModel TEXT,parentTicketId INTEGER,sourceTaskId INTEGER,maintenanceResponsibleDepartment TEXT,maintenanceResponsibleManagerId INTEGER,assignedToId INTEGER,assignedTechnicianId INTEGER,reportedById INTEGER,siteId INTEGER,sectionId INTEGER,assignedAt TEXT,createdAt TEXT,maintenancePath TEXT);
    CREATE TABLE ticket_tasks(id INTEGER PRIMARY KEY,ticketId INTEGER,ticketDepartmentId INTEGER,convertedTicketId INTEGER);
    CREATE TABLE ticket_departments(id INTEGER PRIMARY KEY,ticketId INTEGER,department TEXT,responsibleManagerId INTEGER);
    CREATE TABLE ticket_task_assignees(taskId INTEGER,userId INTEGER);
    CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER,responsibleDepartment TEXT,responsibleManagerId INTEGER,assignedToId INTEGER,assignedTechnicianId INTEGER);
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT,isActive INTEGER);
    CREATE TABLE sites(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE sections(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE ticket_status_history(id INTEGER PRIMARY KEY,ticketId INTEGER,notes TEXT,toStatus TEXT,createdAt TEXT);
    CREATE TABLE ticket_team_assignments(id INTEGER PRIMARY KEY,ticketId INTEGER,ticketItemId INTEGER,stage TEXT);
    CREATE TABLE ticket_team_actions(id INTEGER PRIMARY KEY,assignmentId INTEGER,actorId INTEGER,kind TEXT,note TEXT,revision INTEGER,operationKey TEXT,createdAt TEXT);
    CREATE TABLE external_maintenance_jobs(id INTEGER PRIMARY KEY,ticketId INTEGER,status TEXT);
    CREATE TABLE entity_translations(id INTEGER PRIMARY KEY,entityType TEXT,entityId INTEGER,fieldName TEXT,languageCode TEXT,translationStatus TEXT,translatedText TEXT);
    INSERT INTO users VALUES(9,'مدير التقنية','it_manager',1),(10,'خالد التقنية','it_member',1),(11,'الفني','technician',1),(12,'عضو آخر','it_member',1);
    INSERT INTO sites VALUES(1,'الملقا'),(2,'موقع آخر');
    INSERT INTO sections VALUES(1,'فودوزو'),(2,'البقالة');
  `);
  const queries: Array<{ sql: string; params: any[] }> = [];
  const dialect = new MySqlDialect();
  const db: any = { execute: async (statement: any) => {
    const q = dialect.sqlToQuery(statement); queries.push(q);
    // SQLite accepts this syntax, but TiDB rejects correlated JOIN ON subqueries.
    for (const on of q.sql.matchAll(/\bON\b([\s\S]*?)(?=\b(?:LEFT|RIGHT|INNER|CROSS|FULL)\s+JOIN\b|\bWHERE\b|\bGROUP\s+BY\b|\bORDER\s+BY\b|$)/gi)) {
      if (/\b(?:SELECT|EXISTS)\b/i.test(on[1])) throw Error("TiDB does not support subqueries in JOIN ON");
    }
    return [memory.prepare(q.sql).all(...q.params), []];
  }};
  const add = (id: number, changes: any = {}) => {
    const site = changes.siteId ?? 1, executor = changes.executorId ?? 10;
    const date = new Date(Date.UTC(2026,10,24,9,0,id)).toISOString();
    memory.prepare("INSERT INTO tickets(id,ticketNumber,title,description,status,workflowModel,reportedById,siteId,sectionId,createdAt) VALUES(?,?,?,?,?,'department_tasks',9,?,?,?)").run(10000+id,"PARENT-"+id,"بلاغ متعدد","الأصل","department_planning",site,site,date);
    memory.prepare("INSERT INTO ticket_departments VALUES(?,?,?,9)").run(30000+id,10000+id,changes.department ?? IT);
    memory.prepare("INSERT INTO ticket_tasks VALUES(?,?,?,?)").run(20000+id,10000+id,30000+id,id);
    memory.prepare("INSERT INTO tickets VALUES(?,?,?,?,?,'sub_ticket',?,?,?,?,?,NULL,9,?,?,?,?,?)").run(
      id,"IT-"+id,changes.title ?? "فحص الكاميرا "+id,"تفاصيل البلاغ "+id,changes.status ?? "in_progress",
      10000+id,20000+id,changes.headerDepartment ?? IT,9,executor,site,site,date,date,changes.path ?? null
    );
    memory.prepare("INSERT INTO ticket_items VALUES(?,?,?,9,?,NULL)").run(id,id,changes.itemDepartment ?? IT,executor);
  };
  for(let id=1;id<=size;id++) add(id);
  const material = (id: number, ticketId: number, stage: string) => memory.prepare("INSERT INTO ticket_team_assignments VALUES(?,?,?,?)").run(id,ticketId,ticketId,stage);
  const action = (assignmentId: number, revision: number, kind: string, note?: string) => memory.prepare("INSERT INTO ticket_team_actions(assignmentId,actorId,kind,note,revision,operationKey,createdAt) VALUES(?,10,?,?,?,'test','2026-11-24')").run(assignmentId,kind,note ?? JSON.stringify({version:1,visitKey:"visit-"+assignmentId}),revision);
  const history = (id: number, ticketId: number, notes: string | null, createdAt = "2026-11-24 12:00:00") => memory.prepare("INSERT INTO ticket_status_history VALUES(?,?,?,'in_progress',?)").run(id,ticketId,notes,createdAt);
  const service = new TicketTeamAssignmentService(new SqlTicketTeamAssignmentRepository(async()=>({db,tickets:{} as any})));
  const list = (input: any = {}, user = actor()) => service.list(user,ticketTeamListInput.parse({ department: IT, ...input }));
  return { memory, db, queries, add, material, action, history, service, list };
}
afterEach(()=>{for(const memory of open.splice(0))memory.close();});

describe("Existing named IT execution tickets",()=>{
  it("includes children without material assignments and preserves exact parent/task/item linkage",async()=>{
    const f=fixture();f.add(1);f.add(2,{headerDepartment:"maintenance_report_department_general"});
    f.add(3,{department:"maintenance_report_department_general"});f.add(4,{itemDepartment:"maintenance_report_department_general"});
    f.add(5);f.memory.exec("UPDATE ticket_tasks SET convertedTicketId=999 WHERE id=20005");
    f.add(6);f.memory.exec("DELETE FROM tickets WHERE id=10006");
    f.add(7);f.memory.exec("DELETE FROM ticket_items WHERE id=7");
    const result=await f.list({status:"all"});
    expect(result.items).toEqual([]);expect(result.itTickets?.map(row=>row.id)).toEqual([1,2]);
    expect(result.itTickets?.[0]).toMatchObject({parentTicketNumber:"PARENT-1",assignedToId:10,assignedToName:"خالد التقنية",state:"in_progress"});
    expect(result.itTickets?.[0]).not.toHaveProperty("assignmentId");
    expect(result.options.executors).toEqual([{id:10,name:"خالد التقنية"}]);
  });
  it("finds old tickets and literal symbols, stored translations, parent references and executor names",async()=>{
    const f=fixture(230);f.add(500,{title:"قيمة !%_ O'Reilly خاصة"});
    expect((await f.list({search:"!%_ O'Reilly"})).itTickets?.map(row=>row.id)).toEqual([500]);
    expect((await f.list({search:"PARENT-1",pageSize:1})).itTickets?.[0].id).toBe(1);
    expect((await f.list({search:"خالد التقنية",pageSize:1})).total).toBe(231);
    f.memory.prepare("INSERT INTO entity_translations VALUES(1,'TICKET',1,'title','en','completed','Pump inspection')").run();
    const result=await f.list({search:"Pump",language:"en"});
    expect(result.itTickets?.map(row=>row.id)).toEqual([1]);expect(result.itTickets?.[0].title).toBe("Pump inspection");
    expect(f.queries.some(q=>q.sql.includes("O'Reilly"))).toBe(false);
  });
  it("combines executor/location filters and pagination, with metadata from scoped original rows",async()=>{
    const f=fixture();f.add(1);f.add(2,{executorId:12,siteId:2});f.add(3,{executorId:12,siteId:2});
    const result=await f.list({executorId:12,siteId:2,sectionId:2,sort:"newest",pageSize:1,page:2});
    expect(result).toMatchObject({total:2,page:2});expect(result.itTickets?.[0].id).toBe(2);
    expect(result.options.executors).toHaveLength(2);expect(result.options.sites).toHaveLength(2);
    expect((await f.list({teamId:1})).total).toBe(0);
  });
});

describe("IT state reflects actual workflow",()=>{
  it("uses chronological latest history for obstacles and clears the label after resume",async()=>{
    const f=fixture(1);f.history(100,1,"بدأ منفذ تقنية المعلومات العمل","2026-11-24 10:00:00");
    f.history(1,1,"يوجد عائق: لا يوجد اتصال","2026-11-24 11:00:00");
    expect((await f.list({status:"blocked"})).itTickets?.map(row=>row.id)).toEqual([1]);
    f.history(2,1,null,"2026-11-24 12:00:00");
    expect((await f.list({status:"blocked"})).total).toBe(0);
    expect((await f.list({status:"in_progress"})).total).toBe(1);
  });
  it("keeps team-result approval pending until the source ticket actually closes",async()=>{
    const f=fixture();f.add(1,{status:"ready_for_closure",path:"B"});f.material(51,1,"closed");
    let result=await f.list();expect(result.total).toBe(1);expect(result.itTickets?.[0].state).toBe("awaiting_review");
    f.memory.exec("UPDATE tickets SET status='closed' WHERE id=1");
    expect((await f.list()).total).toBe(0);expect((await f.list({status:"closed"})).itTickets?.[0].state).toBe("closed");
  });
  it("maps actual material states and active sessions without making duplicate ticket rows",async()=>{
    const f=fixture();f.add(1,{status:"work_approved",path:"B"});f.material(51,1,"waiting_material");
    f.add(2,{status:"received_warehouse",path:"B"});f.material(52,2,"ready_to_repair");
    f.add(3,{status:"in_progress",path:"B"});f.material(53,3,"ready_to_repair");f.action(53,1,"execution_started");
    f.material(151,1,"blocked");f.material(152,2,"blocked");
    f.memory.exec("INSERT INTO ticket_team_assignments VALUES(1,1,2,'blocked')");
    expect((await f.list({status:"waiting_material"})).itTickets?.map(row=>row.id)).toEqual([1]);
    expect((await f.list({status:"ready_to_repair"})).itTickets?.map(row=>row.id)).toEqual([2]);
    expect((await f.list({status:"in_progress"})).itTickets?.map(row=>row.id)).toEqual([3]);
    f.action(53,2,"visit_ended");
    expect((await f.list({status:"ready_to_repair"})).itTickets?.map(row=>row.id)).toEqual([2,3]);
  });
  it("maps actual external-maintenance job states and terminal source priority",async()=>{
    const f=fixture();
    for(let id=1;id<=5;id++)f.add(id,{status:"received_warehouse",path:"C"});
    ["waiting_gate_exit","purchase_cycle","waiting_technician_handover","delivered_for_reinstall","ready_for_closure"].forEach((state,index)=>f.memory.prepare("INSERT INTO external_maintenance_jobs VALUES(?,?,?)").run(index+1,index+1,state));
    f.memory.exec("INSERT INTO external_maintenance_jobs VALUES(0,2,'waiting_gate_exit'); INSERT INTO external_maintenance_jobs VALUES(100,2,'purchase_cycle')");
    const result=await f.list({status:"all"});
    expect(result.itTickets?.map(row=>row.state)).toEqual(["external_requested","external_in_progress","external_in_progress","reinstall_required","awaiting_review"]);
    f.memory.exec("UPDATE tickets SET status='requester_confirmed' WHERE id=4");
    expect((await f.list({status:"closed"})).itTickets?.map(row=>row.id)).toEqual([4]);
  });
});

describe("IT read authorization stays within existing ticket scope",()=>{
  it("shares IT-department reads across IT roles and keeps warehouse empty before SQL",async()=>{
    const f=fixture(2);expect((await f.list({},actor("it_member",12))).total).toBe(2);
    expect((await f.list({},actor("construction_procurement_manager",7))).total).toBe(2);
    const before=f.queries.length;expect((await f.list({},actor("warehouse",7)))).toMatchObject({itTickets:[],total:0,options:{executors:[],sites:[],sections:[]}});
    expect(f.queries).toHaveLength(before);
  });
  it("isolates technicians by named item/task assignment and applies fresh scope after changes",async()=>{
    const f=fixture();f.add(1);f.add(2,{executorId:11});f.add(3);
    f.memory.prepare("INSERT INTO ticket_task_assignees VALUES(?,11)").run(20003);
    expect((await f.list({},actor("technician",11))).itTickets?.map(row=>row.id)).toEqual([2,3]);
    expect((await f.list({},actor("technician",99))).itTickets).toEqual([]);
    f.memory.exec("DELETE FROM ticket_task_assignees");f.memory.exec("UPDATE tickets SET assignedToId=10 WHERE id=2");f.memory.exec("UPDATE ticket_items SET assignedToId=10 WHERE id=2");
    expect((await f.list({},actor("technician",11))).total).toBe(0);
  });
  it("rejects inactive or unauthorized actors before any SQL and preserves the RPC middleware",async()=>{
    const f=fixture(1);const app=router({ticketTeamAssignments:createTicketTeamAssignmentRouter(f.service)});
    const caller=(role:string,id=9,isActive=1)=>app.createCaller({user:{id,role,isActive}}as any).ticketTeamAssignments;
    expect((await caller("it_manager").list({department:IT})).itTickets).toHaveLength(1);
    const before=f.queries.length;
    for(const role of ["senior_management","delegate","observer","accountant"])await expect(caller(role).list({department:IT})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(caller("it_manager",9,0).list({department:IT})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(f.queries).toHaveLength(before);
  });
  it("chunks material session history before paging without per-ticket enrichment",async()=>{
    const f=fixture(501);
    for(let id=1;id<=501;id++){f.material(id,id,"ready_to_repair");f.action(id,1,"execution_started");}
    const result=await f.list({status:"in_progress",pageSize:20,page:2});
    expect(result).toMatchObject({total:501,page:2});expect(result.itTickets).toHaveLength(20);
    const history=f.queries.filter(q=>q.sql.includes("FROM ticket_team_actions"));
    expect(history).toHaveLength(2);expect(history.every(q=>q.params.length<=500)).toBe(true);
    expect(f.queries).toHaveLength(15);
  });
  it("keeps query count bounded and enriches just the requested page",async()=>{
    const f=fixture(601);const result=await f.list({page:20,pageSize:20});
    expect(result).toMatchObject({total:601,page:20});expect(result.itTickets).toHaveLength(20);
    expect(f.queries).toHaveLength(13);
    for (const table of ["ticket_status_history","ticket_team_assignments a","external_maintenance_jobs"]) {
      const batches=f.queries.filter(q=>q.sql.includes("FROM "+table));
      expect(batches).toHaveLength(2);expect(batches.every(q=>q.params.length<=500)).toBe(true);
    }
    expect(f.queries.find(q=>q.sql.startsWith("SELECT ticketId,responsibleDepartment"))?.params).toHaveLength(20);
    expect(f.queries.find(q=>q.sql.startsWith("SELECT entityId,fieldName"))?.params).toHaveLength(21);
  });
});
